/* GitHub OAuth 中继 + 排行榜转发（Cloudflare **Pages Function** 版）
   ----------------------------------------------------------------------------
   和 tools/oauth-relay-worker.js 干的是同一件事（把固定端点的请求转发出去并补 CORS 头），
   区别只在**域名**，外加一条「排行榜转发」：

     · Worker 版落在 `*.workers.dev` —— 实测有些网络（校园网/运营商）把这个域名整段解析到黑洞，
       连不存在的子域都返回 Facebook 的 IP，于是"设备码/一键授权"在这类网络下必然失败；
     · Pages 版落在 `*.pages.dev` —— 同一套 Cloudflare 账号、同样免费，实测这些网络能正常解析。
     · 因此 /api/score（全站榜）也顺带从这儿转发：用户 → pages.dev 边缘 → Worker
       （这一跳发生在 Cloudflare 内网，不受用户本地网络能不能解析 workers.dev 影响）。
       转发不做任何鉴权判断：GET 公开只读、POST 要 Bearer 会话，都由 Worker 自己把关。

   ⚠️ 注意：本站主页是 **GitHub Pages**（静态），这个 `functions/` 目录对 GitHub Pages 不起作用。
   它是给 **Cloudflare Pages 的第二份部署**用的——只需要它当中继，静态内容原样即可：

     cd <主页仓库>
     npx wrangler pages deploy . --project-name=bobbychina-games     # 需要 wrangler login
     # 然后把 https://bobbychina-games.pages.dev 填进 games/auth-config.js 的 github.relay

   安全边界与 Worker 版一致：只放行白名单路径、只转发、不落盘、不需要 client secret
   （设备码流程本来就不需要它；OAuth 授权码换 token 才需要，可另配 GH_CLIENT_SECRET）。
*/
const ALLOW = {
  '/oauth/access_token': 'https://github.com/login/oauth/access_token',
  '/login/device/code': 'https://github.com/login/device/code',
};

/* 账号 / 云存档 / 排行榜那台 Worker（排行榜转发用） */
const SCORE_UPSTREAM = 'https://dsh-oauth-relay.bobby-minecraft.workers.dev';

/* 可选加固：只接受自己站点的跨域调用；Origin 缺失（curl 自测）照样放行。
   本地起静态服务器调试时也会命中（127.0.0.1 / localhost 的几个常用端口）。 */
const ALLOW_ORIGINS = [
  'https://bobbychina.github.io',
  'http://127.0.0.1:8846', 'http://127.0.0.1:5180', 'http://127.0.0.1:8853',
  'http://localhost:5180', 'http://localhost:8846',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

/* 排行榜转发要放行 authorization 头与 GET（看榜不用登录） */
const SCORE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'no-store',
  Vary: 'Origin',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  const isScore = url.pathname === '/api/score';
  const isRelay = !!ALLOW[url.pathname];

  /* 不归中继管的路径 → 交回 Pages 的静态资源。
     以前这里对一切非 POST 直接 405，结果 bobbychina-games.pages.dev 整站只有中继能通、
     静态页面（含首页/游戏/彩蛋）全是 405：既没法拿它当镜像站，也就没法在边缘拦 macOS。 */
  if (!isScore && !isRelay) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    return context.next();
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: isScore ? SCORE_CORS : CORS });
  if (origin && ALLOW_ORIGINS.indexOf(origin) < 0) return json({ error: 'origin_not_allowed', origin }, 403);

  if (isScore) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, SCORE_CORS);
    try {
      const headers = { accept: 'application/json' };
      const ct = request.headers.get('content-type'); if (ct) headers['content-type'] = ct;
      const auth = request.headers.get('authorization'); if (auth) headers.authorization = auth;
      const body = request.method === 'POST' ? await request.text() : undefined;
      const r = await fetch(SCORE_UPSTREAM + '/api/score' + (url.search || ''), { method: request.method, headers, body });
      return new Response(await r.text(), { status: r.status, headers: { ...SCORE_CORS, 'content-type': 'application/json' } });
    } catch (e) {
      return json({ error: 'upstream_failed', message: String((e && e.message) || e) }, 502, SCORE_CORS);
    }
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const target = ALLOW[url.pathname];
  if (!target) return json({ error: 'path_not_allowed', path: url.pathname, allowed: Object.keys(ALLOW).concat(['/api/score']) }, 404);
  try {
    let body = await request.text();
    const secret = env && env.GH_CLIENT_SECRET;
    if (url.pathname === '/oauth/access_token' && secret && !/(^|&)client_secret=/.test(body)) {
      body += '&client_secret=' + encodeURIComponent(secret);
    }
    const r = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    return new Response(await r.text(), { status: r.status, headers: { ...CORS, 'content-type': 'application/json' } });
  } catch (e) {
    return json({ error: 'upstream_failed', message: String((e && e.message) || e) }, 502);
  }
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...(headers || CORS), 'content-type': 'application/json' } });
}
