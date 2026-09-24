/* 对照实验：把改动前的 renderer.js 临时放回去，用同一个闪烁探针量一遍，
   再换回来。用来判断"相机取整"这个修复到底有没有真实收益。
   用法：node tools/vs-flicker-ab.mjs <cdpPort> <localUrl> <liveUrl> */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const RENDERER = path.join(ROOT, 'games/vampire-survivors/js/render/renderer.js');
const [, , cdpPort, localUrl] = process.argv;

const probe = () => {
  const r = spawnSync('node', [path.join(ROOT, 'tools/vs-flicker-probe.mjs'), cdpPort, localUrl],
    { encoding: 'utf8', cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  const pick = (name) => {
    const m = out.split('\n').find((l) => l.includes(name));
    return m ? m.trim() : '(未取到)';
  };
  const total = out.split('\n').find((l) => l.includes('闪烁探针'));
  return { A: pick('A. 相机静止'), B: pick('B. 小数相机'), C: pick('C. 走动确实'), total: total ? total.trim() : '(未取到)' };
};

console.log('=== 1) 当前（已修复）===');
const after = probe();
console.log('  ' + after.A);
console.log('  ' + after.B);
console.log('  ' + after.C);
console.log('  ' + after.total);

/* 用 git stash 把渲染器回到 HEAD 版本（HEAD 就是未修复版） */
console.log('\n=== 2) 换回改动前（git stash 渲染器）===');
let stashed = false;
try {
  execFileSync('git', ['-C', ROOT, 'stash', 'push', '--', 'games/vampire-survivors/js/render/renderer.js'], { stdio: 'pipe' });
  stashed = true;
  console.log('  已 stash 渲染器改动');
} catch (e) {
  console.log('  stash 失败：' + e.message);
}

let before = null;
if (stashed) {
  await new Promise((r) => setTimeout(r, 1500));
  before = probe();
  console.log('  ' + before.A);
  console.log('  ' + before.B);
  console.log('  ' + before.C);
  console.log('  ' + before.total);

  try {
    execFileSync('git', ['-C', ROOT, 'stash', 'pop'], { stdio: 'pipe' });
    console.log('\n  已恢复渲染器改动');
  } catch (e) {
    console.log('\n  ⚠ stash pop 失败，请手动 git stash pop：' + e.message);
  }
}

console.log('\n=== 结论 ===');
if (before) {
  console.log('  修复前：' + before.total);
  console.log('  修复后：' + after.total);
  const num = (s) => { const m = s.match(/(\d+)\/(\d+)/); return m ? Number(m[1]) : -1; };
  console.log(num(after.total) > num(before.total)
    ? '  → 修复带来了可测量的改善'
    : '  → 这个探针量不出两者的差别（说明"地面闪"另有原因，需要换指标）');
} else {
  console.log('  没能完成对照（stash 未生效）');
}
