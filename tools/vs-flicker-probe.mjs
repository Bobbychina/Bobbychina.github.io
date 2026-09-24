/* 地面闪烁量化探针。
   判据（两层）：
     A. 相机钉死同一位置、连拍多帧 —— 地面区域应逐像素一致（有随机抖动就会不一致）
     B. 相机设成小数 x.37 与取整后的 x 各拍一帧 —— 地面区域必须一致
        （亚像素相位错位时，这两帧会差出明显的量）
   用法：node tools/vs-flicker-probe.mjs <cdpPort> <url> [静默秒数] */
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const [, , cdpPort, url, quietRaw] = process.argv;
const QUIET = Number(quietRaw || 3.5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- PNG 解码（只取 RGBA） ---------- */
function decodePNG(buf) {
  let off = 8, w = 0, h = 0, colorType = 0, plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); colorType = d[9]; }
    else if (type === 'PLTE') plte = Buffer.from(d);
    else if (type === 'tRNS') trns = Buffer.from(d);
    else if (type === 'IDAT') idat.push(Buffer.from(d));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = CH, stride = w * bpp, o = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = o.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? o.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev ? prev[i] : 0, c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[i] = v & 0xff;
    }
  }
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * stride + x * bpp, q = (y * w + x) * 4;
    if (colorType === 6) { px[q] = o[s]; px[q+1] = o[s+1]; px[q+2] = o[s+2]; px[q+3] = o[s+3]; }
    else if (colorType === 2) { px[q] = o[s]; px[q+1] = o[s+1]; px[q+2] = o[s+2]; px[q+3] = 255; }
    else if (colorType === 3) { const i = o[s]*3; px[q]=plte[i]; px[q+1]=plte[i+1]; px[q+2]=plte[i+2]; px[q+3]=(trns&&o[s]<trns.length)?trns[o[s]]:255; }
  }
  return { w, h, px };
}

/* 只统计"地面条带"：取画面中下部、避开中央实体与 HUD */
function groundBand(img) {
  const y0 = Math.round(img.h * 0.55), y1 = Math.round(img.h * 0.95);
  const out = [];
  for (let y = y0; y < y1; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 4;
    out.push(img.px[i], img.px[i + 1], img.px[i + 2]);
  }
  return out;
}
function meanAbsDiff(a, b) {
  let s = 0, n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}
function changedRatio(a, b, thr = 8) {
  let c = 0, n = Math.min(a.length, b.length) / 3;
  for (let i = 0; i < n; i++) {
    const j = i * 3;
    if (Math.abs(a[j] - b[j]) > thr || Math.abs(a[j+1] - b[j+1]) > thr || Math.abs(a[j+2] - b[j+2]) > thr) c++;
  }
  return c / n;
}

/* ---------- CDP ---------- */
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
const frame = async () => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (!r.result?.data) throw new Error('截图失败');
  return decodePNG(Buffer.from(r.result.data, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });

for (let i = 0; i < 90; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(400);
}
await sleep(800);
await ev(`document.getElementById('startBtn').click()`);
await sleep(1200);

const checks = [];
const ok = (n, c, extra = '') => { checks.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };

/* 静默：清场、停刷怪，让"相机不动时画面也不该变"这个前提成立 */
await ev(`(() => {
  const g = VS.Game.current;
  g.enemies.list.length = 0; g.pickups.list.length = 0;
  g.player.hp = g.player.maxHp;
  g.spawnFrozen = true;
  if (!window.__origStep) window.__origStep = VS.Game.step;
  return 'silenced';
})()`);
await sleep(400);

/* --- A. 相机钉死，连拍 5 帧 --- */
const stills = [];
for (let i = 0; i < 5; i++) {
  await ev(`(() => { const g = VS.Game.current; g.enemies.list.length = 0; g.pickups.list.length = 0; g.player.hp = g.player.maxHp; g.player.moving = false; return 1; })()`);
  await sleep(120);
  stills.push(groundBand(await frame()));
}
let worstStill = 0;
for (let i = 1; i < stills.length; i++) worstStill = Math.max(worstStill, meanAbsDiff(stills[0], stills[i]));
const worstStillRatio = (() => { let w = 0; for (let i = 1; i < stills.length; i++) w = Math.max(w, changedRatio(stills[0], stills[i])); return w; })();
ok('A. 相机静止时地面逐像素稳定（无每帧随机抖动）', worstStill < 1.0 && worstStillRatio < 0.01,
   `平均差 ${worstStill.toFixed(3)}，变化像素占比 ${(worstStillRatio * 100).toFixed(2)}%`);

