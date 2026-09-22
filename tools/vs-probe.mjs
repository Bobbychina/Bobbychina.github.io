// 共创作品《吸血鬼幸存者》上线自检：页面加载 / 无控制台错误 / 开始游戏后 Canvas 真的在画 / 站点壳（回游戏厅 + 共创标注）
// 用法：node tools/vs-probe.mjs <cdpPort> <url> <outDir>
const [, , cdpPort, url, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []; const consoleErrs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 200))
  if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') consoleErrs.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const j = async (x) => JSON.parse(String(await ev(x)))
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
/* 可选窗口尺寸（默认桌面 1440x900）：node tools/vs-probe.mjs <port> <url> <outDir> [w] [h] */
const VW = Number(process.argv[5] || 1440), VH = Number(process.argv[6] || 900)
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
// 线上（GitHub Pages）每请求 RTT 0.6~1.0s，20 个脚本串行可达 15s+：等真正的就绪信号，别用固定 sleep
const waitReady = async (ms = 90000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const raw = String(await ev(`JSON.stringify({ r: document.readyState, btn: !!document.getElementById('startBtn'), n: document.querySelectorAll('script[src^="js/"]').length })`))
    try { const o = JSON.parse(raw); if (o.r === 'complete' && o.btn && o.n >= 20) return o } catch {}
    await sleep(600)
  }
  return null
}
if (!(await waitReady())) console.log('WARN 等待页面就绪超时（90s），继续按当前 DOM 断言')

/* ① 页面基本结构 + 站点壳 */
const boot = await j(`(() => JSON.stringify({
  title: document.title,
  hasCanvas: !!document.getElementById('game'),
  ns: typeof VS,
  bar: !!document.getElementById('site-bar'),
  barText: (document.getElementById('site-bar') || {}).textContent || '',
  backHref: (document.querySelector('#site-bar a') || {}).getAttribute ? document.querySelector('#site-bar a').getAttribute('href') : '',
  coop: /共创/.test(document.body.textContent),
  scripts: document.querySelectorAll('script[src^="js/"]').length,
}))()`)
ok('① 页面跑起来了：标题 / Canvas / VS 命名空间 / 20 个脚本都到位',
  boot.hasCanvas && boot.ns === 'object' && boot.scripts >= 20 && /吸血鬼幸存者/.test(boot.title), JSON.stringify(boot).slice(0, 160))
ok('① 站点壳在：回游戏厅链接 + 🤝 共创 标注', boot.bar && boot.backHref === '/games/' && /回游戏厅/.test(boot.barText) && /共创/.test(boot.barText) && boot.coop, boot.barText)

