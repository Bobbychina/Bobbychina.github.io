// macOS 访问恢复回归：各入口不显示拦截遮罩。
// 用法：node tools/mac-block-probe.mjs <cdpPort> <baseUrl> [outDir]
const [, , cdpPort, baseUrl, outDir] = process.argv
const fs = await import('node:fs/promises')
if (outDir) await fs.mkdir(outDir, { recursive: true }).catch(() => undefined)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BASE = String(baseUrl || '').replace(/\/$/, '')

const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
const MAC_META = { platform: 'macOS', platformVersion: '14.4.1', architecture: 'arm', model: 'Macintosh', mobile: false, brands: [{ brand: 'Safari', version: '17' }] }

let target = null
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map(); const errs = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').split('\n')[0].slice(0, 160))
}
const send = (method, params = {}, ms = 25000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 20000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const j = async (x) => { try { return JSON.parse(String(await ev(x))) } catch { return {} } }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data && outDir) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false })

/** 以指定 UA 打开某个页面，等加载完，再读拦截状态 */
const open = async (path, ua, meta, touch) => {
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  else await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  const params = { userAgent: ua, platform: meta ? (meta.platform === 'macOS' ? 'MacIntel' : 'Win32') : 'Win32' }
  if (meta) params.userAgentMetadata = meta
  await send('Emulation.setUserAgentOverride', params)
  await send('Page.navigate', { url: BASE + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'v=mac' + Date.now() })
  for (let i = 0; i < 60; i++) {
    const r = await ev(`document.readyState`)
    if (String(r) === 'complete') break
    await sleep(400)
  }
  await sleep(900)
  return j(`(() => {
    const ov = document.querySelector('[data-mac-block-overlay]');
    return JSON.stringify({
      blocked: window.__MAC_BLOCKED__ === true,
      attr: document.documentElement.getAttribute('data-mac-block'),
      overlay: !!ov,
      overlayText: ov ? String(ov.textContent || '').replace(/\\s+/g, ' ').slice(0, 1500) : '',
      bodyHidden: !!(document.body && document.body.style.display === 'none'),
      title: document.title,
      ua: navigator.userAgent.slice(0, 60),
      plat: (navigator.userAgentData && navigator.userAgentData.platform) || '',
      touch: navigator.maxTouchPoints || 0,
    })
  })()`)
}

/* ── ① Windows：照常访问 ── */
const win = await open('/', WIN_UA, null, false)
ok('① Windows UA 照常访问（没有覆盖层 / body 没被藏 / 标题没变）',
  win.blocked === false && win.overlay === false && win.bodyHidden === false && win.attr === null && win.title.indexOf('不支持 macOS') < 0,
  JSON.stringify({ blocked: win.blocked, overlay: win.overlay, title: win.title }))

const accessible = (state) => state.blocked === false && state.overlay === false && state.bodyHidden === false && state.attr === null && typeof state.title === 'string' && !state.title.includes('不支持 macOS')
for (const path of ['/', '/games/', '/games/zombie-survival/', '/games/vampire-survivors/', '/games/racing3d/', '/login/', '/account/']) {
  const state = await open(path, MAC_UA, MAC_META, false)
  ok('macOS 正常访问 ' + path, accessible(state), JSON.stringify(state))
}
/* ── ④ iPad 桌面模式不误伤 ── */
const ipad = await open('/', MAC_UA, MAC_META, true)
ok('④ iPad 桌面模式（Macintosh UA + maxTouchPoints=5）**不拦** —— 设计上的例外',
  ipad.blocked === false && ipad.overlay === false && ipad.touch > 1,
  JSON.stringify({ blocked: ipad.blocked, touch: ipad.touch }))

/* ── ⑤ 收尾：恢复 Windows UA 并确认页面正常（别把浏览器留在 Mac 状态给下一支探针） ── */
await open('/', WIN_UA, null, false)
ok('⑤ 拦截路径里 0 未捕获异常（我们自己的脚本不许抛错）', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log('')
console.log('mac-block 探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
