/* 生成"点缀集合"对照图：把候选字符画渲染成 PNG，按 (主题, 名字) 排布，便于目视挑选。
   用法：node tools/vs-deco-sheet.mjs <输出png> <tiles.mjs>
   tiles.mjs 需默认导出 { [groupName]: { [spriteName]: { rows, pal, scale } } } */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const out = process.argv[2];
const modPath = process.argv[3];
if (!out || !modPath) { console.error('用法: node tools/vs-deco-sheet.mjs <out.png> <tiles.js>'); process.exit(1); }

/* 美术源是 CommonJS（生成器也用 require 读它），所以这里按 CJS 加载 */
const require = createRequire(import.meta.url);
const groups = require(path.resolve(modPath));

/* ---- PNG 编码 ---- */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); }
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', (() => { const b = Buffer.alloc(13); b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4); b[8] = 8; b[9] = 6; return b; })()),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/* ---- 排版 ---- */
const SCALE = 6, PAD = 10, LABEL_H = 16;
const cells = [];
for (const [groupName, sprites] of Object.entries(groups)) {
  for (const [spriteName, def] of Object.entries(sprites)) cells.push({ groupName, spriteName, def });
}

/* 5×7 点阵字：够用来给每个格子标编号与名字首字母 */
const FONT = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00110','01000','10000','11111'],
  '3': ['11111','00010','00100','00010','00001','10001','01110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  '.': ['00000','00000','00000','00000','00000','00000','00100']
};
const drawText = (str, x0, y0, col) => {
  let cx = x0;
  for (const chr of String(str)) {
    const g = FONT[chr];
    if (g) {
      for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
        if (g[y][x] !== '1') continue;
        const px = cx + x, py = y0 + y;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
      }
    }
    cx += 6;
  }
};

const maxW = Math.max(...cells.map((c) => c.def.rows[0].length));
const maxH = Math.max(...cells.map((c) => c.def.rows.length));
const cols = Math.min(8, Math.ceil(Math.sqrt(cells.length)));
const rows = Math.ceil(cells.length / cols);
const cw = maxW * SCALE + PAD, ch = maxH * SCALE + PAD + LABEL_H;
const W = cols * cw + PAD, H = rows * ch + PAD;

const buf = Buffer.alloc(W * H * 4, 0);
/* 棋盘底，便于看清透明区域 */
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = ((x >> 3) + (y >> 3)) % 2 ? 26 : 34;
  const i = (y * W + x) * 4; buf[i] = v; buf[i + 1] = v; buf[i + 2] = v + 4; buf[i + 3] = 255;
}

cells.forEach((cell, idx) => {
  const cx = PAD + (idx % cols) * cw, cy = PAD + Math.floor(idx / cols) * ch;
  const { rows: art, pal } = cell.def;
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[y].length; x++) {
      const ch2 = art[y][x];
      if (ch2 === '.' || ch2 === ' ') continue;
      const col = pal[ch2];
      if (!col) continue;
      const [r, g, b] = hex(col);
      for (let sy = 0; sy < SCALE; sy++) for (let sx = 0; sx < SCALE; sx++) {
        const px = cx + x * SCALE + sx, py = cy + y * SCALE + sy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      }
    }
  }
  void LABEL_H;
  drawText(String(idx), cx + 2, cy + maxH * SCALE + 4, [235, 235, 235]);
  console.log(`  [${String(idx).padStart(2)}] ${cell.groupName.padEnd(8)} ${cell.spriteName}`);
});

fs.writeFileSync(out, encodePNG(W, H, buf));
console.log(`[vs-deco-sheet] ${cells.length} 个 → ${out}  (${W}×${H})`);
