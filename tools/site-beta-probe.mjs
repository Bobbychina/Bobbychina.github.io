// 站点级 BETA 条验证：每个子页面 DOM 断言 + 截图（供 OCR 复查）
const [, , cdpPort, base] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PAGES = ['/index.html', '/games/index.html', '/games/zombie-survival/index.html', '/games/oauth-callback.html']
const fs = await import('node:fs/promises')

let target = null
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page') } catch {}
  if (!target) await sleep(500)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')

const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

for (const p of PAGES) {
  await send('Page.navigate', { url: base + p })
  await sleep(2600)                                   // 等脚本 + 页面渲染
  const r = await ev(`(() => {
    const b = document.getElementById('beta-notice');
    const cs = b ? getComputedStyle(b) : null;
    return JSON.stringify({
      exists: !!b,
      first: b ? (document.body.firstElementChild === b) : false,
      pos: cs ? cs.position : '',
      zIndex: cs ? cs.zIndex : '',
      text: b ? b.textContent.replace(/\\s+/g, ' ').trim() : '',
      top: b ? Math.round(b.getBoundingClientRect().top) : -1,
      h: b ? Math.round(b.getBoundingClientRect().height) : -1,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      count: document.querySelectorAll('#beta-notice').length,
    });
  })()`)
  const d = JSON.parse(r)
  const tag = p === '/index.html' ? 'home' : p.replace(/^\/|\/index\.html$|\.html$/g, '').replace(/\//g, '_')
  ok('[' + tag + '] 顶部有 BETA 条且在 body 第一个', d.exists && d.first && d.count === 1, 'first=' + d.first + ' count=' + d.count)
  ok('[' + tag + '] 吸顶（sticky 或 fixed，且 top=0）', (d.pos === 'sticky' || d.pos === 'fixed') && d.top === 0, 'pos=' + d.pos + ' top=' + d.top + ' h=' + d.h)
  ok('[' + tag + '] 文案含版本号与"不代表最终品质"', /当前版本/.test(d.text) && /不代表最终品质/.test(d.text) && /v[0-9]/.test(d.text), d.text.slice(0, 80))
  ok('[' + tag + '] 没有横向滚动条', d.hScroll === false, 'hScroll=' + d.hScroll)

  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 260, scale: 1 } })
  const file = 'E:/Files/artifacts/beta-' + tag.replace(/[\/]/g, '_').replace(/_$/, '') + '.png'
  await fs.writeFile(file, Buffer.from(shot.result.data, 'base64'))
  console.log('         截图: ' + file)
}
console.log('\n结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
