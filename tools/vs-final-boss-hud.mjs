/* 验最终 Boss 血条上显示的数字（走渲染层同一条取整/千分位路径）。
   用法：node tools/vs-final-boss-hud.mjs <cdpPort> <url> */
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

await ev(`(() => { VS.Game.startAt(VS.Game.current, 1); return 1; })()`);
await sleep(1200);

/* 刷最终 Boss，把 state.boss 指过去（HUD 读的是这个引用），再推进几帧让血条更新 */
const out = await ev(`(() => {
  const g = VS.Game.current;
  const entry = VS.Levels.bosses(g.level).find(e => e.at === 720);
  g.time = 720;
  VS.Enemies.spawnBoss(g.enemies, g, entry);
  const boss = g.enemies.list[g.enemies.list.length - 1];
  g.enemies.boss = boss;             // HUD 的 boss 条读这个引用，正常流程里由刷怪逻辑设置
  for (let i = 0; i < 4; i++) VS.Game.step(g, 1/60);
  VS.Hud.update(g);
  const el = document.getElementById('bossHpText');
  const bar = document.getElementById('bossBar');
  return JSON.stringify({
    type: boss.type,
    name: boss.name,
    rawMaxHp: boss.maxHp,
    rounded: Math.round(boss.maxHp),
    hudText: el ? el.textContent : '(no el)',
    barHidden: bar ? bar.hidden : '(no bar)'
  }, null, 1);
})()`);

console.log(String(out));
ws.close();
