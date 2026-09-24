/* 比对"暂存生成器产物"与"线上图集"里重叠精灵是否逐字节一致。
   用途：确认旧生成器是不是当前美术的真实源头（没漂移），再决定能不能在它上面改。
   用法：node tools/vs-art-compare.mjs <生成的sprites.js> [线上sprites.js] */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const win = {};
  win.window = win;
  win.VS = win.VS || {};
  new Function('window', 'VS', src)(win, win.VS);
  return { data: win.VS.SpriteData || {}, groups: win.VS.SpriteGroups || {}, info: win.VS.SpriteInfo || {} };
}

const genFile = path.resolve(process.argv[2]);
const liveFile = path.resolve(process.argv[3] || path.join(ROOT, 'games/vampire-survivors/js/render/sprites.js'));

const gen = load(genFile);
const live = load(liveFile);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

const genNames = Object.keys(gen.data);
const liveNames = Object.keys(live.data);
const shared = genNames.filter((n) => liveNames.includes(n));
const onlyGen = genNames.filter((n) => !liveNames.includes(n));
const onlyLive = liveNames.filter((n) => !genNames.includes(n));

let same = 0;
const diff = [];
for (const n of shared) {
  const a = String(gen.data[n].uri).replace(/^data:image\/png;base64,/, '');
  const b = String(live.data[n].uri).replace(/^data:image\/png;base64,/, '');
  const ab = Buffer.from(a, 'base64');
  const bb = Buffer.from(b, 'base64');
  if (ab.equals(bb)) { same++; continue; }
  diff.push({ name: n, genBytes: ab.length, liveBytes: bb.length, genSha: sha(ab), liveSha: sha(bb),
    sizeMismatch: gen.data[n].w !== live.data[n].w || gen.data[n].h !== live.data[n].h });
}

console.log('== 生成器 vs 线上 图集比对 ==');
console.log(`生成器: ${genNames.length} 张 (${JSON.stringify(gen.info)})`);
console.log(`线上  : ${liveNames.length} 张 (${JSON.stringify(live.info)})`);
console.log(`重叠  : ${shared.length} 张 → 完全一致 ${same} 张 / 不一致 ${diff.length} 张`);
console.log(`仅生成器有 (${onlyGen.length}): ${onlyGen.join(', ') || '—'}`);
console.log(`仅线上有   (${onlyLive.length}): ${onlyLive.join(', ') || '—'}`);

if (diff.length) {
  console.log('\n不一致明细：');
  for (const d of diff) {
    console.log(`  ${d.name.padEnd(18)} gen ${String(d.genBytes).padStart(5)}B ${d.genSha}  |  live ${String(d.liveBytes).padStart(5)}B ${d.liveSha}${d.sizeMismatch ? '  ← 尺寸也不同' : ''}`);
  }
} else if (shared.length) {
  console.log('\n✅ 重叠精灵逐字节完全一致 —— 生成器就是当前美术的真实源头，可以直接在它上面改。');
}

/* 动画组是否一致 */
const gd = Object.keys(gen.groups).filter((g) => JSON.stringify(gen.groups[g]) !== JSON.stringify(live.groups[g]));
console.log(`\n动画组：生成器 ${Object.keys(gen.groups).length} 组 / 线上 ${Object.keys(live.groups).length} 组 / 内容不同 ${gd.length} 组${gd.length ? ' → ' + gd.join(', ') : ''}`);
