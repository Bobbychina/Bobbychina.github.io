/* 一次性排查：在页面里看皮肤行的真实状态。
   用法：node tools/vs-dbg-skin.mjs <cdpPort> <url> */
const [, , cdpPort, url] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n').slice(0, 3).join(' | ').slice(0, 400));
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
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });

for (let i = 0; i < 60; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(500);
}
await sleep(2500);

console.log('PlayerSkins 是数组吗:', await ev(`Array.isArray(window.VS && VS.PlayerSkins)`));
console.log('PlayerSkins 长度:', await ev(`(window.VS && VS.PlayerSkins || []).length`));
console.log('#skinList 存在:', await ev(`!!document.getElementById('skinList')`));
console.log('#skinList innerHTML 长度:', await ev(`(document.getElementById('skinList')||{}).innerHTML ? document.getElementById('skinList').innerHTML.length : 'n/a'`));
console.log('#skinList 子元素数:', await ev(`document.querySelectorAll('#skinList > *').length`));
console.log('#skinRow 存在:', await ev(`!!document.getElementById('skinRow')`));
console.log('#skinRow 是否可见:', await ev(`(() => { const e = document.getElementById('skinRow'); if (!e) return 'no-el'; const r = e.getBoundingClientRect(); return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display }); })()`));
console.log('开始面板是否隐藏:', await ev(`(() => { const p = document.getElementById('panel-start'); return p ? (p.hidden ? 'hidden' : 'visible') : 'no-panel'; })()`));
console.log('渲染器里 player_ 开头的组数:', await ev(`Object.keys(VS.SpriteGroups||{}).filter(k=>k.indexOf('player_')===0).length`));

console.log('\n异常/错误:', errs.length);
errs.slice(0, 8).forEach((e) => console.log('  ' + e));
ws.close();
