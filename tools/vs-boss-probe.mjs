// 「尸潮之王」加强版取证：三档血量 + 护盾阶段 + 七招（含激光/落石/冲撞）+ 狂暴 + 玩家闪避 + 性能
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
const ev = async (x, ms) => {
  const t = ms || 30000
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: t }, t + 8000)
  return r.result?.result?.value
}
const j = async (x) => { try { return JSON.parse(String(await ev(x))) } catch (e) { return {} } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data && outDir) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
for (let i = 0; i < 150; i++) { if (String(await ev(`document.readyState`)) === 'complete' && await ev(`!!document.getElementById('startBtn')`)) break; await sleep(600) }

/* 开局：不死 + 自动选卡（不然升级面板会把游戏冻住，后面的招式测试全失效） */
await ev(`(() => { document.getElementById('startBtn').click(); return 1 })()`)
await sleep(1200)
await ev(`(() => {
  const g = VS.Game.current
  g.time = 300
  g.player.maxHp = 1e9; g.player.hp = 1e9
  window.__god = setInterval(function () {
    const cur = VS.Game.current
    if (!cur || !cur.player) return
    cur.player.hp = 1e9; cur.player.maxHp = 1e9; cur.player.alive = true
    if (cur.state === 'levelup') window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
  }, 500)
  return 1
})()`)
const setup = await j(`(() => {
  const g = VS.Game.current
  const boss = VS.Enemies.spawnBoss(g.enemies, g)
  return JSON.stringify({ has: !!boss, hp: Math.round(boss.hp), static: VS.Config.ENEMY_TYPES.boss.hp })
})()`)
ok('① 投放「尸潮之王」（基础血量 6000 × 难度曲线，5:00 实到 ≈14700）', setup.has === true && setup.hp > 6000 && setup.static === 6000, JSON.stringify(setup))

/* 通用工具：把 Boss 拉回"干净"状态（清护盾、满血、暂停出招），每个用例互不污染 */
const RESET = `(() => {
  const g = VS.Game.current, b = g.enemies.boss
  if (!b) return 'no boss'
  b.hp = b.maxHp
  b.ai.shield = null; b.ai.invuln = 0; b.ai.vulnBonus = 1; b.ai.weakT = 0
  b.ai.meteors.length = 0; b.ai.meteorLeft = 0; b.ai.laser = null
  b.ai.enraged = false; b.ai.shieldAt = VS.Config.BOSS.SHIELD.AT.slice()
  b.ai.state = 'idle'; b.ai.cd = 99
  g.bossShots = []
  return 'ok'
})()`

/* 关键：升级面板会把整个游戏冻住（state=levelup），这时 Boss 不 step、玩家也动不了 ——
   每个用例开跑前先把待选卡点掉，确保真的在 playing 状态。 */
const ensurePlaying = async () => {
  for (let i = 0; i < 25; i++) {
    const st = String(await ev(`(() => { const g = VS.Game.current; if (g && g.state === 'levelup') window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true })); return g ? g.state : 'none' })()`))
    if (st === 'playing') return true
    await sleep(120)
  }
  return false
}

/* ② 招式轮转：把血线依次压到四档，每档强制连出几招（cd 归零），看招式池是不是真的在扩 */
const seenMoves = {}
for (const [frac, label] of [[1.0, '压制'], [0.55, '召唤'], [0.35, '暴怒'], [0.15, '狂暴']]) {
  await ev(RESET)
  for (let i = 0; i < 10; i++) {
    /* 每次采样前把冷却归零：保证这一档能连出好几招，而不是等自然冷却 */
    const d = await j(`(() => { const g = VS.Game.current, b = g.enemies.boss
      b.hp = b.maxHp * ${frac}; b.ai.shield = null; b.ai.invuln = 0; b.ai.enraged = (${frac} <= VS.Config.BOSS.ENRAGE.AT)
      if (b.ai.state === 'idle') b.ai.cd = 0
      return JSON.stringify(VS.BossKit.debug(b, g)) })()`)
    if (d.move) seenMoves[d.move] = (seenMoves[d.move] || 0) + 1
    if (d.shield) { await ev(`(() => { const g = VS.Game.current; for (const e of g.enemies.list.slice()) if (!e.boss) VS.Enemies.kill(g, e); return 1 })()`); await sleep(200) }
    await sleep(700)
  }
}
const moveIds = Object.keys(seenMoves)
const advanced = moveIds.filter((m) => ['summon', 'meteor', 'spiral', 'charge', 'laser'].indexOf(m) >= 0)
/* 池子内容是确定性的（配置表），实测招式是随机的 —— 两条一起看才稳 */
const pools = await j(`(() => JSON.stringify(VS.Config.BOSS.PHASES.map((p) => ({ name: p.name, pool: p.pool }))))()`)
const poolOf = (n) => (pools.find((p) => p.name === n) || {}).pool || []
const poolsOk = ['ring', 'spread', 'meteor'].every((m) => poolOf('压制').indexOf(m) >= 0) &&
  ['summon', 'laser'].every((m) => poolOf('召唤').indexOf(m) >= 0) &&
  ['spiral', 'charge'].every((m) => poolOf('暴怒').indexOf(m) >= 0) &&
  poolOf('狂暴').length >= 5
