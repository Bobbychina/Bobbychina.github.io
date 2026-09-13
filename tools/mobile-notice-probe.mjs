// 手机端提醒验证：窄屏该弹、宽屏不该弹、点"知道了"后本会话不再弹
const [, , cdpPort, base] = process.argv
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

async function visit(url, w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Emulation.setUserAgentOverride', { userAgent: mobile ? UA_MOBILE : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' })
  await send('Page.navigate', { url })
  await sleep(2600)
  return ev(`(() => {
    const m = document.getElementById('mobile-warn');
    return JSON.stringify({
      has: !!m,
      text: m ? m.textContent.replace(/\\s+/g, ' ').trim() : '',
      count: document.querySelectorAll('#mobile-warn').length,
      beta: !!document.getElementById('beta-notice'),
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    });
  })()`)
}

const pages = [base + '/index.html', base + '/games/index.html', base + '/games/zombie-survival/index.html']
for (const url of pages) {
  const name = url.replace(base, '')
  // 手机（iPhone UA + 390 宽）
  const mob = JSON.parse(await visit(url, 390, 844, true))
  ok('[手机 ' + name + '] 弹出"暂未适配"提醒', mob.has && mob.count === 1 && /暂未做适配/.test(mob.text), mob.text.slice(0, 60))
  ok('[手机 ' + name + '] BETA 条仍在、无横向滚动', mob.beta && mob.hScroll === false, 'beta=' + mob.beta + ' hScroll=' + mob.hScroll)
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 390, height: 260, scale: 1 } })
  const file = 'E:/Files/artifacts/mobile-' + name.replace(/[\/\.]/g, '_') + '.png'
  await fs.writeFile(file, Buffer.from(shot.result.data, 'base64'))
  console.log('         截图: ' + file)

  // 桌面（宽屏 + 桌面 UA）→ 不该弹
  const desk = JSON.parse(await visit(url, 1280, 900, false))
  ok('[桌面 ' + name + '] 不弹手机提醒', desk.has === false && desk.beta === true, 'has=' + desk.has)
}

// 点"知道了"后，同一个标签页会话内不再弹
const before = JSON.parse(await visit(pages[0], 390, 844, true))
if (before.has) {
  await ev(`document.querySelector('#mobile-warn button').click()`)
  await sleep(300)
  const afterClick = await ev(`!!document.getElementById('mobile-warn')`)
  await send('Page.navigate', { url: pages[1] })
  await sleep(2200)
  const afterNav = await ev(`!!document.getElementById('mobile-warn')`)
  ok('点"知道了"后立即消失', afterClick === false, 'stillThere=' + afterClick)
  ok('同一会话再翻页也不再弹（sessionStorage 记住）', afterNav === false, 'afterNav=' + afterNav)
}

console.log('\n结果: ' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过')
ws.close()
process.exit(checks.every((c) => c[1]) ? 0 : 3)
