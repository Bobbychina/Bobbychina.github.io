/* 把指定类型的一群怪摆到玩家周围，再直接调渲染器出图 —— 用来评审怪的模型在游戏里的实际观感
   （屏幕放大倍率、彼此挨着的辨识度、和地面的对比都会影响判断，单看 sprite sheet 不够）。
   用法：node tools/vs-mob-shot.mjs <cdpPort> <url> <out.png> <type,type,...> [levelIndex] */
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

const [, , cdpPort, url, out, typesRaw, levelRaw] = process.argv;
const types = String(typesRaw || 'brute,elite').split(',').map((s) => s.trim()).filter(Boolean);
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
/* 视口必须**比浏览器窗口小**，否则画布底部会被窗口裁掉，摆在下方的东西就看不见了 */
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 90; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(400);
}
await sleep(800);
/* 页面里那个 900x607 的 override 可能被别处改过，进游戏前再钉一次 */
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 560, deviceScaleFactor: 1, mobile: false });
await sleep(400);

/* 进关卡 + 冻结步进（怪不会跑掉也不会掉血） */
await ev(`(() => {
  const g = VS.Game.current;
  VS.Game.startAt(g, ${level});
  if (!window.__origStep) window.__origStep = VS.Game.step;
  VS.Game.step = function () {};
  return 1;
})()`);
await sleep(900);

/* 不猜坐标系：先渲染一帧，再量出玩家在**画布像素**上的实际位置（紫色光环中心），
   然后用它反推"世界坐标 -> 画布像素"的偏移，最后按画布坐标摆怪。
   试错两次都是因为假设 cam = player - viewport/2，实际不是。 */
const playerPix = JSON.parse(String(await ev(`(() => {
  const g = VS.Game.current, r = g.deps.renderer, c = r.canvas, ctx = c.getContext('2d');
  const p = g.player;
  g.shake = 0;
  g.enemies.list.length = 0;
  VS.Renderer.render(r, g, 3, 1/60);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  /* 玩家脚下有一圈紫色光环（drawAura），找它的红色分量最高的像素群 */
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      const r0 = d[i], g0 = d[i+1], b0 = d[i+2];
      if (b0 > 90 && r0 > 70 && b0 > g0 + 30 && r0 > g0 + 20) { sx += x; sy += y; n++; }
    }
  }
  return JSON.stringify({
    canvas: c.width + 'x' + c.height,
    playerWorld: [Math.round(p.x), Math.round(p.y)],
    auraSamples: n,
    playerPix: n ? [Math.round(sx / n), Math.round(sy / n)] : null
  });
})()`)));
console.log('玩家定位: ' + JSON.stringify(playerPix));

/* 世界 -> 画布：画布坐标 = 世界坐标 - (玩家世界 - 玩家画布)
   反过来：世界坐标 = 玩家世界 + (目标画布 - 玩家画布)
   直接用玩家做相对换算，不引入"偏移"这个容易搞反的中间量。 */
const pw = playerPix.playerWorld, pp = playerPix.playerPix || [450, 264];

const info = await ev(`(() => {
  const g = VS.Game.current, C = VS.Config;
  const c = g.deps.renderer.canvas;
  const PW = { x: ${pw[0]}, y: ${pw[1]} };   // 玩家世界坐标
  const PP = { x: ${pp[0]}, y: ${pp[1]} };   // 玩家画布坐标
  const toWorld = (px, py) => ({ x: PW.x + (px - PP.x), y: PW.y + (py - PP.y) });
  const types = ${JSON.stringify(types)};
  const placed = [];
  types.forEach((t, ti) => {
    const def = C.ENEMY_TYPES[t];
    if (!def) return;
    const py = Math.round(c.height * 0.28 + ti * (c.height * 0.32));
    for (let i = 0; i < 5; i++) {
      const px = Math.round(c.width * 0.5 + (i - 2) * 74);
      const w = toWorld(px, py);
      const e = VS.Enemies.spawn(g.enemies, def, g, { x: w.x, y: w.y });
      if (e) { e.hp = e.maxHp; placed.push(t); }
    }
  });
  VS.Renderer.render(g.deps.renderer, g, 3, 1/60);
  const rr = g.deps.renderer;
  const px2 = g.enemies.list.slice(0, 3).map((e) => [Math.round(e.x - rr.camX), Math.round(e.y - rr.camY)]);
  return JSON.stringify({
    level: g.level, levelName: VS.Levels.label(g.level), placed: placed.length, types,
    listLen: g.enemies.list.length, canvas: c.width + 'x' + c.height,
    firstThreeCanvasPix: px2
  });
})()`);
console.log(String(info));

const dataUrl = await ev(`(() => {
  const g = VS.Game.current, r = g.deps.renderer;
  g.shake = 0;
  VS.Renderer.render(r, g, 3, 1/60);
  return r.canvas.toDataURL('image/png');
})()`);
if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
  console.log('FAIL 取帧: ' + String(dataUrl).slice(0, 200));
  process.exit(1);
}
const img = decodePNG(Buffer.from(dataUrl.split(',')[1], 'base64'));
await fs.writeFile(out, encodePNG(img.w, img.h, Buffer.from(img.px)));
console.log(`[vs-mob-shot] level=${level} types=${types.join('+')} → ${out} (${img.w}×${img.h})`);

await ev(`(() => { if (window.__origStep) VS.Game.step = window.__origStep; return 1; })()`);
ws.close();