ok('② 四档招式池确实在扩（配置表核对 + 实战抽样）',
  poolsOk && moveIds.length >= 4 && advanced.length >= 2 && moveIds.indexOf('meteor') >= 0,
  JSON.stringify({ seen: moveIds, advanced, pools }))

/* ③ 前摇：telegraph 倒计时必须真的在走 */
const tele = await j(`(async () => {
  const g = VS.Game.current, b = g.enemies.boss
  b.ai.shield = null; b.ai.invuln = 0
  b.ai.state = 'telegraph'; b.ai.move = 'ring'; b.ai.t = VS.Config.BOSS.MOVES.ring.telegraph
  const t0 = b.ai.t
  await new Promise((r) => setTimeout(r, 300))
  return JSON.stringify({ t0: +t0.toFixed(2), t1: +b.ai.t.toFixed(2), state: b.ai.state })
})()`)
ok('③ 前摇倒计时在走（玩家有反应时间）', tele.t1 < tele.t0, JSON.stringify(tele))
await shot('boss-telegraph')

/* ④ 环形弹幕：一次 22 发，且真的画出来 */
const ring = await j(`(async () => {
  const g = VS.Game.current, b = g.enemies.boss
  g.bossShots = []
  b.ai.state = 'telegraph'; b.ai.move = 'ring'; b.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 200))
  const r0 = g.deps && g.deps.renderer
  const painted = r0 ? VS.Renderer.drawBossShots(r0.ctx, r0, g, VS.World.viewRect(g.world, 120)) : -1
  return JSON.stringify({ shots: (g.bossShots || []).length, want: VS.Config.BOSS.MOVES.ring.shots.n, painted, cap: VS.Config.BOSS.SHOT_MAX })
})()`)
ok('④ 环形弹幕打满配置发数且进入渲染管线', ring.shots >= ring.want && ring.painted > 0 && ring.shots <= ring.cap, JSON.stringify(ring))

/* ⑤ 护盾阶段（配队思路核心）：跌破 62% → 无敌 + 召唤 8 只；清完 → 破盾 + 虚弱加成 */
await ev(RESET)
const shield = await j(`(async () => {
  const g = VS.Game.current, b = g.enemies.boss
  const S = VS.Config.BOSS
  b.hp = b.maxHp * (S.SHIELD.AT[0] - 0.02)
  await new Promise((r) => setTimeout(r, 300))
  const mid = VS.BossKit.debug(b, g)
  const hpBefore = b.hp
  VS.Enemies.hurt(g, b, 5000, false, 0, 0)              // 护盾期里打伤害应当无效
  const hpAfter = b.hp
  for (const e of g.enemies.list.slice()) if (!e.boss) VS.Enemies.kill(g, e)
  await new Promise((r) => setTimeout(r, 300))
  const after = VS.BossKit.debug(b, g)
  return JSON.stringify({ midShield: mid.shield, midMinions: mid.minions, invuln: mid.invuln, blocked: hpAfter === hpBefore,
    afterShield: after.shield, vulnBonus: after.vulnBonus })
})()`)
ok('⑤ 护盾阶段：无敌 + 召唤一波；清光小弟才破盾并进入虚弱窗口',
  shield.midShield === true && shield.midMinions >= 8 && shield.blocked === true &&
  shield.afterShield === false && shield.vulnBonus > 1, JSON.stringify(shield))
await shot('boss-shield')

