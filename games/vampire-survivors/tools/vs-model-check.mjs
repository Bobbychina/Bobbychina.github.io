/* 校验"重做怪"的美术源：行宽/行数/调色板覆盖，并把每帧渲染成 PNG 供目视。
   用法：node tools/vs-model-check.mjs <art.js> [outDir] */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const artPath = path.resolve(process.argv[2]);
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
const art = require(artPath);

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
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

const problems = [];
const models = art.models || {};
const names = Object.keys(models);
if (!names.length) problems.push('没有 models 导出');

let maxW = 0, maxH = 0;
for (const id of names) {
  const def = models[id];
  if (!def.frames || !def.frames.length) { problems.push(`${id}: 没有 frames`); continue; }
  def.frames.forEach((rows, fi) => {
    const w = rows[0].length, h = rows.length;
    maxW = Math.max(maxW, w); maxH = Math.max(maxH, h);
    if (h !== 16) problems.push(`${id} 帧${fi}: 行数 ${h} != 16`);
    rows.forEach((r, y) => { if (r.length !== w) problems.push(`${id} 帧${fi} 第${y}行宽度 ${r.length} != ${w}`); });
    const chars = new Set();
    rows.forEach((r) => { for (const c of r) if (c !== '.') chars.add(c); });
    for (const c of chars) if (!def.pal[c]) problems.push(`${id} 帧${fi}: 字符 '${c}' 没有配色`);
    /* 两帧必须不同，否则动画不动 */
  });
  const a = def.frames[0].join('\n');
  const b = def.frames[1] ? def.frames[1].join('\n') : a;
  if (def.frames.length > 1 && a === b) problems.push(`${id}: 两帧完全相同 —— 动画不会动`);
}

console.log(`模型 ${names.length} 个：${names.join(', ')}`);
if (problems.length) {
  console.log('\n❌ 校验失败:');
  problems.forEach((p) => console.log('   ' + p));
  process.exit(1);
}
console.log('✅ 校验通过：16×16、行宽一致、调色板完整、两帧不同');

/* ---- 渲染放大对照图 ---- */
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const S = 8, PAD = 6;
  const cols = Math.max(...names.map((id) => models[id].frames.length));
  const cw = maxW * S + PAD, ch = maxH * S + PAD;
  const W = cols * cw + PAD, H = names.length * ch + PAD;
  const buf = Buffer.alloc(W * H * 4, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = ((x >> 3) + (y >> 3)) % 2 ? 24 : 32;
    const i = (y * W + x) * 4; buf[i] = v; buf[i+1] = v; buf[i+2] = v + 4; buf[i+3] = 255;
  }
  names.forEach((id, ri) => {
    models[id].frames.forEach((rows, fi) => {
      const ox = PAD + fi * cw, oy = PAD + ri * ch;
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = row[x];
          if (c === '.') continue;
          const col = models[id].pal[c];
          if (!col) continue;
          const [r, gg, b] = hex(col);
          for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
            const px = ox + x * S + sx, py = oy + y * S + sy;
            if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const i = (py * W + px) * 4;
            buf[i] = r; buf[i+1] = gg; buf[i+2] = b; buf[i+3] = 255;
          }
        }
      });
    });
    console.log(`  行 ${ri}: ${id}（${models[id].frames.length} 帧）`);
  });
  const out = path.join(outDir, 'models.png');
  fs.writeFileSync(out, encodePNG(W, H, buf));
  console.log(`\n[vs-model-check] → ${out} (${W}×${H})  列 = 帧`);
}
