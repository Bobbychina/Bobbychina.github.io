/* 关卡美术目视检查：进入第一关 / 第二关各玩几秒，截图落盘。
   用法：node tools/vs-levelshot.mjs <cdpPort> <url> <outDir> */
import fs from 'node:fs/promises';

const [, , cdpPort, url, outDir = 'tools/level-shots'] = process.argv;
await fs.mkdir(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 还没起来 */ }
  if (!target) await sleep(500);
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map(); const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 200));
};
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }); } }, ms);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 });
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) { await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log(`  → ${outDir}/${name}.png`); }
};

await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
/* 窗口最小化/不在前台会让 rAF 被完全节流，动画与计时器都停 —— 打开焦点模拟 */
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

const waitReady = async (ms = 60000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const raw = String(await ev(`JSON.stringify({ r: document.readyState, btn: !!document.getElementById('startBtn'), n: document.querySelectorAll('script[src^="js/"]').length })`));
    try { const o = JSON.parse(raw); if (o.r === 'complete' && o.btn && o.n >= 20) return o; } catch { /* 继续等 */ }
    await sleep(500);
  }
  return null;
};

const state = () => ev(`(() => {
  const g = window.VS && VS.Game && VS.Game.state ? VS.Game.state : null;
  const p = g && g.player;
  return JSON.stringify({
    level: g ? g.level : null,
    ground: (window.VS && VS.Levels && g) ? VS.Levels.ground(g.level) : null,
    t: g ? Math.round(g.time) : null,
    hp: p ? Math.round(p.hp) : null,
    kills: g ? (g.kills | 0) : null,
    ready: !!(window.VS && VS.Assets && VS.Assets.ready && VS.Assets.ready('ground'))
  });
})()`);

for (const [label, btn] of [['l1', 'startBtn'], ['l2', 'previewL2Btn']]) {
  console.log(`\n== ${label} ==`);
  await send('Page.navigate', { url });
  if (!(await waitReady())) console.log('  WARN 就绪超时');
  await sleep(1200);

  const clicked = await ev(`(() => { const b = document.getElementById('${btn}'); if (!b) return 'NO_BTN'; b.click(); return 'clicked'; })()`);
  console.log(`  按钮 ${btn}: ${clicked}`);

  /* 宠物 / 升级面板会挡着世界：先点宠物卡，再用键盘 1 把升级面板选掉（可能连续弹几次） */
  for (let i = 0; i < 6; i++) {
    await ev(`(() => {
      const box = document.getElementById('petCards');
      const card = box && box.querySelector('.card');
      if (card) { card.click(); return 'pet'; }
      const lv = document.getElementById('levelCards') || document.getElementById('cards');
      const lc = lv && lv.querySelector('.card');
      if (lc) { lc.click(); return 'levelup'; }
      return 'none';
    })()`);
    await sleep(700);
  }

  /* 让它真的跑起来、怪刷出来，别只截到空场 */
  await sleep(9000);
  console.log('  state: ' + await state());
  await shot(`${label}-full`);
  await shot(`${label}-world`);
}

console.log(`\n未捕获异常: ${errs.length}`);
errs.slice(0, 5).forEach((e) => console.log('  ' + e));
ws.close();
