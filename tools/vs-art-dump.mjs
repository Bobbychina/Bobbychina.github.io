/* 只读侦察工具：把 VS.SpriteData 里的 base64 图集解码成 PNG 落地，并生成一张放大对照表。
   用途：改美术之前先"亲眼看清"现状（角色几帧、点缀长什么样、两张底图差在哪）。
   用法：node tools/vs-art-dump.mjs [输出目录]
   不改任何游戏文件。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = path.join(ROOT, 'games/vampire-survivors/js/render/sprites.js');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'tools/art-dump'));

fs.mkdirSync(OUT, { recursive: true });

const src = fs.readFileSync(SRC, 'utf8');
const win = {};
win.window = win;
win.VS = win.VS || {};
new Function('window', 'VS', src)(win, win.VS);

const data = win.VS.SpriteData || {};
const groups = win.VS.SpriteGroups || {};
const info = win.VS.SpriteInfo || {};

const names = Object.keys(data);
const rows = [];
for (const name of names) {
  const def = data[name];
  const b64 = String(def.uri).replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(OUT, name + '.png'), buf);
  rows.push({ name, w: def.w, h: def.h, bytes: buf.length });
}

/* 组名反查：一个图属于哪些动画组 */
const inGroups = {};
for (const [g, list] of Object.entries(groups)) {
  for (const n of list) (inGroups[n] = inGroups[n] || []).push(g);
}

const totalBytes = rows.reduce((a, r) => a + r.bytes, 0);

/* 对照表 HTML：像素画放大用 nearest-neighbor，否则看不清 */
const cell = (r) => `
  <figure>
    <img src="${r.name}.png" style="width:${r.w * 6}px;height:${r.h * 6}px;image-rendering:pixelated">
    <figcaption><b>${r.name}</b><br>${r.w}×${r.h} · ${r.bytes}B${inGroups[r.name] ? '<br><i>' + inGroups[r.name].join(',') + '</i>' : ''}</figcaption>
  </figure>`;

const html = `<!doctype html><meta charset="utf-8"><title>VS 精灵对照表</title>
<body style="font:12px/1.5 system-ui;background:#0d1117;color:#c9d1d9;padding:20px">
<h1 style="font-size:16px">VS 精灵对照表 · ${names.length} 张 · 合计 ${totalBytes}B（声明 ${JSON.stringify(info)}）</h1>
<div style="display:flex;flex-wrap:wrap;gap:18px">
${rows.map(cell).join('\n')}
</div>
</body>`;

fs.writeFileSync(path.join(OUT, 'index.html'), html, 'utf8');

console.log(`[vs-art-dump] ${names.length} 张 → ${OUT}`);
console.log(`[vs-art-dump] 总计 ${totalBytes} 字节（原声明 pngBytes=${info.pngBytes} count=${info.count}）`);
console.log('\n按名字列出：');
for (const r of rows) console.log(`  ${r.name.padEnd(22)} ${String(r.w).padStart(3)}×${String(r.h).padEnd(3)} ${String(r.bytes).padStart(5)}B  ${(inGroups[r.name] || []).join(',')}`);
console.log('\n动画组：');
for (const [g, list] of Object.entries(groups)) console.log(`  ${g.padEnd(16)} ${list.length} 帧  ${list.join(' ')}`);