await ensurePlaying();
/* ⑥ 激光横扫 + 落石：两种新机制都要真的出现 */
const hazard = await j(`(async () => {
  const g = VS.Game.current, b = g.enemies.boss
  g.pendingLevels = 0; g.player.xp = 0
  b.ai.shield = null; b.ai.invuln = 0; b.ai.state = 'telegraph'; b.ai.move = 'laser'; b.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 250))
  const laser = !!b.ai.laser
  await new Promise((r) => setTimeout(r, 300))
  const laserAng = b.ai.laser ? b.ai.laser.ang : 0
  await new Promise((r) => setTimeout(r, 400))
  const swept = b.ai.laser ? Math.abs(b.ai.laser.ang - laserAng) : 0
  b.ai.laser = null
  b.ai.state = 'telegraph'; b.ai.move = 'meteor'; b.ai.t = 0.02
  await new Promise((r) => setTimeout(r, 900))
  const meteors = b.ai.meteors.length
  await new Promise((r) => setTimeout(r, 1600))
  return JSON.stringify({ laser, swept: +swept.toFixed(2), meteors, meteorLeft: b.ai.meteorLeft })
})()`)
ok('⑥ 激光会横扫（角度在变）、落石会在地上留标记',
  hazard.laser === true && hazard.swept > 0.1 && hazard.meteors > 0, JSON.stringify(hazard))
await shot('boss-laser')

await ensurePlaying();
/* ⑦ 狂暴：血量 ≤18% 触发，冷却更短 */
const enrage = await j(`(async () => {
  const g = VS.Game.current, b = g.enemies.boss
  b.ai.shield = null; b.ai.invuln = 0; b.ai.enraged = false
  b.hp = b.maxHp * 0.16
  await new Promise((r) => setTimeout(r, 200))
  return JSON.stringify({ enraged: b.ai.enraged, phase: VS.BossKit.debug(b, g).phase, cfg: VS.Config.BOSS.ENRAGE })
})()`)
ok('⑦ 血量跌破 18% → 狂暴（招式更快更疼）', enrage.enraged === true && /狂暴/.test(enrage.phase), JSON.stringify({ enraged: enrage.enraged, phase: enrage.phase }))

await ensurePlaying();
/* ⑧ 闪避（手法）：按 Shift 冲一段 + 无敌帧能吃掉伤害 */
const dash = await j(`(async () => {
  const g = VS.Game.current, p = g.player
  p.dashCd = 0; p.dashT = 0; p.invuln = 0
  const x0 = p.x, y0 = p.y
  const okDash = VS.Player.dash(p, { x: 1, y: 0 }, g)
  await new Promise((r) => setTimeout(r, 260))
  const moved = Math.abs(p.x - x0)
  const invulnDuring = p.invuln
  const dmg = VS.Player.takeDamage(p, 999, g, 0, 0)     // 无敌帧内应当被完全挡下
  return JSON.stringify({ okDash, moved: Math.round(moved), invulnDuring: +invulnDuring.toFixed(2), blockedDamage: dmg === 0,
    cfg: VS.Config.PLAYER.DASH })
})()`)
ok('⑧ 闪避真的能位移 + 无敌帧挡伤害（Boss 变难后的"手法"入口）',
  dash.okDash === true && dash.moved > 80 && dash.blockedDamage === true, JSON.stringify(dash))

/* ⑨ 性能：520 只怪 + Boss 全套招式仍然 60fps 量级 */
const perf = await j(`(async () => {
  const g = VS.Game.current
  while (g.enemies.list.length < 520) VS.Enemies.spawn(g.enemies, VS.Config.ENEMY_TYPES.zombie, g)
  const b = g.enemies.boss
  b.ai.state = 'telegraph'; b.ai.move = 'ring'; b.ai.t = 0.01
  await new Promise((r) => setTimeout(r, 200))
  b.ai.state = 'telegraph'; b.ai.move = 'meteor'; b.ai.t = 0.01
  await new Promise((r) => setTimeout(r, 400))
  const t = []; let last = performance.now(); const t0 = last; let frames = 0
  await new Promise((res) => { const tick = (n) => { t.push(n - last); last = n; frames++; if (n - t0 > 4000) res(); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const s = t.slice(3).sort((a, b) => a - b)
  return JSON.stringify({ fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1), p50: +s[Math.floor(s.length / 2)].toFixed(2),
    enemies: g.enemies.list.length, shots: (g.bossShots || []).length, meteors: b.ai.meteors.length })
})()`)
ok('⑨ 520 只怪 + Boss 弹幕/落石齐发仍然 ≥ 55fps', perf.fps >= 55, JSON.stringify(perf))
await shot('boss-horde')

/* ⑩ TTK：给玩家一套"中期构筑"（bolt Lv5 + 光环 Lv4），量打死加强版 Boss 要多久、期间挨多少下。
   机器人不会闪避，所以"每 10 秒兜一次血"用来模拟会躲的玩家；这里只看 TTK 落在合理区间。
   注意：这个测量最长要跑 90 秒，得单独给它一个长的 evaluate 超时。 */
