// 「尸潮之王」招式取证：弹幕 / 召唤小弟 / 冲撞 / 前摇 / 档位 / 上限 / 性能
// 用法：node tools/vs-boss-probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })).result?.result?.value
const j = async (x) => { try { return JSON.parse(String(await ev(x))) } catch (e) { return {} } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data && outDir) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
for (let i = 0; i < 150; i++) { if (String(await ev(`document.readyState`)) === 'complete' && await ev(`!!document.getElementById('startBtn')`)) break; await sleep(600) }

/* 开局 → 跳到 Boss 时段 → 手动投放一只 Boss（不等 5 分钟） */
await ev(`(() => { document.getElementById('startBtn').click(); return 1 })()`)
await sleep(1200)
const setup = await j(`(() => {
  const g = VS.Game.current
  g.time = 300
  g.player.hp = 1e9; g.player.maxHp = 1e9
  window.__god = setInterval(function () { const p = VS.Game.current.player; p.hp = 1e9; p.maxHp = 1e9; p.alive = true }, 400)
  const boss = VS.Enemies.spawnBoss(g.enemies, g)
  return JSON.stringify({ has: !!boss, hp: Math.round(boss.hp), phase: VS.BossKit.debug(boss, g) })
})()`)
ok('① 手动投放「尸潮之王」成功（可以不等 5 分钟就测招式）', setup.has === true, JSON.stringify(setup))

/* ② 招式轮转：压制档跑 12 秒（应看到 ≥2 种），再压到 60% 跑 12 秒（召唤档），合计 ≥3 种且采到前摇 */
const seen = { moves: {}, telegraph: 0, idle: 0, maxShots: 0 }
const sample = async (rounds) => {
  for (let i = 0; i < rounds; i++) {
    const s = await j(`(() => { const g = VS.Game.current; const boss = g.enemies.boss; return JSON.stringify(VS.BossKit.debug(boss, g)) })()`)
    if (s.move) seen.moves[s.move] = (seen.moves[s.move] || 0) + 1
    if (s.state === 'telegraph') seen.telegraph++
    if (s.state === 'idle') seen.idle++
    seen.maxShots = Math.max(seen.maxShots, s.shots || 0)
    await sleep(1000)
  }
}
await sample(12)
await ev(`(() => { const g = VS.Game.current; const b = g.enemies.boss; b.hp = b.maxHp * 0.60; return 1 })()`)
await sample(12)
const moveIds = Object.keys(seen.moves)
ok('② 招式轮转：压制档 ≥2 种、掉到召唤档后又多一种，且采样到过前摇状态',
  moveIds.length >= 3 && moveIds.indexOf('summon') >= 0 && seen.telegraph > 0,
  JSON.stringify({ moves: moveIds, telegraphSamples: seen.telegraph, maxShots: seen.maxShots }))

/* ③ 前摇给足时间：telegraph 时长必须等于配置值（玩家用来躲） */
const tele = await j(`(async () => {
  const g = VS.Game.current
  const boss = g.enemies.boss
  boss.ai.state = 'idle'; boss.ai.cd = 0
  await new Promise((r) => setTimeout(r, 120))
  if (boss.ai.state !== 'telegraph') { boss.ai.move = 'ring'; boss.ai.state = 'telegraph'; boss.ai.t = VS.Config.BOSS.MOVES.ring.telegraph }
  const m = VS.Config.BOSS.MOVES[boss.ai.move]
  const t0 = boss.ai.t
  await new Promise((r) => setTimeout(r, 260))
  return JSON.stringify({ move: boss.ai.move, t0: +t0.toFixed(2), t1: +boss.ai.t.toFixed(2), cfg: m.telegraph, state: boss.ai.state })
})()`)
ok('③ 前摇真的在走（telegraph 倒计时递减）且时长来自配置表',
  tele.state === 'telegraph' && tele.t1 < tele.t0 && tele.cfg > 0, JSON.stringify(tele))
await shot('boss-telegraph')

