/* macOS 服务端拒绝（Cloudflare Pages Functions **middleware** 版，2026-09-23）
   ----------------------------------------------------------------------------
   站长要求：不要客户端软拦截，直接**服务端拒绝连接**。

   事实边界（写在最前面，免得以后又绕回来）：
   - 主站是 **GitHub Pages**（静态托管），它**没有任何服务端钩子**：没有 `_headers`、没有
     中间件、没有 403 规则可写。所以 github.io 那一份永远只能是客户端拦截（/mac-block.js）。
   - 要"真 403"，站点必须由**我们自己控制的边缘**来发：这个仓库已经有一份 Cloudflare Pages
     部署（project = bobbychina-games，域名 https://bobbychina-games.pages.dev）。
     本文件跑在 Cloudflare 边缘：命中 macOS 时**在静态资源之前**直接返回 403，
     连 HTML 都不发出去 —— 这才是服务端拒绝。

   判定口径（客户端看到的和这里一致，改一处要同时改 /mac-block.js）：
   - Chromium 系发 `sec-ch-ua-platform: "macOS"` → 挡；
   - Safari 不发这个头，用 UA 里的 `Macintosh|Mac OS X` 兜底 → 挡；
   - iPad 桌面模式 UA 也写成 `Macintosh`，但一定带 `Mobile/`（或直接 `iPad`）→ **不挡**
     （要连 iPad 一起挡，把 BLOCK_IPAD 改成 true）。
*/
const BLOCK_MAC = true;
const BLOCK_IPAD = false;

const MAC_RE = /Macintosh|Mac OS X/i;
const IPAD_RE = /iPad/i;

function isMacClient(request) {
  const ua = request.headers.get('user-agent') || '';
  const plat = (request.headers.get('sec-ch-ua-platform') || '').replace(/"/g, '').toLowerCase();
  const mac = plat === 'macos' || MAC_RE.test(ua);
  const ipad = plat === 'ipados' || IPAD_RE.test(ua) || (MAC_RE.test(ua) && /Mobile\//i.test(ua));
  return mac && (BLOCK_IPAD ? true : !ipad);
}

/** 403 页面：纯静态 HTML（不引任何站点资源，因为这一层就是不发资源的那个闸） */
function denyPage(ua, plat) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>403 · 本站不支持 macOS</title></head>' +
    '<body style="margin:0;background:#0a0e14;color:#d7e2ea;font:14px/1.7 \'Segoe UI\',system-ui,-apple-system,sans-serif">' +
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">' +
    '<div style="max-width:560px;width:100%;background:#10151d;border:1px solid #1f2733;border-radius:14px;padding:26px 28px">' +
    '<div style="font:600 12px/1 ui-monospace,Consolas,monospace;color:#3fd07a;letter-spacing:.14em">HTTP 403 · PLATFORM NOT SUPPORTED</div>' +
    '<h1 style="margin:14px 0 6px;font-size:20px;color:#ff8f8f">⛔ 本站不支持 macOS</h1>' +
    '<p style="margin:0;color:#9fb0c0">macOS is not supported on this site.</p>' +
    '<p style="margin:14px 0 0;color:#c8d4de">这条 403 是<b style="color:#3fd07a">服务器直接返回</b>的：请求在 Cloudflare 边缘就被拒绝，页面与游戏资源一个字节都没下发。' +
    '原因：站长实测 Mac 上的浏览器（Safari / Chrome / Firefox）在本站游戏里存在<b style="color:#ffd166">安全隐患</b>与<b style="color:#ffd166">兼容性问题</b>。</p>' +
    '<div style="margin:18px 0 0;padding:12px 14px;background:#0d1219;border:1px solid #1f2733;border-radius:10px">' +
    '<div style="color:#7b8a9c;font-size:12px;margin-bottom:6px">请换一个平台访问 / Please use another platform</div>' +
    '<div style="color:#c8d4de">Windows · Linux · Android · iOS（iPad 不在拦截范围）</div></div>' +
    '<div style="margin:16px 0 0;font-size:12px;color:#6b7a8c;word-break:break-all">UA: <span style="color:#8b9aa9">' + esc(ua) + '</span><br>' +
    'sec-ch-ua-platform: ' + (plat ? '「' + esc(plat) + '」' : '（未发送）') + '</div>' +
    '<div style="margin:18px 0 0"><a href="https://github.com/Bobbychina/Bobbychina.github.io/issues" style="color:#5cc8ff;text-decoration:none">→ 有异议 / 想让我重新评估？开个 issue</a></div>' +
    '</div></div></body></html>';
}

export async function onRequest(context) {
  const { request, next } = context;
  if (BLOCK_MAC && isMacClient(request)) {
    const ua = request.headers.get('user-agent') || '';
    const plat = (request.headers.get('sec-ch-ua-platform') || '').replace(/"/g, '').toLowerCase();
    return new Response(denyPage(ua, plat), {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        vary: 'User-Agent, sec-ch-ua-platform',
        'x-blocked-platform': 'macos',   // 探针/自测读这个头，不用去猜页面
      },
    });
  }
  return next();
}
