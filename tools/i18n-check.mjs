/* i18n 自检：词典键 ↔ 页面实际用键是否对齐（改了文案或加了语言后跑一次）
 * 用法：node tools/i18n-check.mjs
 * 退出码：0 = 对齐；1 = 有缺失/不一致
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const HTML = ['index.html', 'games/index.html'];
const JS = ['beta-notice.js', 'easter-egg.js', 'games/account.js'];
const LANGS = ['zh-CN', 'en'];

/* ---- 词典键 ---- */
const dict = {};
for (const l of LANGS) {
  dict[l] = new Set([...read(`i18n/${l}.js`).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]));
}

/* ---- 页面用键 ---- */
const used = new Map();
const add = (k, f) => { if (!k) return; if (!used.has(k)) used.set(k, new Set()); used.get(k).add(f); };
for (const f of [...HTML, ...JS]) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const m of src.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) add(m[1], f);
  for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) m[1].split(';').forEach((p) => add(p.split(':')[1]?.trim(), f));
  for (const m of src.matchAll(/\bT\('([^']+)'/g)) add(m[1], f);
  for (const m of src.matchAll(/I18N\.t\('([^']+)'/g)) add(m[1], f);
  for (const m of src.matchAll(/'(thanks\.[\w.]+)'/g)) add(m[1], f);
}

const problems = [];
const missing = [...used.keys()].filter((k) => !dict[LANGS[0]].has(k)).sort();
if (missing.length) problems.push(`缺词条（页面用了、词典里没有）：\n  - ` + missing.map((k) => `${k}  [${[...used.get(k)].join(', ')}]`).join('\n  - '));

for (const l of LANGS.slice(1)) {
  const miss = [...dict[LANGS[0]]].filter((k) => !dict[l].has(k)).sort();
  if (miss.length) problems.push(`${l} 缺少这些键：\n  - ` + miss.join('\n  - '));
}

const unused = [...dict[LANGS[0]]].filter((k) => !used.has(k)).sort();
console.log(`词典键：${LANGS.map((l) => `${l}=${dict[l].size}`).join(' / ')}；页面用键：${used.size}`);
if (unused.length) console.log(`\n词典里没被页面引用的键（可能是死词条，或运行时才拼的）：\n  - ${unused.join('\n  - ')}`);
if (problems.length) { console.error('\n' + problems.join('\n\n')); process.exit(1); }
console.log('\n对齐 ✅');
