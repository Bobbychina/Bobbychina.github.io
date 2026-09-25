/* 量 Boss 实际血量：按时间表把两个 Boss 各刷一次，读回 e.hp 与当时的各段乘区。
   用法：node tools/vs-boss-hp.mjs <cdpPort> <url> <levelIndex> */
const [, , cdpPort, url, levelRaw] = process.argv;
const level = Number(levelRaw || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 等 */ }
  if (!target) await sleep(500);
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }); } }, ms);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 90; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(400);
}
await sleep(800);

/* 明确进指定关卡（覆盖存档里可能的关卡残留） */
await ev(`(() => { VS.Game.startAt(VS.Game.current, ${level}); return 1; })()`);
await sleep(1200);

const rows = await ev(`(() => {
  const g = VS.Game.current;
  const C = VS.Config;
  const out = [];
  const schedule = (VS.Levels && VS.Levels.bosses) ? VS.Levels.bosses(g.level) : C.BOSS.SCHEDULE;

  for (const entry of schedule) {
    const type = C.ENEMY_TYPES[entry.type];
    if (!type) { out.push({ at: entry.at, type: entry.type, error: 'no such enemy type' }); continue; }
    /* 把游戏时间拨到该条目，再走它自己的生成路径，读回真实 hp */
    g.time = entry.at;
    const before = g.enemies.list.length;
    VS.Enemies.spawnBoss(g.enemies, g, entry);
    const made = g.enemies.list.length > before ? g.enemies.list[g.enemies.list.length - 1] : null;
    if (!made) { out.push({ at: entry.at, type: entry.type, error: 'spawnBoss 没造出实体' }); continue; }
    out.push({
      at: entry.at,
      type: entry.type,
      name: entry.name || type.name,
      entryHpMul: entry.hpMul || 1,
      baseHp: type.hp,
      hpCurve: VS.Phases.hpMult(entry.at),
      levelHpMul: VS.Levels.statMul(g.level).hp,
      actualHp: made.hp,
      maxHp: made.maxHp === undefined ? null : made.maxHp
    });
  }
  return JSON.stringify({ level: g.level, levelName: VS.Levels.label(g.level), rows: out }, null, 1);
})()`);

console.log(String(rows));
ws.close();
