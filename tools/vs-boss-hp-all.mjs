/* 列出多关 / 多个 Boss 条目的实到血量，用来确认"只改了目标那一条"。
   用法：node tools/vs-boss-hp-all.mjs <cdpPort> <url> */
const [, , cdpPort, url] = process.argv;
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

const out = await ev(`(() => {
  const g = VS.Game.current, C = VS.Config;
  const rows = [];
  /* 关卡 0（第一关，走 BOSS.SCHEDULE）与关卡 1（第二关，走自己的 2 条表）各列一遍 */
  for (const lv of [0, 1]) {
    const sched = (VS.Levels.bosses(lv) || []);
    for (const entry of sched) {
      const type = C.ENEMY_TYPES[entry.type];
      if (!type) continue;
      const hp = type.hp * VS.Phases.hpMult(entry.at) * VS.Levels.statMul(lv).hp * (entry.hpMul || 1);
      rows.push({
        level: lv + 1,
        at: entry.at,
        name: entry.name || type.name,
        baseHp: type.hp,
        hpCurve: +VS.Phases.hpMult(entry.at).toFixed(4),
        levelHpMul: VS.Levels.statMul(lv).hp,
        entryHpMul: entry.hpMul || 1,
        hp: +hp.toFixed(3),
        shown: Math.round(hp)
      });
    }
  }
  return JSON.stringify(rows, null, 1);
})()`);

console.log(String(out));
ws.close();
