// 《吸血鬼幸存者》平衡性测量台：页内挂一个「会跑会躲的机器人玩家」，把它的一整局数据打回来
// 用法：node tools/vs-balance.mjs <cdpPort> <url> <outDir> [capSec] [scenario]
//   scenario: play（默认，正常打，可死） | boss（4:40 起挂机，5 分钟人工投放 Boss 后集中测 Boss 战）
// 机器人会：① 远离最近的怪 ② 躲弹幕 ③ 顺手捡经验/补给 ④ 升级自动选第一张卡
// 数据：每 2 秒一行（时间/血量/等级/击杀/场上怪数/Boss 血量），外加死亡瞬间的总结
const [, , cdpPort, url, outDir, capArg, scenarioArg] = process.argv
const cap = Number(capArg || 480)
const scenario = scenarioArg || 'play'
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
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 140))
}
const send = (method, params = {}, ms = 30000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x, ms) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: ms || 30000 })).result?.result?.value

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
for (let i = 0; i < 150; i++) { if (String(await ev(`document.readyState`)) === 'complete' && await ev(`!!document.getElementById('startBtn')`)) break; await sleep(600) }

/* 页内机器人：直接合成键盘事件走**真实输入链路**（不偷改玩家坐标） */
const BOT = `(() => {
  const K = { w:0, a:0, s:0, d:0 }
  const hold = (k, want) => {
    if (want && !K[k]) { K[k] = 1; window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }
    else if (!want && K[k]) { K[k] = 0; window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })) }
  }
  window.__log = []
  let last = performance.now()
  window.__botTick = 0
  window.__botTimer = setInterval(() => {
    const g = VS.Game.current
    if (!g || !g.player) return
    const p = g.player
    if (g.state === 'levelup') {
      /* 选卡策略（像个人）：血少优先拿生存类，血厚优先伤害/攻速/武器升级 */
      const cards = [...document.querySelectorAll('#panel-levelup .card')]
      const hpPct = p.maxHp ? p.hp / p.maxHp * 100 : 100
      const score = (nm) => {
        const alive = /生命|再生|护甲|回复/.test(nm)
        const power = /伤害|攻速|穿透|飞弹|光环|新星|轨道|燃烧|爆炸|武器/.test(nm)
        return (hpPct < 65 ? (alive ? 3 : power ? 0.5 : 1) : (alive ? 1 : power ? 3 : 2))
      }
      let best = 0, bs = -1
      cards.forEach((c, i) => { const nm = (c.querySelector('.nm') || {}).textContent || ''; const s = score(nm); if (s > bs) { bs = s; best = i } })
      const key = String(best + 1)
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      return
    }
    if (g.state !== 'playing') return
    let vx = 0, vy = 0
    /* ① 躲弹幕：近的就往外推，权重最高 */
    const shots = g.bossShots || []
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i], dx = p.x - s.x, dy = p.y - s.y
      const d2 = dx*dx + dy*dy
      if (d2 > 190*190 || d2 < 1) continue
      const w = (190*190) / d2
      vx += (dx / Math.sqrt(d2)) * w * 2.4; vy += (dy / Math.sqrt(d2)) * w * 2.4
    }
    /* ② 躲怪：算"附近怪的重心"，朝重心反方向跑 —— 包围时求和会互相抵消（机器人会原地站死），
       朝重心反方向才能真的脱身 */
    let nearest = 1e9
    const list = g.enemies.list
    let cx = 0, cy = 0, cn = 0, bossPush = 0
    for (let i = 0; i < list.length; i++) {
      const e = list[i]
      if (e.dead) continue
      const dx = p.x - e.x, dy = p.y - e.y
      const d2 = dx*dx + dy*dy
      if (d2 < nearest) nearest = d2
      const R = e.boss ? 330 : 140
      if (d2 > R*R || d2 < 1) continue
      const w = e.boss ? 3 : 1
      cx += e.x * w; cy += e.y * w; cn += w
      if (d2 < 60*60) bossPush += 1.6                      // 贴脸时额外加力，别被顶着走
    }
    if (cn > 0) {
      const mx = cx / cn, my = cy / cn
      const ax = p.x - mx, ay = p.y - my
      const ad = Math.hypot(ax, ay) || 1
      const strength = 1.5 + bossPush + (cn - 1) * 0.25
      vx += (ax / ad) * strength; vy += (ay / ad) * strength
    }
    /* ③ 捡经验：朝"附近经验石的重心"走（这才是升级的主要来源），近身怪多时才让步 */
    const pk = g.pickups && g.pickups.list
    if (pk && pk.length) {
      let sx = 0, sy = 0, n = 0
      for (let i = 0; i < pk.length; i++) {
        const it = pk[i], dx = it.x - p.x, dy = it.y - p.y, d2 = dx*dx + dy*dy
        if (d2 > 520*520) continue
        const w = 1 / (1 + Math.sqrt(d2) / 160)
        sx += (it.x - p.x) * w; sy += (it.y - p.y) * w; n++
      }
      if (n) { const d = Math.hypot(sx, sy) || 1; const pull = Math.sqrt(nearest) > 120 ? 1.25 : 0.45; vx += (sx/d) * pull; vy += (sy/d) * pull }
    }
    /* ④ 别贴着地图边（贴边会被围死） */
    const world = g.world, pad = world.pad + 90
    if (p.x < pad) vx += 1.2; if (p.x > world.w - pad) vx -= 1.2
    if (p.y < pad) vy += 1.2; if (p.y > world.h - pad) vy -= 1.2
    hold('d', vx > 0.25); hold('a', vx < -0.25); hold('s', vy > 0.25); hold('w', vy < -0.25)
    window.__botTick++
  }, 90)
  window.__dmg = []
  /* 记伤害来源：谁打的、多少、当时最近的怪是什么、附近有几发弹幕 —— 平衡调参靠这个才知道"什么在杀你" */
  if (!window.__dmgHooked && VS.Player.takeDamage) {
    window.__dmgHooked = true
    const orig = VS.Player.takeDamage
    VS.Player.takeDamage = function (p, amount, game, sx, sy) {
      const dealt = orig.apply(VS.Player, arguments)
      try {
        if (dealt > 0) {
          const g = VS.Game.current
          const shots = g.bossShots || []
          let nearShot = 0
          for (let i = 0; i < shots.length; i++) { const s = shots[i]; if (Math.hypot(s.x - sx, s.y - sy) < 40 || Math.hypot(s.x - p.x, s.y - p.y) < 40) nearShot++ }
          let best = null, bd = 1e9
          const list = g.enemies.list
          for (let i = 0; i < list.length; i++) { const e = list[i]; if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e } }
          window.__dmg.push({ t: +g.time.toFixed(1), amount: Math.round(dealt), by: nearShot ? 'shot' : 'contact',
            enemy: best ? best.type : '', dist: best ? Math.round(bd) : -1, hp: Math.round(p.hp) })
        }
      } catch (e) { /* 记录失败不该影响游戏 */ }
      return dealt
    }
  }
  window.__sample = () => {
    const g = VS.Game.current, p = g.player
    const boss = g.enemies.boss
    return {
      t: +g.time.toFixed(1), state: g.state, hp: Math.round(p.hp), maxHp: Math.round(p.maxHp),
      lv: p.level, kills: p.kills, enemies: g.enemies.list.length, shots: (g.bossShots || []).length,
      boss: boss && !boss.dead ? { hp: Math.round(boss.hp), maxHp: Math.round(boss.maxHp), move: boss.ai ? boss.ai.move : '', state: boss.ai ? boss.ai.state : '' } : null
    }
  }
  return 1
})()`

