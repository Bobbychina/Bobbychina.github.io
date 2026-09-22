// 游戏厅卡片自检（共创作品上线用）：/games/ 上出现《吸血鬼幸存者》卡片、带 🤝 共创 徽章、链接指向新页面，且中英切换都对
// 用法：node tools/vs-hall-probe.mjs <cdpPort> <url> <outDir>
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
  const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (r.result?.exceptionDetails) return 'EXC ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0]
  return r.result?.result?.value
}
const j = async (x) => JSON.parse(String(await ev(x)))
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); if (r.result?.data) await fs.writeFile(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')) }
const checks = []
const ok = (n, c, extra = '') => { checks.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (extra ? '  ' + extra : '')) }

await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url }); await sleep(2500)

/* 认卡片用**语言无关**的锚点：那颗按钮的 onclick 里有 vampire-survivors 路径（中文/英文标题都能命中） */
const card = async () => j(`(() => {
  const btn = document.querySelector('.game button[onclick*="vampire-survivors"]');
  const c = btn ? btn.closest('.game') : null;
  if (!c) return JSON.stringify({ found: false });
  return JSON.stringify({ found: true, text: c.textContent.replace(/\\s+/g, ' '), badges: [...c.querySelectorAll('.badge')].map(b => b.textContent.trim()),
    act: btn.getAttribute('onclick') });
})()`)
const c0 = await card()
ok('① 游戏厅出现《吸血鬼幸存者》卡片（带 🤝 共创 徽章 + 开始游戏按钮指向新页面）',
  c0.found && c0.badges.some(b => /共创/.test(b)) && /location.href='\/games\/vampire-survivors\/'/.test(c0.act),
  JSON.stringify({ badges: c0.badges, act: c0.act }))

/* 切到英文：卡片文案要跟着走（i18n 词典真的加了键）。
   注意：en 词典是"用到才异步加载"（i18n.js 的 loadAsync），所以要**轮询等一下**再断言。 */
const langNow = () => ev(`(() => { try { return String(I18N.current()) } catch (e) { return 'ERR' } })()`)
await ev(`(() => { try { I18N.set('en'); return 1 } catch (e) { return 'EXC ' + e.message } })()`)
let c1 = { found: false, text: '', badges: [] }
for (let i = 0; i < 20; i++) {
  await sleep(250)
  if (String(await langNow()) !== 'en') continue
  c1 = await card()
  if (/Vampire Survivors/.test(c1.text) && /Co-created/.test(c1.badges.join(' '))) break
}
ok('① 英文下卡片也跟着切（Co-created / Vampire Survivors）',
  /Vampire Survivors/.test(c1.text) && /Co-created/.test(c1.badges.join(' ')),
  'lang=' + (await langNow()) + ' ' + JSON.stringify(c1.badges))
await ev(`(() => { try { I18N.set('zh-CN'); return 1 } catch (e) {} return 1 })()`)
await sleep(500)

/* 鸣谢区有共创那一张 */
const thx = await j(`(() => { const t = [...document.querySelectorAll('.thx')].map(x => x.textContent.replace(/\\s+/g, ' ')); return JSON.stringify({ n: t.length, coop: t.some(x => /共创/.test(x)) }) })()`)
ok('① 鸣谢区有「共创作品《吸血鬼幸存者》」那一张（名字待补）', thx.coop && thx.n >= 3, JSON.stringify(thx))
if (outDir) await shot('hall-games')

/* 卡片点进去是能玩的（同一标签页导航） */
await send('Page.navigate', { url: url.replace(/games\/?$/, 'games/vampire-survivors/') }); await sleep(2500)
const inside = await j(`(() => JSON.stringify({ title: document.title, canvas: !!document.getElementById('game'), bar: !!document.getElementById('site-bar') }))()`)
ok('② 卡片点开后就是那份游戏（标题 / Canvas / 站点壳都在）',
  /吸血鬼幸存者/.test(inside.title) && inside.canvas && inside.bar, JSON.stringify(inside))

ok('③ 0 未捕获异常', errs.length === 0, errs.slice(0, 2).join(' | '))
console.log('')
console.log('游戏厅探针：' + checks.filter(c => c[1]).length + '/' + checks.length)
process.exit(checks.every(c => c[1]) ? 0 : 1)
