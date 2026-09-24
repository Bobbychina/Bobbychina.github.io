/* 把线上图集里的精灵反解成"字符画 + 调色板"，用来把后来手写进去、没回灌生成器的
   那批精灵（Boss/柠檬猪/宠物/经验球/酸液/ground_l2）补回生成器，做到自洽可重建。
   用法：node tools/vs-art-reverse.mjs [精灵名...]   （不给名字 = 反解线下有、暂存生成器没有的那批）
   只读线上 sprites.js，不改任何游戏文件；结果打印到 stdout。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const LIVE = path.join(ROOT, 'games/vampire-survivors/js/render/sprites.js');

/* ---------------- 最小 PNG 解码（8bit，支持灰度/RGB/索引/带alpha） ---------------- */

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let off = 8;
  let w = 0, h = 0, depth = 0, colorType = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];

  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`只支持 8bit，得到 ${depth}`);
  if (interlace) throw new Error('不支持隔行 PNG');

  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CH) throw new Error(`未知 colorType ${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = CH;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`未知滤波 ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  /* 展开成 RGBA */
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = y * stride + x * bpp;
      const d = (y * w + x) * 4;
      if (colorType === 6) {
        px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = out[s + 3];
      } else if (colorType === 2) {
        px[d] = out[s]; px[d + 1] = out[s + 1]; px[d + 2] = out[s + 2]; px[d + 3] = 255;
      } else if (colorType === 0) {
        px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = 255;
      } else if (colorType === 4) {
        px[d] = px[d + 1] = px[d + 2] = out[s]; px[d + 3] = out[s + 1];
      } else if (colorType === 3) {
        const i = out[s] * 3;
        px[d] = plte[i]; px[d + 1] = plte[i + 1]; px[d + 2] = plte[i + 2];
        px[d + 3] = (trns && out[s] < trns.length) ? trns[out[s]] : 255;
      }
    }
  }
  return { w, h, px };
}

/* ---------------- RGBA -> 字符画 + 调色板 ---------------- */

const GLYPHS = 'KHMhSECcTRBGWwEDdPpgGrTIUuOoAaNnQqVvXxYyZz0123456789';

function reverse(name, { w, h, px }) {
  /* 颜色 -> 字符，'.' 保留给全透明 */
  const map = new Map();
  const pal = {};
  let next = 0;

  const rows = [];
  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4;
      const r = px[d], g = px[d + 1], b = px[d + 2], a = px[d + 3];
      if (a === 0) { line += '.'; continue; }
      const key = `${r},${g},${b},${a}`;
      let ch = map.get(key);
      if (!ch) {
        if (next >= GLYPHS.length) throw new Error(`[${name}] 颜色超过 ${GLYPHS.length} 种`);
        ch = GLYPHS[next++];
        map.set(key, ch);
        pal[ch] = a === 255
          ? '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
          : `'rgba(${r},${g},${b},${(a / 255).toFixed(3)})'`;
      }
      line += ch;
    }
    rows.push(line);
  }
  return { rows, pal, colors: next };
}

/* ---------------- 主流程 ---------------- */

const src = fs.readFileSync(LIVE, 'utf8');
const win = {};
win.window = win; win.VS = win.VS || {};
new Function('window', 'VS', src)(win, win.VS);
const data = win.VS.SpriteData;

/* 默认反解"线上有、旧生成器没有"的那批。
   ground / ground_l2 是程序化生成的（上百种颜色），不走字符画，由生成器里的
   makeGroundTile 系列负责，所以这里排除。 */
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--out=')).length
  ? process.argv.slice(2).filter((a) => !a.startsWith('--out='))
  : Object.keys(data).filter((n) => /^(boss|lemonPig|pet_|orb_|acid)/.test(n));

const outArg = process.argv.find((a) => a.startsWith('--out='));
const chunks = [];

const emit = (s) => chunks.push(s);

for (const name of wanted) {
  const def = data[name];
  if (!def) { emit(`/* 找不到精灵 ${name} */\n`); continue; }
  const buf = Buffer.from(String(def.uri).replace(/^data:image\/png;base64,/, ''), 'base64');
  const { w, h, px } = decodePNG(buf);
  const { rows, pal, colors } = reverse(name, { w, h, px });

  emit(`/* ${name} — ${w}×${h}，${colors} 色 */\n`);
  emit(`const ${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')} = [\n`);
  for (const r of rows) emit(`  '${r}',\n`);
  emit('];\n');
  emit(`const PAL_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')} = {\n`);
  emit('  ' + Object.entries(pal).map(([k, v]) => `'${k}': '${v}'`).join(', ') + '\n');
  emit('};\n\n');
}

const text = chunks.join('');
if (outArg) {
  fs.writeFileSync(outArg.slice('--out='.length), text, 'utf8');
  console.log(`[vs-art-reverse] ${wanted.length} 张 → ${outArg.slice('--out='.length)}`);
} else {
  process.stdout.write(text);
}