await ev(`(() => { document.getElementById('startBtn').click(); return 1 })()`)
await sleep(1200)
await ev(BOT)
/* god 场景：血量常满，用来测「节奏」而不是「生存」——能不能撑到 5 分钟 Boss、到时什么等级、Boss 打多久 */
if (scenario === 'god') {
  await ev(`(() => {
    window.__godTimer = setInterval(function () {
      const g = VS.Game.current
      if (g && g.player) { g.player.hp = g.player.maxHp; g.player.alive = true; g.player.invuln = Math.max(g.player.invuln, 0.2) }
    }, 400)
    return 1
  })()`)
  console.log('（god 场景：血量常满，只测节奏与 Boss）')
}

const rows = []
let died = null
const t0 = Date.now()
while (Date.now() - t0 < cap * 1000) {
  const s = await ev(`(() => JSON.stringify(window.__sample()))()`)
  const st = (() => { try { return JSON.parse(String(s)) } catch (e) { return null } })()
  if (st) {
    rows.push(st)
    const hpPct = st.maxHp ? Math.round(st.hp / st.maxHp * 100) : 0
    console.log(`t=${String(st.t).padStart(6)}s  hp=${String(hpPct).padStart(3)}%  Lv.${String(st.lv).padStart(2)}  击杀 ${String(st.kills).padStart(4)}  怪 ${String(st.enemies).padStart(4)}  弹幕 ${String(st.shots).padStart(3)}${st.boss ? `  BOSS ${Math.round(st.boss.hp / st.boss.maxHp * 100)}% ${st.boss.state}/${st.boss.move}` : ''}`)
    if (st.state === 'gameover') { died = st; break }
  }
  await sleep(2000)
}
await ev(`(() => { clearInterval(window.__botTimer); if (window.__godTimer) clearInterval(window.__godTimer); return 1 })()`)

