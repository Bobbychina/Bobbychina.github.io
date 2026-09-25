/* 干净截图：直接调渲染器出图，不受任何 UI 面板遮挡/压暗影响。
   用法：node tools/vs-shot-clean.mjs <cdpPort> <url> <out.png> <levelIndex> */
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const [, , cdpPort, url, out, levelRaw] = process.argv;
const level = Number(levelRaw || 0);
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

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tt = Buffer.from(t, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([tt, d])), 0); return Buffer.concat([l, tt, d, c]); };
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 90; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(400);
}
await sleep(800);

/* 进指定关卡，喂饱一点怪与经验球，让画面有内容 */
await ev(`(() => {
  const g = VS.Game && VS.Game.current;
  if (!g) return 'no-game';
  VS.Game.startAt(g, ${level});
  return 'started';
})()`);
await sleep(1500);

/* 直接调渲染器出图：不经过 DOM，所以面板/压暗都影响不到 */
const dataUrl = await ev(`(() => {
  const g = VS.Game.current, r = g.deps.renderer;
  g.shake = 0;
  const cam = g.world.camera;
  cam.x = 1200; cam.y = 1000;
  VS.Renderer.render(r, g, 12, 1/60);
  return r.canvas.toDataURL('image/png');
})()`);
if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
  console.log('FAIL 取帧: ' + String(dataUrl).slice(0, 160));
  process.exit(1);
}
const img = decodePNG(Buffer.from(dataUrl.split(',')[1], 'base64'));
await fs.writeFile(out, encodePNG(img.w, img.h, Buffer.from(img.px)));
console.log(`[vs-shot-clean] level=${level} → ${out} (${img.w}×${img.h})`);
ws.close();
