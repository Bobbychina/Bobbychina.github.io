/* 一次性重构工具：把生成器里内联的"主题点缀"整段替换成 require 外部源文件。
   用法：node tools/vs-strip-deco.mjs <gen-sprites.js> */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) { console.error('用法: node tools/vs-strip-deco.mjs <gen-sprites.js>'); process.exit(1); }

const src = fs.readFileSync(file, 'utf8');
const START = '/* ===========================================================\n   6c. 主题点缀';
const END = '/* ===========================================================\n   7. 程序化贴图';

const a = src.indexOf(START);
const b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) { console.error(`找不到区块边界: a=${a} b=${b}`); process.exit(1); }

const REPL = `/* ===========================================================
   6c. 主题点缀：按生物群落分的专属物件
   -----------------------------------------------------------
   美术源在 tools/deco-art.js 里（形状 + 调色板一起），
   和主角一样把"源"与"编译"分开 —— 改图形只改那个文件。
   第一关「血色荒野」：焦土 / 铁丝网 / 锈铁 / 骸骨
   第二关「柠檬深渊」：酸池 / 柠檬树 / 孢子囊 / 酸晶
   =========================================================== */

const decoArt = require('./deco-art.js');

/* 把 deco-art.js 里的组名映射成图集里的组名与精灵前缀 */
const DECO_THEME_MAP = [
  ['deco_l1', 'waste_', decoArt.deco_l1],
  ['deco_l1', 'waste_', decoArt.deco_l1_big],
  ['deco_l2', 'abyss_', decoArt.deco_l2],
  ['deco_l2', 'abyss_', decoArt.deco_l2_big]
];

`;

const out = src.slice(0, a) + REPL + src.slice(b);
fs.writeFileSync(file, out, 'utf8');
console.log(`[vs-strip-deco] 删除 ${b - a} 字节内联美术，替换为 require；文件 ${src.length} → ${out.length} 字节`);