/* Boss 战小结（god 场景才有意义）：什么时候出现、打掉用了几秒、期间挨了多少下 */
const bossLog = (() => { try { return rows.filter((x) => x.boss) } catch (e) { return [] } })()
const bossFirst = bossLog[0]
const bossLast = bossLog[bossLog.length - 1]
const bossKilled = bossFirst && !bossLast.boss

const last = rows[rows.length - 1] || {}
const peakEnemies = rows.reduce((m, r) => Math.max(m, r.enemies), 0)
const maxShots = rows.reduce((m, r) => Math.max(m, r.shots), 0)

/* 伤害来源画像：谁在杀你（按来源与怪物类型汇总） */
const dmgLog = await (async () => { try { return JSON.parse(String(await ev(`JSON.stringify(window.__dmg || [])`))) } catch (e) { return [] } })()
const bySource = {}; const byEnemy = {}; let totalDmg = 0
for (const d of dmgLog) {
  totalDmg += d.amount
  bySource[d.by] = (bySource[d.by] || 0) + d.amount
  const key = d.enemy || '?'
  byEnemy[key] = (byEnemy[key] || 0) + d.amount
}
/* 死亡前 20 秒的挨打时间线（看是不是被"某个怪一直贴脸"磨死的） */
const deathWindow = died ? dmgLog.filter((d) => d.t > (last.t || 0) - 20) : []

const recap = {
  scenario, 结果: died ? '死亡' : '到时未死', 存活秒: last.t, 等级: last.lv, 击杀: last.kills,
  峰值怪数: peakEnemies, 峰值弹幕: maxShots, 采样点: rows.length,
  总受伤: totalDmg, 受伤次数: dmgLog.length, 伤害来源: bySource, 伤害按怪物: byEnemy,
  Boss: bossFirst ? { 出现于秒: Math.round(bossFirst.t), 结束秒: Math.round(bossLast.t), 击杀: !!bossKilled, 血量剩: bossLast.boss ? Math.round(bossLast.boss.hp / bossLast.boss.maxHp * 100) + '%' : '已死' } : '未出现',
  死前20秒挨打: deathWindow.map((d) => `${d.t}s -${d.amount}(${d.enemy}@${d.dist}px)`).join(' '),
  等级曲线: rows.filter((_, i) => i % 5 === 0).map((r) => `${Math.round(r.t)}s:Lv${r.lv}`).join(' '),
  血量曲线: rows.filter((_, i) => i % 5 === 0).map((r) => `${Math.round(r.t)}s:${r.maxHp ? Math.round(r.hp / r.maxHp * 100) : 0}%`).join(' '),
  异常: errs.slice(0, 3)
}
console.log('')
console.log('=== 总结 ===')
console.log(JSON.stringify(recap, null, 1))
if (outDir) await fs.writeFile(`${outDir}/balance-${scenario}.json`, JSON.stringify({ recap, rows, dmgLog }, null, 1))
process.exit(0)
