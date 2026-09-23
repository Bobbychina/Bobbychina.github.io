/* ============================================================================
   macOS 拦截（站长决定，2026-09-23）
   ---------------------------------------------------------------------------
   为什么：站长实测 Mac 浏览器（Safari / Chrome / Firefox on macOS）在本站游戏里
   存在安全隐患与兼容问题，因此直接拒绝 Mac 访问 —— 与其让人踩坑，不如说清楚。

   怎么工作：
   - 本站是 GitHub Pages 静态站，没有服务端，所以这是**客户端拦截**（能挡住普通人，
     挡不住刻意伪造 UA 的人；真要硬拦得走 Cloudflare 的 WAF 规则）。
   - 脚本必须**同步、尽早**执行（放在 <head> 最前面，且不加 defer/async）：
     游戏页的脚本都是 defer / type=module（解析后执行），所以这里能先跑。
   - 命中后：<html> 挂 data-mac-block、<body> 藏起来、盖一层整屏遮罩（挂在 <html> 上，
     因为本脚本常在 <body> 之前执行），并置 window.__MAC_BLOCKED__（探针靠它验收）。
   ============================================================================ */
(function () {
  'use strict';

  var CFG = {
    /* 'site' = 全站拦（当前口径）；'games' = 只拦游戏页（/games/*），其余照常 */
    SCOPE: 'site',
    /* iPad 的「桌面模式」UA 会伪装成 Macintosh（maxTouchPoints > 1 才是真身）。
       iPad 上游戏是能玩的，所以默认不一起挡；要连 iPad 一起挡就改成 true。 */
    BLOCK_IPAD: false,
    FEEDBACK: 'https://github.com/Bobbychina/Bobbychina.github.io/issues'
  };

  var ua = navigator.userAgent || '';
  var platform = (navigator.userAgentData && navigator.userAgentData.platform) || '';
  var looksMac = /mac/i.test(platform) || /Macintosh|Mac OS X/.test(ua);
  var isIPadDesktop = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  var isMac = looksMac && (CFG.BLOCK_IPAD ? true : !isIPadDesktop);
  if (!isMac) return;
  if (CFG.SCOPE === 'games' && !/^\/games(\/|$)/.test(location.pathname)) return;

  var root = document.documentElement;
  window.__MAC_BLOCKED__ = true;
  try { root.setAttribute('data-mac-block', '1'); } catch (e) { /* 老浏览器忽略 */ }
  try { document.title = '本站不支持 macOS · Bobbychina'; } catch (e) { /* 同上 */ }

  function hideBody() {
    if (document.body && document.body.style.display !== 'none') document.body.style.display = 'none';
  }

  function paint() {
    if (!root) return;
    hideBody();
    if (root.getAttribute('data-mac-painted') === '1') return;
    root.setAttribute('data-mac-painted', '1');

    var uaSafe = String(ua).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });

    var box = document.createElement('div');
    box.setAttribute('data-mac-block-overlay', '1');
    box.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'bottom:0', 'left:0', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:center', 'padding:24px',
      'background:#0a0e14', 'color:#d7e2ea', 'overflow:auto',
      'font:14px/1.7 "Segoe UI",system-ui,-apple-system,sans-serif', '-webkit-text-size-adjust:100%'
    ].join(';');

    box.innerHTML =
      '<div style="max-width:560px;width:100%;background:#10151d;border:1px solid #1f2733;border-radius:14px;padding:26px 28px">' +
        '<div style="font:600 12px/1 ui-monospace,SFMono-Regular,Consolas,monospace;color:#3fd07a;letter-spacing:.14em">HTTP 403 · PLATFORM NOT SUPPORTED</div>' +
        '<h1 style="margin:14px 0 6px;font-size:20px;color:#ff8f8f">⛔ 本站不支持 macOS</h1>' +
        '<p style="margin:0;color:#9fb0c0">macOS is not supported on this site.</p>' +
        '<p style="margin:14px 0 0;color:#c8d4de">站长实测：Mac 上的浏览器（Safari / Chrome / Firefox）在本站的游戏里存在<b style="color:#ffd166">安全隐患</b>与<b style="color:#ffd166">兼容性问题</b>，所以直接拒绝访问 —— 与其让你在不知情的情况下踩坑，不如现在说清楚。</p>' +
        '<p style="margin:10px 0 0;color:#8b9aa9;font-size:13px">We measured real issues (security risk + broken rendering) with Mac browsers in the games hosted here, so access from macOS is blocked on purpose.</p>' +
        '<div style="margin:18px 0 0;padding:12px 14px;background:#0d1219;border:1px solid #1f2733;border-radius:10px">' +
          '<div style="color:#7b8a9c;font-size:12px;margin-bottom:6px">请换一个平台访问 / Please use another platform</div>' +
          '<div style="color:#c8d4de">Windows · Linux · Android · iOS（iPad 不在拦截范围）</div>' +
        '</div>' +
        '<div style="margin:16px 0 0;font-size:12px;color:#6b7a8c;word-break:break-all">' +
          'UA: <span style="color:#8b9aa9">' + uaSafe + '</span><br>' +
          '判断依据：navigator.userAgentData.platform = ' + (platform ? '「' + platform + '」' : '（无）') +
          ' · navigator.maxTouchPoints = ' + (navigator.maxTouchPoints || 0) +
        '</div>' +
        '<div style="margin:18px 0 0"><a href="' + CFG.FEEDBACK + '" style="color:#5cc8ff;text-decoration:none">' +
          '→ 有异议 / 想让我重新评估？开个 issue</a></div>' +
      '</div>';

    root.appendChild(box);
  }

  paint();
  /* 脚本通常在 <body> 之前执行：那时 body 还不存在，等 DOM 就绪再补一次（藏 body + 确认遮罩在） */
  document.addEventListener('DOMContentLoaded', paint, { once: true });
  window.addEventListener('load', paint, { once: true });
})();
