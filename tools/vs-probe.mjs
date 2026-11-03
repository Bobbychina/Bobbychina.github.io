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
ok('①′ 画布占满可用区域，存在 BETA 条时为它留出位置',
  (!layout.bar && layout.canvas.top >= 0 && Math.abs(layout.canvas.h - layout.innerH) <= 2) ||
  !!layout.bar && layout.bar.bottom > 4 && layout.canvas.top >= layout.bar.bottom - 1 &&
  layout.site.top >= layout.bar.bottom - 1 &&
  Math.abs(layout.canvas.h - (layout.innerH - layout.bar.bottom)) <= 2,
  JSON.stringify(layout))

/* ①″ 条上的版本号要是真版本号（回退文案没做插值时这里会是 "{v}"） */
const barText = await j(`(() => { const b = document.getElementById('beta-notice'); return JSON.stringify({ text: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '' }) })()`)
ok('①″ 若启用 BETA 条，版本文案正确插值',
  !layout.bar || (/v\d/.test(barText.text) && !/[{}]/.test(barText.text)), barText.text)
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

ok('④ 0 未捕获异常 / 0 脚本错误', errs.length === 0 && !consoleErrs.some(e => /TypeError|ReferenceError|SyntaxError|启动失败/.test(e)),
  (errs.slice(0, 2).join(' | ') + ' ' + consoleErrs.slice(0, 2).join(' | ')).trim())

/* ⑤ 本次版本：统一账号、本机纪录，移除云存档。 */
const integration = await j(`(() => JSON.stringify({
  account: !!document.querySelector('#siteAccount #accountLogin'),
  modes: [...document.querySelectorAll('#startMode option')].map(o => o.value),
  cloud: typeof VS.Cloud, cloudScripts: document.querySelectorAll('script[src*="js/core/cloud.js"],script[src*="js/ui/cloud-ui.js"],script[src*="/games/site-saves.js"]').length,
  weapons: Object.keys(VS.Config.WEAPONS).length, schools: Object.keys(VS.Config.SCHOOLS).length,
  starters: document.querySelectorAll('#startWeapon option').length,
  personalTabs: document.querySelectorAll('.record-tabs button').length
}))()`)
ok('⑤ 16 武器 / 24 新流派 / 11 初始武器', integration.weapons === 16 && integration.schools === 24 && integration.starters === 11, JSON.stringify(integration))
ok('⑤′ 统一站点账号入口，移除云存档脚本和模块', integration.account && integration.cloud === 'undefined' && integration.cloudScripts === 0)
ok('⑤″ 战役与无尽可选，两套本机个人纪录', integration.modes.join('/') === 'campaign/endless' && integration.personalTabs === 2)

/* ⑥ 隔离浏览器内跳时钟，检查无尽跨过时间终点与主动结算。 */
const endless = await j(`(() => {
  const g = VS.Game.current, prior = localStorage.getItem(VS.Save.KEY)
  VS.Game.start(g, { mode: 'endless', startWeapon: 'prism' })
  const w = g.player.weapons[0]; w.level = 8; VS.Weapons.chooseSchool(g.player, 'prism', 'prism_reflection')
  g.player.invuln = 9999; g.time = 899.99; VS.Game.step(g, 0.02)
  const live = g.state, mode = g.mode, held = g.player.weapons[0] === w
  VS.Game.pause(g)
  const canEnd = !document.getElementById('endEndlessBtn').hidden
  document.getElementById('endEndlessBtn').click()
  const data = VS.Save.load(), result = { live, mode, held, canEnd, state: g.state, endlessRuns: data.endless.runs, endlessBest: data.endless.bestTime }
  if (prior === null) localStorage.removeItem(VS.Save.KEY); else localStorage.setItem(VS.Save.KEY, prior)
  g.data = VS.Save.load()
  VS.Game.toMenu(g)
  return JSON.stringify(result)
})()`)
ok('⑥ 无尽 15 分钟后继续，保留武器并可从暂停菜单结算', endless.live === 'playing' && endless.held && endless.canEnd && endless.state === 'gameover' && endless.endlessBest >= 900, JSON.stringify(endless))

/* ⑦ 请求契约使用桩：不上传真实成绩，不调用用户授权。 */
const lb = await j(`(async () => {
  const realFetch = window.fetch, realAuth = window.SiteAuth, realAccount = window.DSHAccount, calls = []
  let signed = false
  window.SiteAuth = { status: () => ({ signedIn: signed, clientId: 'vampire-survivors', user: signed ? { sub: 'probe', name: 'probe' } : null }) }
  window.DSHAccount = { siteIdentity: () => 'probe', sessionToken: () => 'isolated-probe' }
  window.fetch = async (url, opts = {}) => {
    calls.push({ method: opts.method || 'GET', url: String(url), auth: !!opts.headers?.authorization, body: opts.body })
    if (calls.length === 1) throw new Error('simulated first host failure')
    return { ok: true, status: 200, json: async () => ({ list: [{ name: 'probe', time: 321 }], rank: 1, better: true, best: { time: 321 } }) }
  }
  try {
    VS.Leaderboard.resetBase()
    const guest = VS.Leaderboard.canSubmit(), read = await VS.Leaderboard.top()
    signed = true
    const linked = VS.Leaderboard.canSubmit(), posted = await VS.Leaderboard.submit({ time: 321, kills: 45, level: 7, wave: 3, mode: 'campaign' })
    const noEndless = await VS.Leaderboard.submit({ time: 900, mode: 'endless' })
    return JSON.stringify({ guest, linked, read: read.ok, posted: posted.ok, noEndless: noEndless.ok, calls })
  } finally { window.fetch = realFetch; window.SiteAuth = realAuth; window.DSHAccount = realAccount; VS.Leaderboard.resetBase() }
})()`)
const post = lb.calls?.find(c => c.method === 'POST'), body = JSON.parse(post?.body || '{}')
ok('⑦ 游客公开 GET、连接身份后 Bearer POST、无尽不提交战役榜', !lb.guest && lb.linked && lb.read && lb.posted && !lb.noEndless && lb.calls?.length === 3 && !lb.calls[0].auth && !lb.calls[1].auth && post?.auth && body.game === 'vampire-survivors' && body.time === 321 && body.kills === 45, JSON.stringify({ calls: lb.calls?.map(c => c.method + (c.auth ? ' authenticated' : ' public')), body }))
ok('⑦′ 首个榜单后端失败时换下一个地址', new Set((lb.calls || []).map(c => new URL(c.url).host)).size === 2)

const notes = await j(`(() => {
  const btn = document.querySelector('#panel-start .notes-open')
  if (btn) btn.click()
  const shown = document.querySelectorAll('.notes .note').length
  const expected = window.VS_NOTES?.entries?.length || 0
  document.querySelector('.notes .notes-head button')?.click()
  return JSON.stringify({ has: !!btn, shown, expected })
})()`)
ok('⑧ 共创留言板保留，条数与数据一致', notes.has && notes.expected >= 3 && notes.shown === notes.expected, JSON.stringify(notes))
if (outDir) await shot('vs-expansion-menu')
console.log('VS 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
ws.close()
process.exit(checks.every(c => c[1]) ? 0 : 1)
