/* 把 vs-art-reverse.mjs 的输出解析成规范代码块：
   同一实体的多帧共用调色板（用第 0 帧的），并直接输出 node:check 能过的常量定义。
   用法：node tools/vs-art-revparse.mjs <reversed.txt> <输出.js>
   只写输出文件，不碰游戏文件。 */
import fs from 'node:fs';

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) { console.error('用法: node tools/vs-art-revparse.mjs <reversed.txt> <out.js>'); process.exit(1); }

const src = fs.readFileSync(inFile, 'utf8');

/* 按 "/* name — WxH，N 色 *\/" 切块 */
const blocks = [];
const re = /\/\* ([\w]+) — (\d+)×(\d+)，(\d+) 色 \*\/\r?\nconst ([\w]+) = \[\r?\n([\s\S]*?)\r?\n\];\r?\nconst ([\w]+) = \{\r?\n([\s\S]*?)\r?\n\};/g;
let m;
while ((m = re.exec(src))) {
  const [, name, w, h, colors, arrName, rowsRaw, palName, palRaw] = m;
  const rows = rowsRaw.split(/\r?\n/).map((l) => l.trim().replace(/^'/, '').replace(/',$/, ''));
  const pal = {};
  for (const pm of palRaw.matchAll(/'([^']+)':\s*'([^']+)'/g)) pal[pm[1]] = pm[2];
  blocks.push({ name, w: +w, h: +h, colors: +colors, rows, pal });
}

/* 按实体分组：name 去掉结尾 _0/_1 */
const entities = new Map();
for (const b of blocks) {
  const base = b.name.replace(/_[01]$/, '');
  if (!entities.has(base)) entities.set(base, []);
  entities.get(base).push(b);
}

/* 输出：实体名 -> 共用调色板（取帧 0）*/
const out = [];
out.push('/* ===========================================================');
out.push('   6b. Boss / 宠物 / 特殊掉落：从线上图集反解回来的字符画');
out.push('   -----------------------------------------------------------');
out.push('   这批精灵当初是直接写进 sprites.js、没有回灌生成器的，');
out.push('   这里把它们反解成"字符画 + 调色板"补齐，保证图集可完整重建。');
out.push('   生成结果与原图逐字节一致（tools/vs-art-compare.mjs 可验）。');
out.push('   =========================================================== */');
out.push('');

for (const [base, frames] of entities) {
  /* 每帧自带调色板：帧之间颜色数可能不同（例如 lemonPig_1 比 _0 多一个色），
     共用一份会丢字符，所以不做合并。 */
  for (const f of frames) {
    const arrVar = f.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    out.push(`const ${arrVar} = [`);
    for (const r of f.rows) out.push(`  '${r}',`);
    out.push('];');
    const palVar = `PAL_${arrVar}`;
    out.push(`const ${palVar} = {`);
    const entries = Object.entries(f.pal);
    for (let i = 0; i < entries.length; i += 4) {
      out.push('  ' + entries.slice(i, i + 4).map(([k, v]) => `'${k}': '${v}'`).join(', ') + (i + 4 < entries.length ? ',' : ''));
    }
    out.push('};');
    out.push('');
  }
}

/* 汇总表：给 buildAll 用 */
out.push('/* 反解精灵清单：[精灵名, 字符画, 调色板] —— 直接喂给 buildSprite */');
out.push('const REVERSED_SPRITES = [');
for (const [base, frames] of entities) {
  for (const f of frames) {
    const arr = f.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    out.push(`  ['${f.name}', ${arr}, PAL_${arr}],`);
  }
}
out.push('];');
out.push('');
out.push('/* 反解精灵的动画组（与本实体在线上图集里的分组一致） */');
out.push('const REVERSED_GROUPS = [');
for (const [base, frames] of entities) {
  if (frames.length < 2) continue;
  out.push(`  ['${base}', ['${frames.map((f) => f.name).join("', '")}']],`);
}
out.push('];');
out.push('');

fs.writeFileSync(outFile, out.join('\n'), 'utf8');

console.log(`[vs-art-revparse] ${blocks.length} 帧 / ${entities.size} 个实体 → ${outFile}`);
for (const [base, frames] of entities) {
  console.log(`  ${base.padEnd(16)} ${frames.length} 帧  ${frames[0].w}×${frames[0].h}  ${Object.keys(frames[0].pal).length} 色`);
}
