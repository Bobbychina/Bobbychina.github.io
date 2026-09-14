/* GitHub OAuth 中继（Cloudflare **Pages Function** 版）
   ----------------------------------------------------------------------------
   和 tools/oauth-relay-worker.js 干的是同一件事（把两个固定端点的请求转发给 GitHub 并补 CORS 头），
   区别只在**域名**：

     · Worker 版落在 `*.workers.dev` —— 实测有些网络（校园网/运营商）把这个域名整段解析到黑洞，
       连不存在的子域都返回 Facebook 的 IP，于是"设备码/一键授权"在这类网络下必然失败；
     · Pages 版落在 `*.pages.dev` —— 同一套 Cloudflare 账号、同样免费，实测这些网络能正常解析。

   ⚠️ 注意：本站主页是 **GitHub Pages**（静态），这个 `functions/` 目录对 GitHub Pages 不起作用。
   它是给 **Cloudflare Pages 的第二份部署**用的——只需要它当中继，静态内容原样即可：

     cd <主页仓库>
     npx wrangler pages deploy . --project-name=bobbychina-games     # 需要 wrangler login
     # 然后把 https://bobbychina-games.pages.dev 填进 games/auth-config.js 的 github.relay

   安全边界与 Worker 版一致：只放行两个路径、只转发、不落盘、不需要 client secret
   （设备码流程本来就不需要它；OAuth 授权码换 token 才需要，可另配 GH_CLIENT_SECRET）。
*/
const ALLOW = {
  '/oauth/access_token': 'https://github.com/login/oauth/access_token',
  '/login/device/code': 'https://github.com/login/device/code',
};

/* 可选加固：只接受自己站点的跨域调用；Origin 缺失（curl 自测）照样放行 */
const ALLOW_ORIGIN = 'https://bobbychina.github.io';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (origin && ALLOW_ORIGIN && origin !== ALLOW_ORIGIN) return json({ error: 'origin_not_allowed', origin }, 403);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const target = ALLOW[url.pathname];
  if (!target) return json({ error: 'path_not_allowed', path: url.pathname, allowed: Object.keys(ALLOW) }, 404);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}
