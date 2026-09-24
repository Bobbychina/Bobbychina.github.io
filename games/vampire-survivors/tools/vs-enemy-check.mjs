/* 第二关专属怪物自检：真的能刷出来、动画组在、帧图真的解码了、画面真的画出来了。
   -----------------------------------------------------------
   背景：config.js 给这三只怪加了 onlyFromLevel:1（第一关抽不到），
   精灵与动画组由 tools/enemy-art.js -> tools/gen-sprites.js 编译。
   这个脚本用 CDP 开真页面，做四件事：
     1) 断言 SpriteGroups 里每个组的所有帧名都在 SpriteData 里，且 Assets.ready 全部为真
     2) 断言 pickType 的分关闸：第一关永远抽不到三只酸怪，第二关 t 够大时抽得到
     3) 用 Enemies.spawn 把三只怪硬塞进 game.enemies.list，推进一帧后截图
     4) 断言 0 未捕获异常

   用法：node tools/vs-enemy-check.mjs <cdpPort> <url> [outDir] */
const [, , cdpPort, url, outDir] = process.argv;
const fs = await import('node:fs/promises');
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target = null;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(500);
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res) => { ws.onopen = res; });
let id = 0; const pending = new Map(); const errs = []; const consoleErrs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') consoleErrs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
};
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }); } }, ms);
});
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 });
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0];
  return r.result?.result?.value;
};
const j = async (x) => JSON.parse(String(await ev(x)));
const checks = [];
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); };

const NEW = ['acidhusk', 'sporebat', 'toxicshaman'];

await send('Runtime.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });

for (let i = 0; i < 90; i++) {
  const r = await ev(`document.readyState === 'complete' && !!window.VS && !!document.getElementById('startBtn')`);
  if (r === true) break;
  await sleep(400);
}

/* --- ① 图集完整性：每个组的所有帧都要有图，而且真的解码完成 --- */
const art = await j(`(() => {
  const G = VS.SpriteGroups || {}, D = VS.SpriteData || {};
  const missingData = [], notReady = [], emptyGroups = [];
  for (const g of Object.keys(G)) {
    const list = G[g] || [];
    if (!list.length) { emptyGroups.push(g); continue; }
    for (const n of list) {
      if (!D[n]) missingData.push(g + ':' + n);
      else if (!VS.Assets.ready(n)) notReady.push(g + ':' + n);
    }
  }
  const newGroups = ${JSON.stringify(NEW)}.map((id) => ({
    id: id,
    group: G[id] || null,
    frames: (G[id] || []).map((n) => ({ name: n, ready: VS.Assets.ready(n), uri: !!(D[n] && D[n].uri) }))
  }));
  return JSON.stringify({ total: Object.keys(D).length, groups: Object.keys(G).length,
    missingData: missingData, notReady: notReady, emptyGroups: emptyGroups, newGroups: newGroups,
    allReady: VS.Assets.allReady() });
})()`);
ok('① 图集自洽：SpriteGroups 每一帧都在 SpriteData 里、没有空组、全部解码完成',
  art.missingData.length === 0 && art.emptyGroups.length === 0 && art.allReady === true,
  JSON.stringify({ sprites: art.total, groups: art.groups, missing: art.missingData.slice(0, 4), notReady: art.notReady.slice(0, 4), empty: art.emptyGroups.slice(0, 4) }));

ok('①′ 三只新怪的动画组都在，且组里每帧都有图且已解码',
  art.newGroups.every((g) => Array.isArray(g.group) && g.group.length >= 1 && g.frames.every((f) => f.ready && f.uri)),
  JSON.stringify(art.newGroups.map((g) => g.id + '=' + (g.group || []).join(','))));

/* --- ② 分关闸：第一关抽不到、第二关抽得到 --- */
const gate = await j(`(() => {
  const C = VS.Config, E = VS.Enemies;
  const ids = ${JSON.stringify(NEW)};
  const count = (lv, t, n) => {
    const seen = {};
    for (let i = 0; i < n; i++) { const d = E.pickType(t, lv); seen[d.id] = (seen[d.id] || 0) + 1; }
    return seen;
  };
  const l1 = count(0, 600, 4000);
  const l2 = count(1, 600, 4000);
  const hit = (o) => ids.filter((i) => (o[i] || 0) > 0);
  /* 解锁时间也要对：第二关 unlockMul 0.35，孢蝠 60s -> 21s 起、腐尸 90s -> 31.5s 起 */
  const early = count(1, 5, 3000);
  return JSON.stringify({ ids: ids, l1: l1, l2: l2, l1Hits: hit(l1), l2Hits: hit(l2), earlyHits: hit(early),
    unlockMul: VS.Levels.unlockMul(1), allows: ids.map((i) => [i, VS.Levels.allows(0, C.ENEMY_TYPES[i]), VS.Levels.allows(1, C.ENEMY_TYPES[i])]) });
})()`);
ok('② 第一关（level 0）抽不到三只酸怪（onlyFromLevel 闸生效）',
  gate.l1Hits.length === 0 && gate.allows.every((a) => a[1] === false && a[2] === true),
  JSON.stringify(gate.allows));
ok('②′ 第二关（level 1）在 600 秒时三只都能抽到',
  gate.l2Hits.length === 3, JSON.stringify({ l2: gate.l2, hits: gate.l2Hits }));
ok('②″ 第二关解锁时间被 unlockMul 缩放（5 秒时还没解锁，抽不到）',
  gate.unlockMul === 0.35 && gate.earlyHits.length === 0, JSON.stringify({ unlockMul: gate.unlockMul, early: gate.earlyHits }));

/* --- ③ 起游戏 + 硬塞三只怪 + 推进一帧 + 截图 --- */
const spawned = await j(`(async () => {
  if (!VS.Game.current || VS.Game.current.state !== 'playing') {
    document.getElementById('startBtn').click();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (VS.Game.current && VS.Game.current.state === 'playing') break;
    }
  }
  const g = VS.Game.current;
  if (!g || g.state !== 'playing') return JSON.stringify({ err: 'game not playing', state: g && g.state });
  const p = g.player;
  /* 摊开一点、离开玩家一小段距离：既不叠在一起，又都在镜头里 */
  const layout = [[-150, -60], [-70, -110], [10, -130], [90, -95], [165, -40], [-165, 20], [-60, 70], [40, 90], [140, 60]];
  const made = [];
  const ids = ${JSON.stringify(NEW)};
  for (let i = 0; i < layout.length; i++) {
    const def = VS.Config.ENEMY_TYPES[ids[i % ids.length]];
    const e = VS.Enemies.spawn(g.enemies, def, g, { x: p.x + layout[i][0], y: p.y + layout[i][1] });
    made.push({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), speed: Math.round(e.speed), damage: Math.round(e.damage), xp: e.xp });
  }
  /* 推进一帧（步长就是主循环用的 1/60），让渲染前的状态是"已经在场" */
  VS.Game.step(g, 1 / 60);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const seen = {};
  for (const e of g.enemies.list) seen[e.type] = (seen[e.type] || 0) + 1;
  return JSON.stringify({ ok: true, made: made, inList: g.enemies.list.length, seen: seen,
    level: g.level, levelName: VS.Levels.label(g.level),
    groupFrames: ids.map((i) => i + ':' + VS.SpriteGroups[i].length) });
})()`);
ok('③ 三只新怪被塞进 game.enemies.list 并推进了一帧（场上数量与类型都对）',
  spawned.ok === true && spawned.inList >= 9 && NEW.every((t) => (spawned.seen[t] || 0) === 3),
  JSON.stringify({ level: spawned.levelName, inList: spawned.inList, seen: spawned.seen, frames: spawned.groupFrames }));
if (outDir && spawned.ok) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) await fs.writeFile(`${outDir}/vs-l2-enemies.png`, Buffer.from(r.result.data, 'base64'));
  console.log('  截图: ' + outDir + '/vs-l2-enemies.png');
}

