/* 房主浏览器内的本机权威 Worker：固定 60Hz 推进 MatchRoom，并把房间消息按座位回传给页面。 */
importScripts('engine.js', 'combat.js', 'room.js', 'protocol.js');

(function () {
'use strict';

const P = self.InkOnlineProtocol;
const { MatchRoom } = self.InkOnlineRoom;

const TICK = 1 / 60;
const MAX_DT = 0.1;
const MAX_STEPS = 8;

/* id -> { slot: null | 0 | 1 } */
const sockets = new Map();
let room = null;
let networkPaused = false;
let backgroundPaused = false;
let accumulator = 0;
let lastTime = 0;
let timer = null;

/* ---------------------------------------------------------------- 发送 */

function post(id, payload) {
  try {
    self.postMessage(Object.assign({ id }, payload));
  } catch (error) {
    console.error(error);
  }
}

function sendError(id, text) {
  const message = text instanceof Error ? text.message : String(text || '本机对战发生未知错误');
  post(id, { op: 'packet', packet: { type: 'error', text: message } });
}

/* ---------------------------------------------------------------- 房间 */

function newRoomCode() {
  const bytes = new Uint8Array(6);
  self.crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += (byte % 16).toString(16).toUpperCase();
  return code;
}

function pauseReason() {
  if (backgroundPaused) return 'host-hidden';
  if (networkPaused) return 'connection';
  return null;
}

function onEmit(slot, packet) {
  if (slot !== 0 && slot !== 1) return;
  if (!packet || typeof packet !== 'object') return;
  let outgoing = packet;
  if (packet.type === 'room' && packet.paused === true) {
    outgoing = Object.assign({}, packet, { pauseReason: pauseReason() || 'connection' });
  }
  for (const [id, entry] of sockets) {
    if (entry.slot === slot) post(id, { op: 'packet', packet: outgoing });
  }
}

function applyPause() {
  if (!room) return;
  const paused = networkPaused || backgroundPaused;
  if (paused) {
    if (room.state === 'playing' || room.state === 'countdown') room.setPaused(true);
    return;
  }
  if (room.state === 'paused') room.setPaused(false);
}

function resetRoom() {
  room = null;
  networkPaused = false;
  stopLoop();
}

function slotOf(id) {
  const entry = sockets.get(id);
  return entry ? entry.slot : null;
}

function disconnect(id, sendLeft) {
  const entry = sockets.get(id);
  if (!entry) return;
  const slot = entry.slot;
  entry.slot = null;
  if (room && slot !== null) {
    room.disconnect(slot);
  }
  if (room && !room.players[0] && !room.players[1]) resetRoom();
  if (sendLeft) post(id, { op: 'packet', packet: { type: 'left' } });
}

/* ---------------------------------------------------------------- 命令 */

function onCreate(id, message) {
  const entry = sockets.get(id);
  if (!entry) return;
  if (entry.slot !== null) {
    sendError(id, '已经在房间中，不能重复创建');
    return;
  }
  if (room) {
    sendError(id, '已有进行中的房间，请先离开');
    return;
  }
  const code = newRoomCode();
  entry.slot = 0;
  const created = new MatchRoom({ code, onEmit });
  room = created;
  networkPaused = false;
  try {
    created.connect(0, P.profile(message.profile || message));
  } catch (error) {
    entry.slot = null;
    resetRoom();
    sendError(id, error);
    return;
  }
  startLoop();
  applyPause();
}

function onJoin(id, message) {
  const entry = sockets.get(id);
  if (!entry) return;
  if (entry.slot !== null) {
    sendError(id, '已经在房间中，不能重复加入');
    return;
  }
  if (!room || !room.players[0]) {
    sendError(id, '找不到这个房间，请核对房主提供的房间码');
    return;
  }
  const code = String(message.code || '').trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code) || code !== room.code) {
    sendError(id, '房间码不正确，请核对房主提供的房间码');
    return;
  }
  if (room.players[1]) {
    sendError(id, '房间已满，请等房主结束当前对局');
    return;
  }
  entry.slot = 1;
  try {
    room.connect(1, P.profile(message.profile || message));
  } catch (error) {
    entry.slot = null;
    sendError(id, error);
    return;
  }
  applyPause();
}

function onPause(id, message) {
  const entry = sockets.get(id);
  if (!entry) return;
  if (entry.slot !== 0) {
    sendError(id, '只有房主可以控制暂停');
    return;
  }
  if (!room) return;
  networkPaused = message.paused === true;
  applyPause();
}

function onMessage(id, message) {
  const entry = sockets.get(id);
  if (!entry) return;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    sendError(id, '消息格式不正确');
    return;
  }
  if (message.type === 'create') {
    onCreate(id, message);
    return;
  }
  if (message.type === 'join') {
    onJoin(id, message);
    return;
  }
  if (message.type === 'pause') {
    onPause(id, message);
    return;
  }
  if (message.type === 'leave') {
    disconnect(id, true);
    return;
  }
  const command = P.command(message);
  if (!command) {
    sendError(id, '不支持的消息类型');
    return;
  }
  if (!room || entry.slot === null || !room.players[entry.slot]) {
    sendError(id, '尚未进入房间，不能发送对战指令');
    return;
  }
  room.receive(entry.slot, command);
  if (command.type === 'ready' || command.type === 'rematch') applyPause();
}

/* ---------------------------------------------------------------- 生命周期 */

function onOpen(id) {
  if (sockets.has(id)) return;
  sockets.set(id, { slot: null });
  post(id, { op: 'open' });
  post(id, { op: 'hello', version: P.VERSION });
}

function onClose(id) {
  disconnect(id, false);
  sockets.delete(id);
}

function onVisibility(hidden) {
  backgroundPaused = hidden === true;
  applyPause();
}

/* ---------------------------------------------------------------- 主循环 */

function step() {
  const now = performance.now();
  let dt = (now - lastTime) / 1000;
  lastTime = now;
  if (!(dt > 0)) return;
  if (dt > MAX_DT) dt = MAX_DT;
  accumulator += dt;
  applyPause();
  let steps = 0;
  while (accumulator >= TICK && steps < MAX_STEPS) {
    accumulator -= TICK;
    steps += 1;
    if (!room) break;
    room.tick(TICK);
  }
  if (steps >= MAX_STEPS) accumulator = 0;
}

function startLoop() {
  if (timer !== null) return;
  lastTime = performance.now();
  accumulator = 0;
  timer = setInterval(step, 1000 / 60);
}

function stopLoop() {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
  accumulator = 0;
}

/* ---------------------------------------------------------------- 入口 */

self.addEventListener('message', event => {
  const data = event ? event.data : null;
  if (!data || typeof data !== 'object') return;
  const id = data.id;
  try {
    switch (data.op) {
      case 'open':
        onOpen(id);
        break;
      case 'message':
        onMessage(id, data.message);
        break;
      case 'close':
        onClose(id);
        break;
      case 'visibility':
        onVisibility(data.hidden);
        break;
      default:
        break;
    }
  } catch (error) {
    if (sockets.has(id)) sendError(id, error);
    else console.error(error);
  }
});
})();
