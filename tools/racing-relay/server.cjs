'use strict';
const http = require('node:http');
const { randomInt } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

function createRelay() {
  const rooms = new Map(), clients = new Map(), attempts = new Map();
  const path = '/games/racing3d/relay';
  const server = http.createServer((req, res) => {
    const ok = req.method === 'GET' && req.url === path + '/health';
    res.writeHead(ok ? 200 : 404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
    res.end(ok ? 'oval-relay-v1\n' : '');
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const send = (ws, msg) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 262144) { ws.terminate(); return; }
    ws.send(JSON.stringify(msg));
  };
  function reject(ws, reason) { send(ws, { op: 'error', reason }); ws.close(1008); }
  function choose(room, route) {
    if (room.route === route || room.route === 'relay') return;
    clearTimeout(room.timer); room.route = route;
    for (const ws of [room.host, room.guest]) send(ws, { op: 'route', route });
  }
  function admit(ws, msg) {
    if (!['v4','classic-v1','trial1-v4','trial1-classic-v1'].includes(msg.rules)) return reject(ws, 'version');
    const role = msg.op === 'create' ? 'host' : msg.op === 'join' ? 'guest' : '';
    if (!role) return reject(ws, 'invalid');
    let room;
    if (role === 'host') {
      if (rooms.size >= 64) return reject(ws, 'busy');
      let code;
      do { code = String(randomInt(1000000)).padStart(6, '0'); } while (rooms.has(code));
      room = { code, rules: msg.rules, host: ws, created: Date.now(), route: '', signals: 0 };
      rooms.set(code, room);
    } else {
      room = rooms.get(msg.code);
      if (!room || room.rules !== msg.rules) return reject(ws, 'missing');
      if (room.guest) return reject(ws, 'full');
      room.guest = ws;
    }
    ws.room = room; ws.role = role;
    send(ws, { op: 'joined', code: room.code });
    if (room.guest) {
      for (const member of [room.host,room.guest]) send(member, { op: 'paired' });
      room.timer = setTimeout(() => choose(room, 'relay'), 6000);
    }
  }
  function receive(ws, msg) {
    if (!msg || typeof msg !== 'object') return reject(ws, 'invalid');
    if (!ws.room) return admit(ws, msg);
    const room = ws.room, host = ws.role === 'host', other = host ? room.guest : room.host;
    if (!other) return reject(ws, 'invalid');
    if (msg.op === 'fallback') return choose(room, 'relay');
    if (msg.op === 'direct') {
      ws.direct = true;
      if (other.direct) choose(room, 'direct');
      return;
    }
    if (msg.op === 'signal') {
      if (room.route) return;
      if (++room.signals > 160 || !['candidate',host ? 'offer' : 'answer'].includes(msg.kind)) return reject(ws, 'invalid');
      send(other, { op: 'signal', kind: msg.kind, value: msg.value }); return;
    }
    if (room.rules.startsWith('trial1-')) {
      const packet = msg.packet;
      const types = host ? ['lobby','start','score','ack'] : ['ready','score','ack'];
      if (msg.op !== 'game' || !room.route || !types.includes(packet?.type) || JSON.stringify(packet).length > 512) return reject(ws, 'invalid');
      send(other, { op: 'game', packet }); return;
    }
    const allowed = host ? ['lobby','race'] : ['ready','gridReady','input'];
    if (msg.op !== 'game' || !room.route || !allowed.includes(msg.packet?.type)) return reject(ws, 'invalid');
    send(other, { op: 'game', packet: msg.packet });
  }
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
    // The listener is only published on loopback. Nginx overwrites X-Real-IP.
    if (req.url !== path || !['https://bobbycn.cc','https://www.bobbycn.cc','null'].includes(origin)) {
      socket.destroy(); return;
    }
    const now = Date.now(), previous = attempts.get(ip);
    const count = previous && now < previous.until ? previous : { until: now + 60000, n: 0 };
    if (attempts.size >= 2048 && !previous) { socket.destroy(); return; }
    attempts.set(ip, count);
    if (++count.n > 60 || (clients.get(ip) || 0) >= 24 || wss.clients.size >= 160) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      clients.set(ip, (clients.get(ip) || 0) + 1);
      ws.alive = true;
      const loginTimer = setTimeout(() => { if (!ws.room) ws.terminate(); }, 8000);
      let since = now, messages = 0, bytes = 0;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => ws.terminate());
      ws.on('message', (raw, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const t = Date.now();
        if (t - since >= 1000) { since = t; messages = 0; bytes = 0; }
        bytes += raw.length;
        if (binary || ++messages > 120 || bytes > 160000) return reject(ws, 'limit');
        try { receive(ws, JSON.parse(raw)); } catch { reject(ws, 'invalid'); }
      });
      ws.on('close', () => {
        clearTimeout(loginTimer);
        const n = clients.get(ip) - 1;
        if (n) clients.set(ip, n); else clients.delete(ip);
        const room = ws.room;
        if (!room || rooms.get(room.code) !== room) return;
        rooms.delete(room.code); clearTimeout(room.timer);
        const other = room.host === ws ? room.guest : room.host;
        if (other) { send(other, { op: 'left' }); other.close(); }
      });
    });
  });
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, a] of attempts) if (now >= a.until) attempts.delete(ip);
    for (const ws of wss.clients) {
      if (!ws.alive || (ws.room && now - ws.room.created > (ws.room.guest ? 3600000 : 600000))) { ws.terminate(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 30000);
  server.on('close', () => { clearInterval(cleanup); wss.close(); });
  return server;
}
if (require.main === module) createRelay().listen(8789, '0.0.0.0');
module.exports = { createRelay };