/* --- ④ 画面真的画出了这些怪（按精灵像素色采样） --- */
const pixels = await j(`(() => {
  const g = VS.Game.current;
  const c = document.getElementById('game');
  const ctx = c.getContext('2d');
  const cam = g.world.camera;
  /* 把三只怪的世界坐标换算成画布坐标，各取 8x8 采样块，数"像怪物的绿/黄像素" */
  const want = ${JSON.stringify(NEW)};
  const out = {};
  for (const t of want) {
    const e = g.enemies.list.find((x) => x.type === t);
    if (!e) { out[t] = null; continue; }
    const sx = Math.round(e.x - cam.x), sy = Math.round(e.y - cam.y);
    const w = 24, h = 24;
    const d = ctx.getImageData(Math.max(0, sx - w / 2), Math.max(0, sy - h / 2), w, h).data;
    let hit = 0, tot = 0;
    for (let i = 0; i < d.length; i += 4) {
      tot++;
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      /* 病绿 / 酸黄：绿通道明显高于蓝、且不太暗 */
      if (gg > 90 && gg > b + 30 && gg >= r) hit++;
    }
    out[t] = { at: [sx, sy], hit: hit, tot: tot };
  }
  return JSON.stringify(out);
})()`);
ok('④ 三只怪在画布上确实有精灵像素（不是被降级成色块或没画）',
  NEW.every((t) => pixels[t] && pixels[t].hit >= 20),
  JSON.stringify(pixels));

ok('⑤ 0 未捕获异常 / 0 控制台错误', errs.length === 0 && consoleErrs.length === 0,
  (errs.slice(0, 2).join(' | ') + ' ' + consoleErrs.slice(0, 2).join(' | ')).trim());

console.log('');
console.log('VS 第二关怪物自检：' + checks.filter((c) => c[1]).length + '/' + checks.length);
ws.close();
process.exit(checks.every((c) => c[1]) ? 0 : 1);