const ttk = JSON.parse(String(await ev(`(async () => {
  const g = VS.Game.current, p = g.player, b = g.enemies.boss
  g.pendingLevels = 0; p.xp = 0
  for (const e of g.enemies.list.slice()) if (!e.boss) VS.Enemies.kill(g, e)
  b.hp = b.maxHp; b.ai.shield = null; b.ai.invuln = 0; b.ai.vulnBonus = 1; b.ai.enraged = false
  b.ai.shieldAt = VS.Config.BOSS.SHIELD.AT.slice()
  g.bossShots = []
  p.weapons = []; p.upgrades = {}; p.damageMul = 1; p.attackSpeedMul = 1
  VS.Weapons.add(p, 'bolt'); VS.Weapons.add(p, 'garlic')
  for (let i = 0; i < 4; i++) VS.Weapons.upgrade(p, 'bolt')
  for (let i = 0; i < 3; i++) VS.Weapons.upgrade(p, 'garlic')
  p.maxHp = 140; p.hp = 140; p.armor = 0; p.invuln = 0
  let hits = 0, dmg = 0
  const orig = VS.Player.takeDamage
  VS.Player.takeDamage = function (pl, amount, gm, sx, sy) { const d = orig.apply(VS.Player, arguments); if (d > 0) { hits++; dmg += d } return d }
  /* 只统计真正落到 Boss 身上的伤害（含虚弱期加成、扣掉护盾期的"免疫"），
     这样 TTK 调参才有依据：bossDmg/secs 就是"中期构筑对 Boss 的实际 DPS"。 */
  let bossDmg = 0, invulnTicks = 0, shieldWaves = 0, shieldSeen = false
  const hurtOrig = VS.Enemies.hurt
  VS.Enemies.hurt = function (gm, e, amount) {
    const before = e && e.hp
    const r = hurtOrig.apply(VS.Enemies, arguments)
    if (e && e.boss && typeof before === 'number') bossDmg += Math.max(0, before - e.hp)
    return r
  }
  const t0 = performance.now()
  let tick = 0, distSum = 0
  while (!b.dead && (performance.now() - t0) < 120000) {
    await new Promise((r) => setTimeout(r, 500))
    if (b.ai.invuln > 0) { invulnTicks++; if (!shieldSeen) { shieldSeen = true; shieldWaves++ } }
    else shieldSeen = false
    if (b.ai.shield) { for (const e of g.enemies.list.slice()) if (!e.boss) VS.Enemies.kill(g, e) }
    /* 机器人本体是"重心逃逸"，会一直往外跑 —— 但真打 Boss 的人不会边打边退到弹幕外，
       否则 DPS 全看运气（实测同一套构筑两局 117 vs 203 DPS）。这里加一条"缠斗"约束：
       离 Boss 超过 240px 就以 ≈玩家速度把它拉回来，模拟"敢贴脸打的人"。 */
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy)
    distSum += d
    if (d > 240) { const k = Math.min(60, d - 240) / d; p.x += dx * k; p.y += dy * k }
    if (++tick % 20 === 0) p.hp = p.maxHp
  }
  const secs = (performance.now() - t0) / 1000
  VS.Player.takeDamage = orig
  VS.Enemies.hurt = hurtOrig
  const bossMax = Math.round(b.maxHp)
  return JSON.stringify({ killed: !!b.dead, secs: +secs.toFixed(1), hits, dmg,
    bossDmg: Math.round(bossDmg), dps: Math.round(bossDmg / secs), bossMax, avgDist: Math.round(distSum / Math.max(1, tick)),
    bossHpLeftPct: Math.round(b.hp / b.maxHp * 100), shieldWaves,
    invulnPct: Math.round(invulnTicks / tick * 100), hpLeftPct: Math.round(p.hp / p.maxHp * 100),
    cfgHp: VS.Config.ENEMY_TYPES.boss.hp })
})()`, 150000)))
ok('⑩ 中期构筑（bolt Lv5 + 光环 Lv4）打得死：TTK 落在 20~95 秒（既不是秒杀，也不是打不动）',
  ttk.killed === true && ttk.secs >= 20 && ttk.secs <= 95, JSON.stringify(ttk))
await shot('boss-ttk')
await ev(`(() => { clearInterval(window.__god); return 1 })()`)

ok('⑪ 全程 0 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log('')
console.log('Boss 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
