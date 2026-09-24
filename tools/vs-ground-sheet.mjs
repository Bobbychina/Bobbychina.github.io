/* 地表目视检查：把底图放大并 3×3 平铺，直接看接缝与重复感。
   用法：node tools/vs-ground-sheet.mjs <out.png> [精灵名...] */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LIVE = path.join(ROOT, 'games/vampire-survivors/js/render/sprites.js');

const out = process.argv[2] || path.join(ROOT, 'tools/art-dump/ground-sheet.png');
const names = process.argv.slice(3).length ? process.argv.slice(3) : ['ground', 'ground_l2'];

/* ---- PNG 解码 ---- */
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

/* ---- PNG 编码 ---- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const tt = Buffer.from(t, 'ascii'); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([tt, d])), 0); return Buffer.concat([l, tt, d, c]); };
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const src = fs.readFileSync(LIVE, 'utf8');
const win = {}; win.window = win; win.VS = win.VS || {};
new Function('window', 'VS', src)(win, win.VS);

const SCALE = 2, TILES = 3, GAP = 12, LABEL = 0;
const tiles = names.map((n) => ({ name: n, ...decodePNG(Buffer.from(String(win.VS.SpriteData[n].uri).replace(/^data:image\/png;base64,/, ''), 'base64')) }));

const cellW = tiles[0].w * SCALE * TILES, cellH = tiles[0].h * SCALE * TILES;
const W = tiles.length * cellW + (tiles.length + 1) * GAP;
const H = cellH + 2 * GAP;
const buf = Buffer.alloc(W * H * 4, 0);

tiles.forEach((t, ti) => {
  const ox = GAP + ti * (cellW + GAP), oy = GAP;
  for (let ty = 0; ty < TILES; ty++) {
    for (let tx = 0; tx < TILES; tx++) {
      for (let y = 0; y < t.h; y++) {
        for (let x = 0; x < t.w; x++) {
          const s = (y * t.w + x) * 4;
          for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
            const px = ox + (tx * t.w + x) * SCALE + sx;
            const py = oy + (ty * t.h + y) * SCALE + sy;
            const q = (py * W + px) * 4;
            buf[q] = t.px[s]; buf[q+1] = t.px[s+1]; buf[q+2] = t.px[s+2]; buf[q+3] = 255;
          }
        }
      }
    }
  }
  void LABEL;
  console.log(`  ${t.name}: ${t.w}×${t.h}`);
});

fs.writeFileSync(out, encodePNG(W, H, buf));
console.log(`[vs-ground-sheet] → ${out}  (${W}×${H})`);