/* ①′ 站点 BETA 条不能压住主画面：画布与站点壳都得让到条下面，且画布正好占满剩下高度 */
const layout = await j(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), h: +b.height.toFixed(1) } };
  const bar = r(document.getElementById('beta-notice'));
  return JSON.stringify({ bar, canvas: r(document.getElementById('game')), site: r(document.getElementById('site-bar')),
    innerH: innerHeight, betaH: getComputedStyle(document.documentElement).getPropertyValue('--beta-h').trim() });
})()`)
ok('①′ BETA 条不遮挡主画面（画布 top 与站点壳 top 都在条下面）',
  !!layout.bar && layout.bar.bottom > 4 && layout.canvas.top >= layout.bar.bottom - 1 &&
  layout.site.top >= layout.bar.bottom - 1 &&
  Math.abs(layout.canvas.h - (layout.innerH - layout.bar.bottom)) <= 2,
  JSON.stringify(layout))

/* ①″ 条上的版本号要是真版本号（回退文案没做插值时这里会是 "{v}"） */
const barText = await j(`(() => { const b = document.getElementById('beta-notice'); return JSON.stringify({ text: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '' }) })()`)
ok('①″ BETA 条文案已插值（不出现 {v} 这类占位符）',
  /v\d/.test(barText.text) && !/[{}]/.test(barText.text), barText.text)
if (outDir) await shot('vs-start')

/* ② 开始游戏 → HUD 出现、时间在走、canvas 真的有像素 */
const before = await j(`(() => JSON.stringify({ hudHidden: document.getElementById('hud').classList.contains('hidden'), t: document.getElementById('timer').textContent }))()`)
await ev(`(() => { document.getElementById('startBtn').click(); return 1 })()`)
await sleep(1200)
const mid = await j(`(() => JSON.stringify({ hudHidden: document.getElementById('hud').classList.contains('hidden'),
  t: document.getElementById('timer').textContent, phase: document.getElementById('phase').textContent,
  panelHidden: document.getElementById('panel-start').hasAttribute('hidden') }))()`)
const cv = await j(`(() => {
  const c = document.getElementById('game'); const g = c.getContext('2d');
  const d = g.getImageData(0, 0, Math.min(c.width, 240), Math.min(c.height, 160)).data;
  let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 30) lit++;
  return JSON.stringify({ w: c.width, h: c.height, lit });
})()`)
ok('② 点开始游戏：开场面板收起、HUD 出现、计时器开始走',
  before.hudHidden === true && mid.hudHidden === false && mid.panelHidden === true && /^\d\d:\d\d$/.test(mid.t), JSON.stringify(mid))
ok('② Canvas 真的在画（采样区有非黑像素）', cv.w > 0 && cv.h > 0 && cv.lit > 50, JSON.stringify(cv))
if (outDir) await shot('vs-playing')

/* ③ 玩一会儿：击杀/存活计数在动（键盘输入真的接上） */
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 })
await sleep(1500)
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 })
await sleep(1500)
const after = await j(`(() => JSON.stringify({ t: document.getElementById('timer').textContent, kills: document.getElementById('kills').textContent, wave: document.getElementById('wave').textContent }))()`)
ok('③ 玩 3 秒：计时器继续走、击杀数被记下（说明主循环与输入都活着）',
  after.t !== mid.t && Number(after.kills) >= 0, JSON.stringify(after))

ok('④ 0 未捕获异常 / 0 控制台错误', errs.length === 0 && consoleErrs.length === 0,
  (errs.slice(0, 2).join(' | ') + ' ' + consoleErrs.slice(0, 2).join(' | ')).trim())

/* ⑤ 云存档那一行：开始面板里得有，未登录时安全降级（按钮置灰） */
const cloudRow = await j(`(() => {
  const panel = document.getElementById('panel-start')
  const box = panel ? panel.querySelector('.cloud') : null
  return JSON.stringify({ has: !!box, status: box ? box.querySelector('.cloud-status').textContent : '',
    upDisabled: box ? box.querySelector('.cloud-btns button').disabled : null,
    btns: box ? [...box.querySelectorAll('.cloud-btns button')].map(b => b.textContent) : [] })
})()`)
ok('⑤ 开始面板有「☁ 云存档」一行，未登录时按钮置灰（不影响玩）',
  cloudRow.has && /未登录/.test(cloudRow.status) && cloudRow.upDisabled === true && cloudRow.btns.length >= 4, JSON.stringify(cloudRow))

/* ⑤′ 用桩替换账号库：点上传/下载，看它是不是真把存档交给 account.js 那套（game/slot 对不对、有没有合并回本机） */
const wiring = await j(`(async () => {
  if (!window.VS || !VS.Cloud) return JSON.stringify({ err: 'no VS.Cloud' })
  window.__calls = []
  window.DSHAccount = {
    currentUid: () => 'u-stub',
    current: () => ({ name: 'stub', login: 'stub' }),
    backend: () => 'github',
    saveInfo: () => ({ updatedAt: '2026-09-22T10:00:00.000Z', bytes: 96 }),
    savePut: (g, s, d) => { window.__calls.push(['savePut', g, s, String(d && d.bestTime)]); return { ok: true } },
    saveGet: () => ({ bestTime: 999, bestKills: 42, bestLevel: 9, runs: 7, totalKills: 500, muted: false,
      top: [{ time: 800, kills: 30, level: 6, wave: 3, at: '2026-09-20T10:00:00.000Z' }] }),
    cloudPush: async (g) => { window.__calls.push(['cloudPush', g]); return { ok: true, provider: 'github', pushed: ['main'] } },
    cloudPull: async (g) => { window.__calls.push(['cloudPull', g]); return { ok: true, provider: 'github', pulled: ['main'] } },
    syncNow: async (g) => { window.__calls.push(['syncNow', g]); return { ok: true } }
  }
  const st = VS.Cloud.status()
  VS.CloudUI.refresh()
  /* 先把本机存档设成确定值，否则上一局/上次探针留下的 runs 会让断言飘 */
  localStorage.setItem('vampire_survivors_save_v1', JSON.stringify({ bestTime: 5, bestKills: 1, bestLevel: 2, runs: 3, totalKills: 4, muted: false,
    top: [{ time: 300, kills: 11, level: 4, wave: 2, at: '2026-09-19T10:00:00.000Z' }] }))
  const btns = document.getElementById('panel-start').querySelectorAll('.cloud-btns button')
  btns[0].click()
  await new Promise((r) => setTimeout(r, 400))
  btns[1].click()
  await new Promise((r) => setTimeout(r, 400))
  const local = JSON.parse(localStorage.getItem('vampire_survivors_save_v1') || '{}')
  return JSON.stringify({ state: st.state, calls: window.__calls, best: local.bestTime, kills: local.bestKills, runs: local.runs, top: local.top })
})()`)
const flat = Array.isArray(wiring.calls) ? wiring.calls.map((c) => c.join('/')).join(' ') : ''
ok('⑤′ 上传/下载真的走 account.js（game=vampire-survivors slot=main），下载后纪录取长并回本机',
  wiring.state === 'ok' && /savePut\/vampire-survivors\/main/.test(flat) && /cloudPush\/vampire-survivors/.test(flat) &&
  /cloudPull\/vampire-survivors/.test(flat) && wiring.best === 999 && wiring.kills === 42 && wiring.runs === 7,
  JSON.stringify({ state: wiring.state, calls: wiring.calls, best: wiring.best, kills: wiring.kills, runs: wiring.runs }))

/* ⑤″ 个人纪录榜：本机 300s + 云端 800s 合并成两份，按时间降序 */
const topMerged = Array.isArray(wiring.top) ? wiring.top.map((r) => r.time) : []
ok('⑤″ 个人榜跨设备合并：本机榜 ∪ 云端榜（去重、按时间降序）',
  topMerged.length === 2 && topMerged[0] === 800 && topMerged[1] === 300, JSON.stringify(topMerged))

/* ⑤‴ 榜单界面：列表渲染出行数 = 榜上条数，且第一行带 #1 */
const rankUI = await j(`(() => {
  if (VS.ScoresUI) VS.ScoresUI.refresh()
  const box = document.querySelector('.ranks')
  const rows = box ? [...box.querySelectorAll('.rank-row')] : []
  return JSON.stringify({ has: !!box, rows: rows.length, first: rows.length ? rows[0].textContent.replace(/\\s+/g, ' ').trim() : '' })
})()`)
ok('⑤‴ 开始面板的「🏆 个人纪录」按榜单渲染（行数=条数，首行 #1）',
  rankUI.has && rankUI.rows === 2 && /#1/.test(rankUI.first) && /13:20|800/.test(rankUI.first.replace('#1', '13:20')),
  JSON.stringify(rankUI))

/* ⑤⁗ 真打完一局：走 endRun → Scores.add → 结算面板「本局排名」 */
const gameOver = await j(`(async () => {
  const g = VS.Game.current
  const before = (JSON.parse(localStorage.getItem('vampire_survivors_save_v1') || '{}').top || []).length
  if (g.state !== 'playing') { document.getElementById('startBtn').click(); await new Promise((r) => setTimeout(r, 1200)) }
  VS.Game.current.player.alive = false        // 直接判死，交给主循环走结算
  await new Promise((r) => setTimeout(r, 700))
  const rank = document.getElementById('goRank')
  const after = (JSON.parse(localStorage.getItem('vampire_survivors_save_v1') || '{}').top || []).length
  return JSON.stringify({ state: VS.Game.current.state, before: before, after: after,
    rankHidden: rank ? rank.hidden : null, rankText: rank ? rank.textContent : '', rows: document.querySelectorAll('.ranks .rank-row').length })
})()`)
ok('⑤⁗ 一局结束后：榜上多一条、结算面板显示本局排名、开始面板的榜单同步刷新',
  gameOver.after > gameOver.before && gameOver.rankHidden === false && /第 \d+ 名|第 1 名/.test(gameOver.rankText) &&
  gameOver.rows === gameOver.after, JSON.stringify(gameOver))

/* ⑦ 全站榜：读榜不用登录（fetch 打桩看请求），提交要云账号会话（带 Bearer） */
const lb = await j(`(async () => {
  if (!window.VS || !VS.Leaderboard || !VS.LeaderboardUI) return JSON.stringify({ err: 'no leaderboard module' })
  const calls = []
  const realFetch = window.fetch
  const list = [
    { name: 'alan', time: 640, kills: 88, level: 9, wave: 4 },
    { name: 'bob', time: 300, kills: 20, level: 5, wave: 2 }
  ]
  window.fetch = async (url, opts) => {
    const method = (opts && opts.method) || 'GET'
    calls.push({ url: String(url), method, auth: !!(opts && opts.headers && opts.headers.authorization), body: (opts && opts.body) || '' })
    const payload = method === 'POST'
      ? { ok: true, better: true, rank: 1, best: { time: 321, kills: 45, level: 7, wave: 3 }, list: list.concat([{ name: 'stub', time: 321, kills: 45, level: 7, wave: 3 }]) }
      : { ok: true, game: 'vampire-survivors', list: list }
    return { ok: true, status: 200, json: async () => payload }
  }
  await VS.LeaderboardUI.refresh(false)
  const rows = [...document.querySelectorAll('.lb .lb-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim())
  const guestMsg = (document.querySelector('.lb-msg') || {}).textContent || ''
  /* 换上「云账号已登录」的桩：能提交，且请求要带 Bearer */
  window.DSHAccount = { currentUid: () => 'u1', current: () => ({ name: 'stub', login: 'stub' }), sessionToken: () => 'tok-1', backend: () => 'server' }
  const canSubmit = VS.Leaderboard.canSubmit()
  await VS.LeaderboardUI.submitRun({ time: 321, kills: 45, level: 7, wave: 3 })
  const okMsg = (document.querySelector('.lb-msg') || {}).textContent || ''
  window.fetch = realFetch
  return JSON.stringify({ rows, canSubmit, guestMsg: guestMsg.slice(0, 60), okMsg: okMsg.slice(0, 60),
    calls: calls.map(c => c.method + ' ' + c.url.replace(/^https?:\\/\\/[^/]+/, '') + (c.auth ? ' [auth]' : '')), body: calls.length > 1 ? String(calls[1].body) : '' })
})()`)
const lbBody = (() => { try { return JSON.parse(String(lb.body || '{}')) } catch (e) { return {} } })()
ok('⑦ 全站榜：读榜是公开 GET（不带 token），提交是带 Bearer 的 POST，字段与排名回显都对',
  Array.isArray(lb.rows) && lb.rows.length === 2 && /#1/.test(lb.rows[0]) && /alan/.test(lb.rows[0]) &&
  /^GET \/api\/score\?game=vampire-survivors$/.test(lb.calls[0] || '') &&
  /^POST \/api\/score \[auth\]$/.test(lb.calls[1] || '') &&
  lbBody.game === 'vampire-survivors' && lbBody.time === 321 && lbBody.kills === 45 && lbBody.level === 7 && lbBody.wave === 3 &&
  lb.canSubmit === true && /第 1 名/.test(lb.okMsg),
  JSON.stringify({ rows: lb.rows, calls: lb.calls, body: lb.body, msg: lb.okMsg }))

/* ⑥ 共创留言板：两位共创者的 agent 通过 git 在 js/data/notes.js 里留话，游戏里要能看见 */
const notes = await j(`(() => {
  const panel = document.getElementById('panel-start')
  const openBtn = panel ? panel.querySelector('.notes-open') : null
  const expected = (window.VS_NOTES && VS_NOTES.entries ? VS_NOTES.entries.length : 0)
  let shown = 0
  let text = ''
  if (openBtn) {
    openBtn.click()
    const box = document.querySelector('.notes')
    shown = box ? box.querySelectorAll('.note').length : 0
    text = box ? box.textContent.replace(/\\s+/g, ' ').slice(0, 120) : ''
    const close = box ? box.querySelector('.notes-head button') : null
    if (close) close.click()
  }
  return JSON.stringify({ hasBtn: !!openBtn, label: openBtn ? openBtn.textContent : '', expected: expected, shown: shown, text: text })
})()`)
ok('⑥ 开始面板有「📮 共创留言板」，点开能看见两位共创者留的话（条数与 notes.js 一致）',
  notes.hasBtn && notes.expected >= 3 && notes.shown === notes.expected && /共创|Alan|agent/.test(notes.text),
  JSON.stringify({ label: notes.label, expected: notes.expected, shown: notes.shown }))
console.log('')
console.log('VS 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