/* --- B. 小数相机 vs 取整相机 ---
   直接调渲染器、用合成相机拍帧 —— 不走主循环，避免"相机被拉回玩家身上"污染测量。
   先把游戏步进冻结（不清场，避免动到不确定的内部结构），这样两次渲染的场景完全一致，
   唯一变量就是相机。
   取整若生效，1000.37 与 1000 必须渲染出**逐字节相同**的一帧；
   同时用 1000 vs 1010 做对照（必须明显不同，证明这个测法真的能量出差异）。 */
await ev(`(() => {
  const g = VS.Game.current;
  g.spawnFrozen = true;
  if (!window.__origStep) window.__origStep = VS.Game.step;
  VS.Game.step = function () {};        // 冻结步进：实体不再移动
  return 'frozen';
})()`);
await sleep(300);

const renderAt = async (cx, cy) => {
  const dataUrl = await ev(`(() => {
    const g = VS.Game.current, r = g.deps.renderer;
    g.shake = 0;
    const cam = g.world.camera;
    const bx = cam.x, by = cam.y;
    cam.x = ${cx}; cam.y = ${cy};
    VS.Renderer.render(r, g, 1, 1 / 60);
    const url = r.canvas.toDataURL('image/png');
    cam.x = bx; cam.y = by;
    return url;
  })()`);
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) throw new Error('渲染取帧失败: ' + String(dataUrl).slice(0, 120));
  return decodePNG(Buffer.from(dataUrl.split(',')[1], 'base64'));
};

const shotFrac = groundBand(await renderAt(1000.37, 1000.37));
const shotWhole = groundBand(await renderAt(1000, 1000));
const shotFar = groundBand(await renderAt(1010, 1010));

const subPixel = meanAbsDiff(shotFrac, shotWhole);
const subPixelRatio = changedRatio(shotFrac, shotWhole);
const control = meanAbsDiff(shotWhole, shotFar);

ok('B. 小数相机与整数相机渲染出同一帧（无亚像素相位错位）', subPixel < 0.5 && subPixelRatio < 0.005,
   `小数 vs 整数 平均差 ${subPixel.toFixed(3)} / 变化像素 ${(subPixelRatio * 100).toFixed(2)}%；` +
   `对照（相机差 10px）平均差 ${control.toFixed(2)}`);

/* 对照必须明显更大，否则说明这个测法根本量不出东西（假绿） */
ok('B′. 测法有区分度（相机差 10px 时必须明显不同）', control > 5,
   `对照平均差 ${control.toFixed(2)}`);

/* 还原步进，后面的 C 项要真的走动 */
await ev(`(() => { if (window.__origStep) VS.Game.step = window.__origStep; VS.Game.current.spawnFrozen = false; return 'restored'; })()`);
await sleep(300);

/* --- C. 走动时相邻帧的差应该只是"平移量"，不该有额外噪声 --- */
await ev(`(() => { const g = VS.Game.current; g.spawnFrozen = false; return 1; })()`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
const moving = [];
for (let i = 0; i < 4; i++) { await sleep(140); moving.push(groundBand(await frame())); }
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 });
let movingMax = 0;
for (let i = 1; i < moving.length; i++) movingMax = Math.max(movingMax, meanAbsDiff(moving[i - 1], moving[i]));
console.log(`\n（参考）走动时相邻帧地面平均差：${movingMax.toFixed(2)} —— 这是真实位移造成的，应当明显大于静止值 ${worstStill.toFixed(3)}`);
ok('C. 走动确实在推进画面（不是卡住）', movingMax > worstStill * 5,
   `走动 ${movingMax.toFixed(2)} >> 静止 ${worstStill.toFixed(3)}`);

const passed = checks.filter(Boolean).length;
console.log(`\n闪烁探针：${passed}/${checks.length}`);
ws.close();
process.exit(passed === checks.length ? 0 : 1);
