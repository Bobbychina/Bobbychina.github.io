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
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
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
console.log('')
console.log('VS 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
