(function () {
  'use strict';
  const P = window.InkOnlineProtocol;
  const $ = id => document.getElementById(id);
  const transport = new window.InkOnlineTransport();
  const held = new Set();
  const edges = new Set();
  let room = null;
  let snapshot = null;
  let snapshotAt = 0;
  let busy = false;
  let lastAction = null;
  let renderError = false;
  let lastPingAt = 0;
  let route = null;
  const ctx = $('arena').getContext('2d', { alpha: false });
  const actors = [{}, {}];
  const scene = { world: { width: 1280, height: 720, groundY: 580 }, levelIndex: 0, level: {}, cameraX: 0, state: 'playing', platforms: [], hazards: [], gates: [], checkpoints: [], projectiles: [], sceneReveal: 1, storyTime: 99, effects: [], particles: [] };
  const viewport = { width: 1280, height: 720, time: 0, shakeX: 0, shakeY: 0, flash: 0 };
  function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  function setBusy(value) { busy = value; $('create').disabled = value; $('join').disabled = value; $('retry').disabled = value; }
  function clearInput(send = true) {
    held.clear(); edges.clear();
    for (const button of document.querySelectorAll('.touch .held')) button.classList.remove('held');
    if (send && room?.state === 'playing') transport.send({ type: 'input', input: { move: 0, attack: false } });
  }
  function config() {
    const options = P.signalOptions($('signal-url').value.trim());
    const iceServers = [ { urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' } ];
    const turn = $('turn-url').value.trim();
    if (turn) {
      if (!/^turns?:[^\s]+$/i.test(turn)) throw new Error('TURN 地址应以 turn: 或 turns: 开头。');
      iceServers.push({ urls: turn, username: $('turn-user').value.trim(), credential: $('turn-password').value });
    }
    if ($('force-relay').checked && !turn) throw new Error('已选择只用中继，请先填写可用的 TURN 地址。');
    options.config = { iceServers, iceTransportPolicy: $('force-relay').checked ? 'relay' : 'all' };
    return options;
  }
  async function connect(role) {
    if (busy) return;
    let options;
    try { options = config(); } catch (error) { status(error.message, true); return; }
    const code = role === 'guest' ? P.roomCode($('room-code').value) : undefined;
    if (role === 'guest' && !code) { status('请填写完整的 10 位房间码，可以直接粘贴带空格的房间码。', true); $('room-code').focus(); return; }
    lastAction = role;
    setBusy(true); $('retry').hidden = true;
    clearInput(false); room = snapshot = null; route = null;
    try { await transport.start(role, { name: $('player-name').value, character: $('character').value }, options, code); }
    catch (error) { if (!transport.closed) status(error.message, true); }
    finally { setBusy(false); }
  }
  function resetView() {
    clearInput(false); room = snapshot = null; route = null;
    $('room').hidden = true; $('setup').hidden = false;
    $('network-badge').textContent = '尚未连接'; $('network-badge').classList.remove('connected');
    $('invite-code').textContent = '';
    setBusy(false);
  }
  function updateRoom(packet) {
    const previous = room?.state;
    room = packet;
    $('setup').hidden = true; $('room').hidden = false;
    $('room-phase').textContent = ({ waiting: '等待准备', countdown: '即将开战', playing: '论剑中', paused: '暂停，等待重连', result: '本局结束' })[room.state] || room.state;
    $('waiting').hidden = room.state !== 'waiting';
    $('battle').hidden = room.state === 'waiting';
    $('countdown').hidden = room.state !== 'countdown';
    $('countdown').textContent = room.countdown || '开';
    $('pause').hidden = room.state !== 'paused';
    if (room.state === 'paused') {
      const detail = document.createElement('span');
      const background = room.pauseReason === 'host-hidden';
      detail.textContent = background ? '房主回到本页后自动继续' : '等待对方重连，最多保留 20 秒';
      $('pause').replaceChildren(document.createTextNode(background ? '房主暂离，战斗已暂停' : '连接中断，战斗已暂停'), detail);
    }
    $('result').hidden = room.state !== 'result';
    $('surrender').disabled = !['playing', 'paused'].includes(room.state);
    if (room.state !== previous) {
      clearInput(false);
      if (room.state === 'playing') status('论剑中 · 双方操作由房主统一计算，请保持游戏页打开。');
      if (room.state === 'countdown') status('双方已准备，三秒后开战。');
      if (room.state === 'result') status('本局结束。两人都选择“再战一局”即可继续。');
      if (room.state === 'countdown') { snapshot = null; ctx.fillStyle = '#e5dfcf'; ctx.fillRect(0, 0, 1280, 720); }
      if (room.state === 'waiting') snapshot = null;
      if (room.state === 'playing') { $('arena').tabIndex = 0; $('arena').focus({ preventScroll: true }); }
    }
    const seatList = $('seats'); seatList.replaceChildren();
    room.players.forEach((player, index) => {
      const seat = document.createElement('div'); seat.className = 'seat' + (player ? '' : ' empty');
      const tag = document.createElement('small'); tag.textContent = index === room.slot ? '你 / ' + (index === 0 ? '房主' : '来客') : '对方';
      const name = document.createElement('h3'); name.textContent = player?.name || '虚席以待';
      const detail = document.createElement('p'); detail.textContent = player ? P.CHARACTERS[player.character] + ' · Lv.1' : '等待另一位行者';
      const ready = document.createElement('p'); ready.textContent = player ? (player.ready ? '已准备' : '尚未准备') : '把房间码发给朋友';
      ready.className = player?.ready ? 'prepared' : '';
      seat.append(tag, name, detail, ready); seatList.append(seat);
    });
    const own = room.players[room.slot];
    $('room-character').value = own?.character || 'nameless';
    $('room-character').disabled = room.state !== 'waiting';
    $('ready').textContent = own?.ready ? '取消准备' : '准备';
    $('rematch').textContent = own?.ready ? '已准备，等待对方' : '再战一局';
    $('rematch').disabled = !!own?.ready;
    $('network-badge').textContent = route ? (route.relay ? 'TURN 中继' : 'P2P 直连') : (transport.role === 'host' && !room.players[1] ? '房间已登记' : '对战通道已连接');
    $('network-badge').classList.add('connected');
  }
  function updateSnapshot(packet) {
    if (!room || !Array.isArray(packet.players) || packet.players.length !== 2) return;
    if (snapshot && packet.seq <= snapshot.seq) return;
    snapshot = packet; snapshotAt = performance.now();
    packet.players.forEach((actor, index) => {
      Object.assign(actors[index], actor);
      const score = $('score-' + index);
      score.querySelector('strong').textContent = (room.slot === index ? '你 · ' : '') + (room.players[index]?.name || '行者') + ' · ' + P.CHARACTERS[actor.character];
      score.querySelector('progress').max = actor.maxHp; score.querySelector('progress').value = actor.hp;
      const gauge = packet.gauges[index];
      score.querySelector('span').textContent = Math.ceil(actor.hp) + '/' + actor.maxHp + '　彩墨 ' + Math.floor(gauge.energy) + '　J ' + (gauge.j > 0 ? gauge.j.toFixed(1) : '就绪') + '　I ' + (gauge.i > 0 ? gauge.i.toFixed(1) : '就绪');
    });
    $('clock').textContent = packet.remaining;
    scene.player = actors[room.slot]; scene.enemies = [actors[1 - room.slot]];
    Object.assign(scene, { time: packet.time, effects: packet.effects, particles: packet.particles, hitStop: packet.hitStop });
    if (packet.over) {
      $('result').hidden = false;
      $('result-title').textContent = packet.winner === null ? '平分秋色' : packet.winner === room.slot ? '胜 · 落笔成锋' : '败 · 整剑再来';
      $('result-reason').textContent = packet.reason + ' · 切磋不发放单机奖励';
    }
  }
  transport.addEventListener('status', event => status(event.detail.text, event.detail.error));
  transport.addEventListener('failure', event => { resetView(); $('retry').hidden = !lastAction; status(event.detail, true); });
  transport.addEventListener('code', event => { $('invite-code').textContent = event.detail.slice(0, 5) + ' ' + event.detail.slice(5); });
  transport.addEventListener('lost', () => { clearInput(false); $('pause').hidden = false; });
  transport.addEventListener('path', event => {
    route = event.detail;
    $('network-badge').textContent = route.relay ? 'TURN 中继' : 'P2P 直连';
  });
  transport.addEventListener('packet', event => {
    const packet = event.detail;
    if (packet.type === 'room') updateRoom(packet);
    else if (packet.type === 'snapshot') updateSnapshot(packet);
    else if (packet.type === 'pong') $('ping').textContent = Math.max(0, Date.now() - packet.at) + ' ms';
    else if (packet.type === 'error' || packet.type === 'notice') status(packet.text, packet.type === 'error');
  });
  $('create').addEventListener('click', () => connect('host'));
  $('join-form').addEventListener('submit', event => { event.preventDefault(); connect('guest'); });
  $('retry').addEventListener('click', () => connect(lastAction || 'guest'));
  $('ready').addEventListener('click', () => transport.send({ type: 'ready', ready: !room?.players[room.slot]?.ready }));
  $('room-character').addEventListener('change', () => transport.send({ type: 'select', character: $('room-character').value }));
  $('rematch').addEventListener('click', () => transport.send({ type: 'rematch' }));
  $('surrender').addEventListener('click', () => transport.send({ type: 'surrender' }));
  $('leave').addEventListener('click', () => { transport.send({ type: 'leave' }); transport.close(); resetView(); status('已退出房间，可以重新创建或加入。'); });
  $('copy-code').addEventListener('click', async () => {
    const code = transport.code;
    if (!code) return;
    const invite = new URL(location.href); invite.search = ''; invite.hash = 'room=' + code;
    try { await navigator.clipboard.writeText(invite.href); status('邀请链接已复制。朋友打开链接后点击“加入房间”即可。房间码：' + code); }
    catch { status('浏览器未允许复制。请手动分享邀请链接：' + invite.href); }
  });
  const keyMap = { KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyK: 'attack' };
  const edgeMap = { KeyW: 'jump', ArrowUp: 'jump', KeyS: 'dive', ArrowDown: 'dive', Space: 'dash', KeyJ: 'heavy', KeyI: 'skill2', KeyL: 'ultimate' };
  function sendInput() {
    if (room?.state !== 'playing') return;
    const input = { move: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0), attack: held.has('attack') };
    for (const key of P.EDGES) input[key] = edges.has(key);
    edges.clear(); transport.send({ type: 'input', input });
  }
  window.addEventListener('keydown', event => {
    if (room?.state !== 'playing' || event.target.closest?.('input,select,textarea,button,[contenteditable]') || event.ctrlKey || event.altKey || event.metaKey) return;
    const hold = keyMap[event.code]; const edge = edgeMap[event.code];
    if (!hold && !edge) return;
    event.preventDefault();
    if (hold) { held.add(hold); if (hold === 'attack' && !event.repeat) edges.add('attackPress'); }
    if (edge && !event.repeat) edges.add(edge);
    sendInput();
  });
  window.addEventListener('keyup', event => { if (keyMap[event.code]) { held.delete(keyMap[event.code]); sendInput(); } });
  window.addEventListener('blur', () => clearInput());
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
  window.addEventListener('pagehide', () => transport.close());
  for (const button of $('touch').querySelectorAll('button')) {
    button.addEventListener('pointerdown', event => {
      if (room?.state !== 'playing') return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); button.classList.add('held');
      if (button.dataset.hold) held.add(button.dataset.hold);
      if (button.dataset.hold === 'attack') edges.add('attackPress');
      if (button.dataset.edge) edges.add(button.dataset.edge);
      sendInput();
    });
    const release = () => { if (button.dataset.hold) held.delete(button.dataset.hold); button.classList.remove('held'); sendInput(); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  }
  setInterval(() => {
    sendInput();
    if (room && Date.now() - lastPingAt >= 2000) { lastPingAt = Date.now(); transport.send({ type: 'ping', at: lastPingAt }); }
  }, 34);
  function draw() {
    if (snapshot && !$('battle').hidden && !renderError) {
      try {
        viewport.time = snapshot.time;
        const ahead = room?.state === 'playing' ? Math.min(0.06, (performance.now() - snapshotAt) / 1000) : 0;
        for (let index = 0; index < 2; index++) {
          const actor = snapshot.players[index];
          actors[index].actionTime = actor.actionTime + ahead;
          actors[index].x = Math.max(0, Math.min(1280, actor.x + (actor.runV || 0) * ahead));
        }
        window.InkArt.draw(ctx, scene, viewport);
        window.InkArt.drawActorOverlays?.(ctx, { player: actors[1 - room.slot], enemies: [], time: snapshot.time });
      } catch (error) { renderError = true; status('画面加载失败：' + error.message + '。请确认完整解压本版游戏。', true); console.error('[online renderer]', error); }
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  const hash = new URLSearchParams(location.hash.slice(1));
  if (P.roomCode(hash.get('room'))) $('room-code').value = P.roomCode(hash.get('room'));
  window.InkOnline = Object.freeze({ version: '2.1.0', transport, get room() { return room; }, get snapshot() { return snapshot; }, get route() { return route; } });
})();
