/* 平移一致性探针：判断走动时地面是"整体平移"还是"在重采样/闪"。
   原理：相机沿 x 走整数 1 像素时，新帧的地面带应当精确等于旧帧左移 1 像素。
        残差大 → 纹理没有干净地平移，存在亚像素相位或滤波抖动（玩家看到的"闪"）。
   用法：node tools/vs-shift-probe.mjs <cdpPort> <url> */
import zlib from 'node:zlib';

const [, , cdpPort, url] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const get = (img, x, y) => { const i = (y * img.w + x) * 4; return [img.px[i], img.px[i+1], img.px[i+2]]; };

/* 比较 A 与 B：B 是否等于 A 左移 dx 像素（在给定条带内） */
function shiftResidual(A, B, dx, y0, y1, xMargin) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = xMargin; x < A.w - xMargin; x++) {
      const a = get(A, x, y);
      const b = get(B, x - dx, y);
      sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      n += 3;
    }
  }
  return sum / n;
}
/* 基线：同一帧自比（理论上 0），以及"不平移直接比"（应该很大） */
function directDiff(A, B, y0, y1) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < A.w; x++) {
    const a = get(A, x, y), b = get(B, x, y);
    sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    n += 3;
  }
  return sum / n;
}

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
await ev(`document.getElementById('startBtn').click()`);
await sleep(1200);
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(600);

/* 冻结步进 + 钉住相机，用渲染器自身出图，保证确定性 */
await ev(`(() => {
  const g = VS.Game.current;
  g.spawnFrozen = true;
  if (!window.__origStep) window.__origStep = VS.Game.step;
  VS.Game.step = function () {};
  return 'frozen';
})()`);
await sleep(300);

const renderAt = async (cx, cy) => {
  const u = await ev(`(() => {
    const g = VS.Game.current, r = g.deps.renderer;
    g.shake = 0;
    const cam = g.world.camera, bx = cam.x, by = cam.y;
    cam.x = ${cx}; cam.y = ${cy};
    VS.Renderer.render(r, g, 1, 1/60);
    const url = r.canvas.toDataURL('image/png');
    cam.x = bx; cam.y = by;
    return url;
  })()`);
  if (typeof u !== 'string' || !u.startsWith('data:image/png')) throw new Error('取帧失败: ' + String(u).slice(0, 120));
  return decodePNG(Buffer.from(u.split(',')[1], 'base64'));
};

const y0 = 360, y1 = 660, margin = 4;

/* 整数平移 +1：新帧应等于旧帧左移 1px */
const A1 = await renderAt(1200, 1200);
const B1 = await renderAt(1201, 1200);
const res1 = shiftResidual(B1, A1, 1, y0, y1, margin);
const direct1 = directDiff(B1, A1, y0, y1);

/* 整数平移 +37（远小于贴图 128 周期） */
const A2 = await renderAt(1200, 1200);
const B2 = await renderAt(1237, 1200);
const res37 = shiftResidual(B2, A2, 37, y0, y1, margin);
const direct37 = directDiff(B2, A2, y0, y1);

/* 亚像素 +0.37：取整后应当与不移动完全一致 */
const A3 = await renderAt(1200, 1200);
const B3 = await renderAt(1200.37, 1200);
const sub = directDiff(B3, A3, y0, y1);

console.log('=== 平移一致性（地面条带 y=%d~%d）===', y0, y1);
console.log(`整数 +1px ：平移对齐残差 ${res1.toFixed(3)}   不对齐直接比 ${direct1.toFixed(2)}`);
console.log(`整数 +37px：平移对齐残差 ${res37.toFixed(3)}   不对齐直接比 ${direct37.toFixed(2)}`);
console.log(`亚像素+.37：与不移动的直接差 ${sub.toFixed(3)}`);
console.log('');
const pass1 = res1 < 0.5, pass37 = res37 < 0.5, passSub = sub < 0.5;
console.log(`  ${pass1 ? 'PASS' : 'FAIL'} 整数平移 1px 是干净的整像素平移（残差应≈0）`);
console.log(`  ${pass37 ? 'PASS' : 'FAIL'} 整数平移 37px 是干净的整像素平移（残差应≈0）`);
console.log(`  ${passSub ? 'PASS' : 'FAIL'} 亚像素相机被取整吞掉（应与不移动完全相同）`);
const okN = [pass1, pass37, passSub].filter(Boolean).length;
console.log(`\n平移探针：${okN}/3`);

await ev(`(() => { if (window.__origStep) VS.Game.step = window.__origStep; return 1; })()`);
ws.close();
process.exit(okN === 3 ? 0 : 1);
