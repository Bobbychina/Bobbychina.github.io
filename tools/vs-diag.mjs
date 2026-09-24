/* 调试用：进游戏后读运行时状态，定位主循环是否在推进。
   用法：node tools/vs-diag.mjs <cdpPort> <url> [秒] */
const [, , cdpPort, url, secsRaw] = process.argv;
const secs = Number(secsRaw || 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });

let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n').slice(0, 3).join(' | ').slice(0, 300));
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
    errs.push('console.error: ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
};
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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
/* 关键：窗口被最小化 / 不在前台时 rAF 会被完全节流，计时器就停住。
   AGENT-CHANNEL.md 记过这条坑（量 DPS 时也踩过），打开焦点模拟。 */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });

for (let i = 0; i < 60; i++) {
  const ok = await ev(`!!(window.VS && VS.Game && document.getElementById('startBtn'))`);
  if (ok === true) break;
  await sleep(500);
}
await sleep(800);

console.log('VS 顶层:', await ev(`Object.keys(window.VS||{}).join(',')`));
console.log('VS.Game 方法:', await ev(`Object.keys(window.VS.Game||{}).join(',')`));
console.log('VS.Game 可枚举属性:', await ev(`Object.keys(window.VS.Game||{}).map(k=>k+':'+typeof VS.Game[k]).join(',')`));
console.log('有没有暴露 state:', await ev(`(() => { for (const k of Object.keys(VS)) { try { const v = VS[k]; if (v && typeof v === 'object' && 'time' in v && 'player' in v) return k; } catch(e){} } return 'none'; })()`));

console.log('\n-- 点开始 --');
console.log(await ev(`(() => { document.getElementById('startBtn').click(); return 'clicked'; })()`));

for (let s = 1; s <= Math.min(secs, 4); s++) {
  await sleep(1000);
  const snap = await ev(`(() => {
    const hudT = document.getElementById('timer');
    const hudK = document.getElementById('kills');
    return JSON.stringify({
      hudTimer: hudT && hudT.textContent,
      hudKills: hudK && hudK.textContent,
      rafAlive: typeof window.__rafCount === 'number' ? window.__rafCount : 'n/a',
      hidden: document.hidden,
      canvasSize: (() => { const c = document.getElementById('game'); return c ? c.width + 'x' + c.height : 'none'; })()
    });
  })()`);
  console.log(`  +${s}s ${snap}`);
}

console.log('\n-- rAF 心跳 2 秒 --');
await ev(`(() => { window.__rafCount = 0; const tick = () => { window.__rafCount++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`);
await sleep(2000);
console.log('  2 秒内 rAF 帧数:', await ev(`window.__rafCount`), '(理想 ~120)');

console.log('\n异常/错误:', errs.length);
errs.slice(0, 8).forEach((e) => console.log('  ' + e));
ws.close();
