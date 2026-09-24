/* 皮肤系统专项自检：UI 渲染 / 点击换肤 / 存档落盘 / 换肤后图集真的换了帧。
   用法：node tools/vs-skin-probe.mjs <cdpPort> <url> <outDir> */
import fs from 'node:fs/promises';

const [, , cdpPort, url, outDir = 'tools/skin-shots'] = process.argv;
await fs.mkdir(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 等 */ }
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

const checks = [];
const ok = (n, c, extra = '') => { checks.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };

await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });

/* 等就绪：index.html 里的 #skinList 是静态的，但按钮由 main.js 的 renderSkinRow() 生成，
   而它在 boot 里比 sprites.js 晚 —— 只等 PlayerSkins 会检查得太早
   （线上实测过：#skinList 有 4 个子元素，但早查会读到 0 个，误报 FAIL）。
   所以这里必须等到按钮真的出现。 */
let uiReady = false;
for (let i = 0; i < 90; i++) {
  const r = await ev(`document.querySelectorAll('#skinList .skin-chip').length`);
  if (r >= 2) { uiReady = true; break; }
  await sleep(400);
}
if (!uiReady) console.log('  WARN 等待皮肤按钮超时（45s），继续按当前 DOM 断言');
await sleep(400);

/* ① 图集里每个皮肤都有三方向的组 */
const groups = await ev(`JSON.stringify({
  skins: (VS.PlayerSkins||[]).map(s=>s.id),
  groups: Object.keys(VS.SpriteGroups).filter(k=>k.indexOf('player_')===0)
})`);
const g = JSON.parse(String(groups));
let allGroups = true;
for (const sid of g.skins) {
  for (const d of ['down', 'up', 'side']) {
    if (!g.groups.includes(`player_${sid}_${d}`)) { allGroups = false; console.log(`   缺组 player_${sid}_${d}`); }
  }
}
ok(`① 图集里 ${g.skins.length} 套皮肤 × 3 方向都有独立动画组`, allGroups && g.skins.length >= 4, `skins=${g.skins.join(',')}`);

/* ② 每套皮肤四帧且帧名各不相同 */
const frames = await ev(`JSON.stringify((VS.PlayerSkins||[]).map(s=>{
  const l = VS.SpriteGroups['player_'+s.id+'_down'] || [];
  return { id: s.id, n: l.length, uniq: new Set(l).size };
}))`);
const f = JSON.parse(String(frames));
ok('② 每套皮肤朝下方向有 4 帧且帧唯一', f.every((x) => x.n === 4 && x.uniq === 4), JSON.stringify(f));

/* ③ 开始面板渲染了皮肤按钮，且当前选中项高亮 */
const ui = await ev(`JSON.stringify({
  n: document.querySelectorAll('#skinList .skin-chip').length,
  on: (document.querySelector('#skinList .skin-chip.on')||{}).getAttribute ? document.querySelector('#skinList .skin-chip.on').getAttribute('data-skin') : null,
  labels: [...document.querySelectorAll('#skinList .skin-chip')].map(b=>b.getAttribute('data-skin'))
})`);
const u = JSON.parse(String(ui));
ok('③ 开始面板渲染出皮肤按钮且有一项高亮', u.n >= 4 && !!u.on, JSON.stringify(u));

/* ④ 皮肤行没有把「全站榜」挤出首屏（这是 ⑦‴ 守的那条线） */
const fit = await ev(`(() => {
  const p = document.getElementById('panel-start');
  const lb = document.getElementById('lbList') || document.querySelector('.lb-list') || document.querySelector('.lb .list');
  return JSON.stringify({ panelBottom: p ? Math.round(p.getBoundingClientRect().bottom) : null,
                          lbBottom: lb ? Math.round(lb.getBoundingClientRect().bottom) : null,
                          vh: innerHeight });
})()`);
const ft = JSON.parse(String(fit));
ok('④ 皮肤行没把榜单顶出首屏', ft.lbBottom === null || ft.lbBottom <= ft.vh, JSON.stringify(ft));

await shot('panel-with-skins');

/* ⑤ 点击第二套皮肤：UI 高亮切换 + 存档落盘 */
const pick = await ev(`(() => {
  const btns = [...document.querySelectorAll('#skinList .skin-chip')];
  if (btns.length < 2) return 'too-few';
  const want = btns[1].getAttribute('data-skin');
  btns[1].click();
  const saved = JSON.parse(localStorage.getItem(VS.Save.KEY) || '{}');
  const on = (document.querySelector('#skinList .skin-chip.on')||{}).getAttribute ? document.querySelector('#skinList .skin-chip.on').getAttribute('data-skin') : null;
  return JSON.stringify({ want, on, saved: saved.playerSkin });
})()`);
const pk = JSON.parse(String(pick));
ok('⑤ 点击换肤：高亮切过去且写进了存档', pk.on === pk.want && pk.saved === pk.want, String(pick));

/* ⑥ 换肤后开局，渲染层真的用了新皮肤：抽查缓存里被取用的帧名 */
const used = await ev(`(() => {
  const g = VS.Game.current || VS.Game.create({});
  const skin = (g.data && g.data.playerSkin) || 'witch';
  const list = VS.SpriteGroups['player_' + skin + '_down'] || [];
  return JSON.stringify({ skin, names: list, ready: list.map(n => VS.Assets.ready(n)) });
})()`);
const uu = JSON.parse(String(used));
ok('⑥ 换肤后该皮肤的 4 帧图都已解码就绪', uu.names.length === 4 && uu.ready.every(Boolean), String(used));

/* ⑦ 存档里皮肤字段能正确读回（load 的字符串分支） */
const reload = await ev(`(() => {
  const before = JSON.parse(localStorage.getItem(VS.Save.KEY) || '{}').playerSkin;
  const loaded = VS.Save.load().playerSkin;
  return JSON.stringify({ before, loaded, kept: before === loaded });
})()`);
const rl = JSON.parse(String(reload));
ok('⑦ 存档读回时 playerSkin 没被丢掉（字符串分支）', rl.kept, String(reload));

await shot('panel-after-switch');

console.log(`\n未捕获异常: ${errs.length}`);
errs.slice(0, 5).forEach((e) => console.log('  ' + e));

const passed = checks.filter(Boolean).length;
console.log(`\n皮肤探针：${passed}/${checks.length}`);
ws.close();
process.exit(passed === checks.length ? 0 : 1);
