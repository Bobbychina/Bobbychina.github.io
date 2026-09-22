// Pages Function 契约测试（离线）：/api/score 转发 + OAuth 中继的老行为不许坏
// 用法：node tools/relay-test.mjs
//
// 为什么用 data: 导入而不是直接 import：仓库根没有 package.json（Cloudflare Pages 那边
// 靠它决定要不要跑构建，故意不加），所以 .js 会被 Node 当 CommonJS。把源码当 ES 模块喂进去最省事。
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../functions/[[path]].js', import.meta.url), 'utf8')
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + name + '  ' + extra) } }

const realFetch = globalThis.fetch
const calls = []
const withUpstream = async (handler) => {
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), method: (opts && opts.method) || 'GET', headers: (opts && opts.headers) || {}, body: (opts && opts.body) || '' }); return handler(String(url), opts) }
  try { return await onRequest({ request: REQ, env: {} }) } finally { globalThis.fetch = realFetch }
}

let REQ
const req = (path, opts = {}) => {
  REQ = new Request('https://bobbychina-games.pages.dev' + path, {
    method: opts.method || 'GET',
    headers: { origin: 'https://bobbychina.github.io', ...(opts.headers || {}) },
    body: opts.body,
  })
}

/* ① 看榜（GET）：转发到 Worker，状态码与裸 JSON 原样透传 */
const LIST = JSON.stringify({ ok: true, game: 'vampire-survivors', list: [{ name: 'alan', time: 640, kills: 88 }] })
req('/api/score?game=vampire-survivors')
let r = await withUpstream(() => new Response(LIST, { status: 200 }))
const body1 = await r.text()
ok('① GET /api/score 转发到 Worker 的 /api/score（带 query），响应原样返回',
  calls[0] && calls[0].url === 'https://dsh-oauth-relay.bobby-minecraft.workers.dev/api/score?game=vampire-survivors' && calls[0].method === 'GET' &&
  r.status === 200 && body1 === LIST && r.headers.get('access-control-allow-origin') === '*',
  calls[0] && calls[0].url)

/* ② 上榜（POST）：authorization 与 body 必须原样带上，不替它鉴权 */
calls.length = 0
req('/api/score', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-1' }, body: '{"game":"vampire-survivors","time":321}' })
r = await withUpstream(() => new Response('{"ok":true,"rank":1}', { status: 200 }))
ok('② POST 转发保留 Bearer 与 body（中继不掺和鉴权）',
  calls[0] && calls[0].method === 'POST' && calls[0].headers.authorization === 'Bearer tok-1' && calls[0].headers['content-type'] === 'application/json' &&
  calls[0].body === '{"game":"vampire-survivors","time":321}' && r.status === 200, JSON.stringify(calls[0] && calls[0].headers))

/* ③ 上游 4xx/5xx 原样透传（前端要靠它区分冷却 429 与字段错误 400） */
calls.length = 0
req('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
r = await withUpstream(() => new Response('{"error":"cooldown","message":"刚提交过"}', { status: 429 }))
ok('③ 上游 429 原样透传（状态码 + JSON 都不改写）', r.status === 429 && /cooldown/.test(await r.text()))

/* ④ 上游连不上 → 502，别把异常漏出去 */
calls.length = 0
req('/api/score?game=vampire-survivors')
r = await withUpstream(() => { throw new Error('boom') })
ok('④ 上游不可达 → 502 upstream_failed', r.status === 502 && /upstream_failed/.test(await r.text()))

/* ⑤ OPTIONS 预检：榜单路径要放行 authorization 与 GET */
req('/api/score', { method: 'OPTIONS' })
r = await onRequest({ request: REQ, env: {} })
ok('⑤ OPTIONS 预检放行 authorization / GET',
  r.status === 204 && /authorization/.test(r.headers.get('access-control-allow-headers') || '') && /GET/.test(r.headers.get('access-control-allow-methods') || ''),
  (r.headers.get('access-control-allow-headers') || '') + ' | ' + (r.headers.get('access-control-allow-methods') || ''))

/* ⑥ 老行为不许坏：OAuth 两个路径照旧转发，其它路径 404，非白名单来源 403 */
calls.length = 0
req('/login/device/code', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'client_id=x' })
r = await withUpstream(() => new Response('{"device_code":"d"}', { status: 200 }))
ok('⑥a OAuth 设备码路径照旧转发到 GitHub', calls[0] && calls[0].url === 'https://github.com/login/device/code' && r.status === 200, calls[0] && calls[0].url)

req('/api/save', { method: 'POST', body: '{}' })
r = await onRequest({ request: REQ, env: {} })
ok('⑥b 其它路径仍然 404 path_not_allowed（不当中继滥用）', r.status === 404 && /path_not_allowed/.test(await r.text()))

REQ = new Request('https://bobbychina-games.pages.dev/api/score?game=x', { headers: { origin: 'https://evil.example' } })
r = await onRequest({ request: REQ, env: {} })
ok('⑥c 陌生来源仍 403', r.status === 403)

/* ⑦ 本地调试来源放行（127.0.0.1:8846） */
calls.length = 0
REQ = new Request('https://bobbychina-games.pages.dev/api/score?game=vampire-survivors', { headers: { origin: 'http://127.0.0.1:8846' } })
r = await withUpstream(() => new Response(LIST, { status: 200 }))
ok('⑦ 本地静态服务器来源（127.0.0.1:8846）也放行', r.status === 200, 'status=' + r.status)

console.log('')
console.log('中继探针：' + pass + '/' + (pass + fail))
process.exit(fail ? 1 : 0)
