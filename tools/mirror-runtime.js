/* Shared only by generated static mirrors. Account cookies stay on the main site. */
(function () {
  'use strict';
  var main = 'https://bobbycn.cc';
  var relay = 'https://bobbychina-games.pages.dev';
  var dynamic = /^\/(?:login|register|account|reset-password|verify-email|admin|stock)(?:\/|$)/;
  function mainURL(path) { return main + path; }
  if (dynamic.test(location.pathname)) {
    location.replace(mainURL(location.pathname + location.search + location.hash));
    return;
  }

  // Public blog reads use the Pages relay; cookie sessions cannot cross these domains.
  var originalFetch = window.fetch;
  window.fetch = function (input, options) {
    var url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/auth/identity/')) {
      return Promise.resolve(new Response(JSON.stringify({ message: 'Use the main site for cloud accounts' }),
        { status: 401, headers: { 'content-type': 'application/json' } }));
    }
    if (location.hostname === 'bobbychina.github.io' && url.origin === location.origin && url.pathname.startsWith('/api/')) {
      var target = relay + url.pathname + url.search;
      return originalFetch.call(window, input instanceof Request ? new Request(target, input) : target, options);
    }
    return originalFetch.call(window, input, options);
  };

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a[href]').forEach(function (a) {
      var url = new URL(a.href, location.href);
      if (url.origin === location.origin && dynamic.test(url.pathname))
        a.href = mainURL(url.pathname + url.search + url.hash);
    });
    var notice = document.createElement('aside');
    notice.id = 'mirror-notice';
    notice.style.cssText = 'padding:10px 16px;background:#1d2530;color:#f4f4f4;font:14px/1.6 system-ui;text-align:center';
    var link = document.createElement('a');
    link.href = mainURL(location.pathname + location.search + location.hash);
    link.style.cssText = 'color:#c3ddff;text-decoration:underline';
    function translate() {
      var en = document.documentElement.lang === 'en';
      var traditional = /zh-(?:TW|HK)/i.test(document.documentElement.lang);
      notice.replaceChildren(document.createTextNode(en ? 'Static mirror · Articles and offline play are available here. ' : traditional ? '靜態鏡像 · 可閱讀文章與單機遊玩。' : '静态镜像 · 可阅读文章与单机游玩。'), link);
      link.textContent = en ? 'Open the main site for accounts and cloud features →' : traditional ? '帳號與雲端功能請前往主站 →' : '账号与云端功能请前往主站 →';
    }
    translate();
    new MutationObserver(translate).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.body.prepend(notice);
  });
}());
