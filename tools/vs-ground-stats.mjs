/* 分析线上两张底图的配色与结构：为"重做地表"提供精确基线。
   用法：node tools/vs-ground-stats.mjs [精灵名...]  （默认 ground ground_l2） */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LIVE = path.join(ROOT, 'games/vampire-survivors/js/render/sprites.js');

function decodePNG(buf) {
  let off = 8, w = 0, h = 0, depth = 0, colorType = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const d = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; colorType = d[9]; interlace = d[12]; }
    else if (type === 'PLTE') plte = Buffer.from(d);
    else if (type === 'tRNS') trns = Buffer.from(d);
    else if (type === 'IDAT') idat.push(Buffer.from(d));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = CH, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
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
    const s = y * stride + x * bpp, d = (y * w + x) * 4;
    if (colorType === 6) { px[d] = out[s]; px[d+1] = out[s+1]; px[d+2] = out[s+2]; px[d+3] = out[s+3]; }
    else if (colorType === 2) { px[d] = out[s]; px[d+1] = out[s+1]; px[d+2] = out[s+2]; px[d+3] = 255; }
    else if (colorType === 3) { const i = out[s]*3; px[d]=plte[i]; px[d+1]=plte[i+1]; px[d+2]=plte[i+2]; px[d+3]=(trns&&out[s]<trns.length)?trns[out[s]]:255; }
  }
  return { w, h, px };
}

const src = fs.readFileSync(LIVE, 'utf8');
const win = {}; win.window = win; win.VS = win.VS || {};
new Function('window', 'VS', src)(win, win.VS);

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['ground', 'ground_l2'];

for (const name of names) {
  const buf = Buffer.from(String(win.VS.SpriteData[name].uri).replace(/^data:image\/png;base64,/, ''), 'base64');
  const { w, h, px } = decodePNG(buf);

  const hist = new Map();
  for (let i = 0; i < w * h; i++) {
    const k = `${px[i*4]},${px[i*4+1]},${px[i*4+2]}`;
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]);

  /* 亮度 / 色相统计 */
  let sr = 0, sg = 0, sb = 0, minL = 999, maxL = -1;
  for (const [k, n] of hist) {
    const [r, g, b] = k.split(',').map(Number);
    sr += r * n; sg += g * n; sb += b * n;
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    minL = Math.min(minL, L); maxL = Math.max(maxL, L);
  }
  const N = w * h;

  /* 接缝检查：左右列 / 上下行的平均绝对差，对比内部相邻列 */
  const colDiff = (x1, x2) => { let s = 0; for (let y = 0; y < h; y++) { const a=(y*w+x1)*4, b=(y*w+x2)*4; s += Math.abs(px[a]-px[b]) + Math.abs(px[a+1]-px[b+1]) + Math.abs(px[a+2]-px[b+2]); } return s / h / 3; };
  const rowDiff = (y1, y2) => { let s = 0; for (let x = 0; x < w; x++) { const a=(y1*w+x)*4, b=(y2*w+x)*4; s += Math.abs(px[a]-px[b]) + Math.abs(px[a+1]-px[b+1]) + Math.abs(px[a+2]-px[b+2]); } return s / w / 3; };
  let innerCol = 0; for (let x = 0; x < w - 1; x++) innerCol += colDiff(x, x + 1); innerCol /= w - 1;
  let innerRow = 0; for (let y = 0; y < h - 1; y++) innerRow += rowDiff(y, y + 1); innerRow /= h - 1;

  console.log(`\n===== ${name} — ${w}×${h}，${hist.size} 种颜色 =====`);
  console.log(`平均色 rgb(${(sr/N).toFixed(1)}, ${(sg/N).toFixed(1)}, ${(sb/N).toFixed(1)})   亮度范围 ${minL.toFixed(1)}~${maxL.toFixed(1)}`);
  console.log(`接缝：左右 ${colDiff(0, w-1).toFixed(2)}（内部相邻列均值 ${innerCol.toFixed(2)}）/ 上下 ${rowDiff(0, h-1).toFixed(2)}（内部相邻行均值 ${innerRow.toFixed(2)}）`);
  console.log(`最高频 12 色：${top.slice(0, 12).map(([k, n]) => `${k}×${n}`).join('  ')}`);
}
