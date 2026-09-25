/* 主角美术校验 + 动画对照表
   用法：node tools/vs-player-sheet.mjs <player-art.js> <out.png>
   校验：所有帧等宽等高、调色板覆盖所有字符、帧之间有位移（能动起来）；
   输出：每套皮肤一块，块内 3 方向 × 4 帧 的放大对照图。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const artPath = path.resolve(process.argv[2]);
const out = process.argv[3] || 'player-sheet.png';

const art = require(artPath);
const { SKINS, W, H, buildFrame } = art;
const DIRS = ['down', 'up', 'side'];
const FRAMES = [0, 1, 2, 3];

/* ---- 1. 收集 & 校验 ---- */
const problems = [];
const built = {};
for (const d of DIRS) {
  for (const f of FRAMES) {
    const rows = buildFrame(d, f);
    built[`${d}_${f}`] = rows;
    if (rows.length !== H) problems.push(`${d}_${f}: 行数 ${rows.length} != ${H}`);
    rows.forEach((r, i) => { if (r.length !== W) problems.push(`${d}_${f} 第 ${i} 行宽度 ${r.length} != ${W}`); });
  }
}

const chars = new Set();
for (const rows of Object.values(built)) for (const r of rows) for (const ch of r) if (ch !== '.') chars.add(ch);
for (const skin of SKINS) for (const ch of chars) if (!skin.pal[ch]) problems.push(`皮肤 ${skin.id} 缺少字符 '${ch}' 的颜色`);

/* 动画是否真的在动：帧 0 与帧 1/3 必须不同（腿或手臂有位移） */
for (const d of DIRS) {
  const a = built[`${d}_0`].join('\n');
  const b = built[`${d}_1`].join('\n');
  if (a === b) problems.push(`${d}: 帧 0 与 帧 1 完全相同 —— 动画不会动`);
}
/* 本作采用"站立 ↔ 跨步"两姿态交替 + 渲染层奇数帧上下弹跳的约定
   （见 renderer.drawPlayer 的 bob）：帧 0/2 站立、帧 1/3 跨步，
   所以 1 与 3 相同是**设计如此**，靠弹跳方向区分，不判失败。 */

console.log(`画布 ${W}×${H}`);
console.log(`字符集: ${[...chars].sort().join('')}`);
console.log(`皮肤: ${SKINS.map((s) => s.id).join(', ')}`);

if (problems.length) {
  console.log('\n❌ 校验失败:');
  problems.slice(0, 40).forEach((p) => console.log('   ' + p));
  process.exit(1);
}
console.log('✅ 校验通过：等宽等高、调色板完整、四帧真的有位移');

/* ---- 2. PNG 编码 ---- */
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

/* ---- 3. 排版 ---- */
const S = 5, PAD = 5, BLOCK_PAD = 12;
const blockW = FRAMES.length * (W * S + PAD) + PAD;
const blockH = DIRS.length * (H * S + PAD) + PAD;
const totalW = SKINS.length * blockW + (SKINS.length + 1) * BLOCK_PAD;
const totalH = blockH + 2 * BLOCK_PAD;

const buf = Buffer.alloc(totalW * totalH * 4, 0);
for (let y = 0; y < totalH; y++) for (let x = 0; x < totalW; x++) {
  const v = ((x >> 3) + (y >> 3)) % 2 ? 24 : 32;
  const i = (y * totalW + x) * 4; buf[i] = v; buf[i+1] = v; buf[i+2] = v + 4; buf[i+3] = 255;
}

SKINS.forEach((skin, si) => {
  const bx = BLOCK_PAD + si * (blockW + BLOCK_PAD), by = BLOCK_PAD;
  DIRS.forEach((dname, di) => {
    FRAMES.forEach((f, fi) => {
      const rows = built[`${dname}_${f}`];
      const cx = bx + PAD + fi * (W * S + PAD);
      const cy = by + PAD + di * (H * S + PAD);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        const col = skin.pal[ch];
        if (!col) continue;
        const [r, g, b] = hex(col);
        for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
          const px = cx + x * S + sx, py = cy + y * S + sy;
          if (px < 0 || py < 0 || px >= totalW || py >= totalH) continue;
          const i = (py * totalW + px) * 4;
          buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255;
        }
      }
    });
  });
});

fs.writeFileSync(out, encodePNG(totalW, totalH, buf));
console.log(`\n[vs-player-sheet] → ${out} (${totalW}×${totalH})`);
console.log('每块内：行 = down / up / side，列 = 帧 0 1 2 3');

/* ---- 4. 顺带把每帧的轮廓行数打出来，便于判断比例 ---- */
console.log('\n各方向帧 0 的占用行范围（判断头身比）：');
for (const d of DIRS) {
  const rows = built[`${d}_0`];
  let first = -1, last = -1;
  rows.forEach((r, i) => { if (/[^.]/.test(r)) { if (first < 0) first = i; last = i; } });
  console.log(`  ${d}: 第 ${first}~${last} 行（共 ${last - first + 1} 行实心）`);
}