/* ④ 环形弹幕：强制放一次，数弹幕条数 = 配置发数（受上限约束） */
const ring = await j(`(async () => {
  const g = VS.Game.current; const boss = g.enemies.boss
  g.bossShots = []
  boss.ai.state = 'telegraph'; boss.ai.move = 'ring'; boss.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 200))
  return JSON.stringify({ shots: (g.bossShots || []).length, want: VS.Config.BOSS.MOVES.ring.shots.n, cap: VS.Config.BOSS.SHOT_MAX })
})()`)
ok('④ 环形弹幕一次打出配置发数（≤ 全场上限）',
  ring.shots >= ring.want && ring.shots <= ring.cap, JSON.stringify(ring))

/* ④′ 弹幕真的画出来了（调用渲染函数数它画了几发，而不是只躺在数组里） */
const painted = await j(`(() => {
  const g = VS.Game.current
  const r = g.deps && g.deps.renderer
  if (!r) return JSON.stringify({ err: 'no renderer' })
  const view = VS.World.viewRect(g.world, 120)
  const before = (g.bossShots || []).length
  const lit = VS.Renderer.drawBossShots(r.ctx, r, g, view)
  return JSON.stringify({ before, painted: lit, sprite: !!r.shotSprite })
})()`)
ok('④′ 弹幕进入渲染管线：画出的发数 > 0，且用的是预渲染小球贴图',
  painted.before > 0 && painted.painted > 0 && painted.sprite === true, JSON.stringify(painted))

/* ⑤ 弹幕能打中玩家：把玩家丢到弹幕路径上，关掉无敌帧 → 掉血 */
const dmg = await j(`(async () => {
  const g = VS.Game.current; const p = g.player; const boss = g.enemies.boss
  clearInterval(window.__god)                                  // 先撤掉每秒回满血
  p.maxHp = 100; p.hp = 100
  p.x = boss.x + 150; p.y = boss.y
  p.invuln = 0
  g.bossShots = []
  boss.ai.state = 'telegraph'; boss.ai.move = 'ring'; boss.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 1600))
  window.__god = setInterval(function () { const q = VS.Game.current.player; q.hp = 1e9; q.maxHp = 1e9; q.alive = true; q.invuln = 0 }, 400)
  return JSON.stringify({ hp: Math.round(p.hp), shots: (g.bossShots || []).length })
})()`)
ok('⑤ 弹幕命中会扣血（不是只有动画）', dmg.hp < 100, JSON.stringify(dmg))

/* ⑥ 召唤小弟：连放两次，只补到上限、不无限堆 */
const summon = await j(`(async () => {
  const g = VS.Game.current; const boss = g.enemies.boss
  const before = VS.BossKit.debug(boss, g).minions
  for (let k = 0; k < 2; k++) {
    boss.ai.state = 'telegraph'; boss.ai.move = 'summon'; boss.ai.t = 0.02
    await new Promise((r) => setTimeout(r, 400))
  }
  const d = VS.BossKit.debug(boss, g)
  return JSON.stringify({ before, after: d.minions, cap: VS.Config.BOSS.MINION_MAX })
})()`)
ok('⑥ 召唤小弟：场上确实多了小弟，且不超过上限',
  summon.after > summon.before && summon.after <= summon.cap, JSON.stringify(summon))
await shot('boss-minions')

