'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { createRelay } = require('./server.cjs');

test('private two-player rooms, agreed routes, failover and teardown', { timeout: 12000 }, async t => {
  const server = createRelay().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clients = [];
  t.after(() => { clients.forEach(ws => ws.terminate()); server.close(); });
  async function player(op, code) {
    const ws = new WebSocket('ws://127.0.0.1:' + server.address().port + '/games/racing3d/relay', { origin: 'https://bobbycn.cc' });
    clients.push(ws);
    const packets = [], events = new (require('node:events').EventEmitter)();
    ws.on('message', data => { packets.push(JSON.parse(data)); events.emit('packet'); });
    await once(ws, 'open');
    const send = msg => ws.send(JSON.stringify(msg));
    const next = async () => { if (!packets.length) await once(events, 'packet'); return packets.shift(); };
    send({ op, code, rules: 'classic-v1' });
    return { ws, send, next };
  }
  const a = await player('create');
  const { code } = await a.next(); assert.match(code, /^\d{6}$/);
  const b = await player('join', code);
  assert.equal((await b.next()).code, code);
  assert.equal((await a.next()).op, 'paired'); assert.equal((await b.next()).op, 'paired');
  const c = await player('join', code); assert.equal((await c.next()).reason, 'full');
  a.send({ op: 'direct' }); b.send({ op: 'direct' });
  assert.equal((await a.next()).route, 'direct'); assert.equal((await b.next()).route, 'direct');
  b.send({ op: 'fallback' });
  assert.equal((await a.next()).route, 'relay'); assert.equal((await b.next()).route, 'relay');
  const packet = { type: 'input', input: { accel: true } };
  b.send({ op: 'game', packet }); assert.deepEqual((await a.next()).packet, packet);
  b.send({ op: 'game', packet: { type: 'race' } });
  assert.equal((await b.next()).reason, 'invalid'); assert.equal((await a.next()).op, 'left');
  const late = await player('join', code); assert.equal((await late.next()).reason, 'missing');
});
