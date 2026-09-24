/* 把反解出来的常量块内联进生成器（全程 UTF-8，避免 shell 按 ANSI 解码破坏中文注释）。
   幂等：第一次用 /*@@REVERSED@@*​/ 标记占位，之后靠起止注释重写中间段。

   用法：node tools/vs-inline.mjs <gen-sprites.js> <reversed-module.js> */
import fs from 'node:fs';

const [, , genFile, modFile] = process.argv;
if (!genFile || !modFile) { console.error('用法: node tools/vs-inline.mjs <gen-sprites.js> <reversed-module.js>'); process.exit(1); }

const MARK = '/*@@REVERSED@@*/';
const BEGIN = '/* ---- >>> 反解精灵';
const END = '/* ---- >>> 反解精灵 结束 <<< ---- */';

let gen = fs.readFileSync(genFile, 'utf8');
const mod = fs.readFileSync(modFile, 'utf8').trimEnd();

let out;
if (gen.includes(MARK)) {
  out = gen.replace(MARK, mod);
} else {
  const b = gen.indexOf(BEGIN);
  const e = gen.indexOf(END);
  if (b < 0 || e < 0 || e < b) {
    console.error(`生成器里既没有 ${MARK}，也没有起止注释，无法内联`);
    process.exit(1);
  }
  /* 保留起止注释行本身，只替换中间内容 */
  const headEnd = gen.indexOf('\n', b) + 1;
  out = gen.slice(0, headEnd) + mod + '\n' + gen.slice(e);
}

fs.writeFileSync(genFile, out, 'utf8');
console.log(`[vs-inline] 已内联 ${mod.length} 字节 → ${genFile}（${out.length} 字节）`);