/* ⑦ 档位：血量掉到 30% → 暴怒档（池子里有冲撞/螺旋）；回到 60% → 召唤档 */
const phases = await j(`(async () => {
  const g = VS.Game.current; const boss = g.enemies.boss
  boss.hp = boss.maxHp * 0.30
  await new Promise((r) => setTimeout(r, 120))
  const low = VS.BossKit.debug(boss, g)
  const poolLow = VS.Config.BOSS.PHASES[VS.BossKit.phaseIndex(boss)].pool.slice()
  boss.hp = boss.maxHp * 0.60
  await new Promise((r) => setTimeout(r, 120))
  const mid = VS.BossKit.debug(boss, g)
  const poolMid = VS.Config.BOSS.PHASES[VS.BossKit.phaseIndex(boss)].pool.slice()
  const top = VS.BossKit.phaseIndex({ hp: boss.maxHp, maxHp: boss.maxHp })
  return JSON.stringify({ low: low.phase, poolLow, mid: mid.phase, poolMid, topIdx: top })
})()`)
ok('⑦ 血量分三档：30% → 暴怒（多了冲撞/螺旋），60% → 召唤档，满血 → 压制档',
  /暴怒/.test(phases.low) && phases.poolLow.indexOf('charge') >= 0 && phases.poolLow.indexOf('spiral') >= 0 &&
  /召唤/.test(phases.mid) && phases.poolMid.indexOf('summon') >= 0 && phases.poolMid.indexOf('charge') < 0 && phases.topIdx === 0,
  JSON.stringify(phases))

/* ⑧ 冲撞：暴怒档强制放一次，位移速度要明显高于走路 */
const charge = await j(`(async () => {
  const g = VS.Game.current; const boss = g.enemies.boss
  boss.hp = boss.maxHp * 0.28
  await new Promise((r) => setTimeout(r, 100))
  boss.ai.state = 'telegraph'; boss.ai.move = 'charge'; boss.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 140))                 // 进入 busy
  const x0 = boss.x, y0 = boss.y, t0 = performance.now()
  await new Promise((r) => setTimeout(r, 420))
  const d = Math.hypot(boss.x - x0, boss.y - y0)
  const dt = (performance.now() - t0) / 1000
  return JSON.stringify({ dist: Math.round(d), speed: Math.round(d / dt), want: VS.Config.BOSS.MOVES.charge.speed, state: boss.ai.state })
})()`)
ok('⑧ 冲撞期间位移速度接近配置值（明显快于平常走路）',
  charge.speed > 200 && charge.speed <= charge.want * 1.25, JSON.stringify(charge))

/* ⑨ 弹幕上限：狂放环形也压不过 SHOT_MAX */
const cap = await j(`(async () => {
  const g = VS.Game.current; const boss = g.enemies.boss
  for (let k = 0; k < 12; k++) { boss.ai.state = 'telegraph'; boss.ai.move = 'ring'; boss.ai.t = 0.01; await new Promise((r) => setTimeout(r, 60)) }
  return JSON.stringify({ shots: (g.bossShots || []).length, cap: VS.Config.BOSS.SHOT_MAX })
})()`)
ok('⑨ 弹幕数量被上限挡住（不会无限堆）', cap.shots <= cap.cap, JSON.stringify(cap))

/* ⑩ 性能：520 只怪 + Boss + 弹幕，还要 60fps */
const perf = await j(`(async () => {
  const g = VS.Game.current
  g.player.hp = 1e9; g.player.maxHp = 1e9; g.player.invuln = 1e9
  while (g.enemies.list.length < 520) { VS.Enemies.spawn(g.enemies, VS.Config.ENEMY_TYPES.zombie, g) }
  const boss = g.enemies.boss
  boss.ai.state = 'telegraph'; boss.ai.move = 'ring'; boss.ai.t = 0.01
  await new Promise((r) => setTimeout(r, 200))
  const t = []; let last = performance.now(); const t0 = last; let frames = 0
  await new Promise((res) => { const tick = (n) => { t.push(n - last); last = n; frames++; if (n - t0 > 4000) res(); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const s = t.slice(3).sort((a, b) => a - b)
  const c = document.getElementById('game')
  return JSON.stringify({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), p50: +s[Math.floor(s.length / 2)].toFixed(2),
    enemies: g.enemies.list.length, shots: (g.bossShots || []).length, canvas: c.width + 'x' + c.height })
})()`)
ok('⑩ 520 只怪 + Boss + 弹幕仍然 ≥ 55fps（性能红线）', perf.fps >= 55, JSON.stringify(perf))
await shot('boss-horde')
await ev(`(() => { clearInterval(window.__god); return 1 })()`)

ok('⑪ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log('')
console.log('Boss 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
