// 《吸血鬼幸存者》帧率体检：量 FPS + 用 CDP Profiler 抓自耗时最高的函数（定位掉帧根因）
// 用法：node tools/vs-perf.mjs <cdpPort> <url> [seconds]
const [, , cdpPort, url, secsArg] = process.argv
const secs = Number(secsArg || 6)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page')
if (!target) { console.log('FAIL 连不上 CDP'); process.exit(1) }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0; const pending = new Map()
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}, ms = 60000) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }))
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); res({ result: {} }) } }, ms)
})
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, timeout: 60000 })).result?.result?.value

await send('Runtime.enable'); await send('Page.enable'); await send('Profiler.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
for (let i = 0; i < 150; i++) {
  if (String(await ev(`document.readyState`)) === 'complete' && await ev(`!!document.getElementById('startBtn')`)) break
  await sleep(600)
}
await ev(`(() => { const b = document.getElementById('startBtn'); if (b) b.click(); return 1 })()`)
await sleep(1500)
const warm = Number(process.argv[4 + 1] || 0)
if (warm) { await sleep(warm * 1000) }

// ① FPS + 帧耗时分布（rAF 实测）
const fps = await ev(`(async () => {
  const t = []; let last = performance.now(); const t0 = last; let frames = 0
  await new Promise((res) => { const tick = (n) => { t.push(n - last); last = n; frames++; if (n - t0 > ${secs} * 1000) res(); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const s = t.slice(3).sort((a, b) => a - b)
  const pct = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0)
  return JSON.stringify({ frames, fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
    p50: +pct(0.5).toFixed(2), p95: +pct(0.95).toFixed(2), max: +pct(1).toFixed(2) })
})()`)

// ② CPU profile：抓这 ${secs}s 里自耗时最高的函数
await send('Profiler.setSamplingInterval', { interval: 200 })
await send('Profiler.start')
await sleep(secs * 1000)
const prof = await send('Profiler.stop')
const nodes = prof.result?.profile?.nodes || []
const byId = new Map(nodes.map((n) => [n.id, n]))
const self = new Map()
for (const n of nodes) {
  const f = n.callFrame || {}
  const key = `${f.functionName || '(anonymous)'} @ ${(f.url || '').replace(/^.*\//, '')}:${(f.lineNumber ?? -1) + 1}`
  self.set(key, (self.get(key) || 0) + (n.hitCount || 0))
}
const total = [...self.values()].reduce((a, b) => a + b, 0) || 1
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  .map(([k, v]) => `  ${(v * 100 / total).toFixed(1).padStart(5)}%  ${(v * 0.2).toFixed(0).padStart(5)}ms  ${k}`)

console.log('FPS=' + fps)
console.log(`CPU 采样 ${total} 个样本（0.2ms/样本，合计约 ${(total * 0.2 / 1000).toFixed(1)}s CPU 时间）`)
console.log('自耗时 TOP：')
console.log(top.join('\n'))
process.exit(0)
