/* 站点级公共条 —— 仿《逃离塔科夫》主界面那条"当前版本 / 不代表最终品质"的提示，另外带两件事：
 *   1) 手机端未适配提醒（可关掉，本标签页内不再弹）
 *   2) 第一方匿名访问计数（无 Cookie、不存 IP，只发页面路径/来源域/语言/屏幕宽）
 *
 * 用法（每个子页面在 <head> 里引一行）：
 *   <script src="/beta-notice.js" defer></script>
 *   <script src="/beta-notice.js" data-version="v4.0.0-beta" data-api="https://xxx.workers.dev" defer></script>
 *   data-nocount  → 这一页不计数
 */
(function () {
  var SITE_VERSION = 'v2026.09-beta';
  var DEFAULT_API = 'https://dsh-oauth-relay.bobby-minecraft.workers.dev';
  var MOBILE_KEY = 'dsh.mobile-notice.dismissed';
  /* 必须在脚本同步执行时读 currentScript：defer 脚本到 DOMContentLoaded 时它已经是 null */
  var me = document.currentScript;
  var PAGE_VERSION = (me && me.getAttribute('data-version')) || SITE_VERSION;
  var API = (me && me.getAttribute('data-api')) || DEFAULT_API;
  var NO_COUNT = !!(me && me.hasAttribute('data-nocount'));

  var CSS = ''
    + '#beta-notice{position:sticky;top:0;z-index:2147483000;display:flex;gap:10px;align-items:center;'
    + 'justify-content:center;flex-wrap:wrap;padding:7px 14px;text-align:center;'
    + 'font:12px/1.45 "Cascadia Mono",Consolas,ui-monospace,monospace;letter-spacing:.2px;'
    + 'background:#2a2113;color:#e2bd63;border-bottom:1px solid #5a4718}'
    + '#beta-notice .tag{background:#e8c15a;color:#2a2113;border-radius:4px;padding:1px 6px;font-size:11px;'
    + 'font-weight:700;letter-spacing:1px}'
    + '#beta-notice .ver{color:#f4dd97;font-style:normal}'
    + '#beta-notice .warn{color:#f0a35e}'
    + '#beta-notice .sep{opacity:.45}'
    + '#beta-notice a{color:inherit;text-decoration:underline;text-underline-offset:2px}'
    + '@media (max-width:560px){#beta-notice{font-size:11px;padding:5px 10px;gap:6px}}'
    + '@media (prefers-color-scheme:light){#beta-notice{background:#fdf6e3;color:#8a5a00;border-bottom-color:#e8d9a8}'
    + '#beta-notice .tag{background:#8a5a00;color:#fdf6e3}#beta-notice .ver{color:#6b4600}'
    + '#beta-notice .warn{color:#a1470b}}'
    /* 手机端提醒：比 BETA 条更醒目一点，但同样是一行，带关闭按钮 */
    + '#mobile-warn{position:relative;z-index:2147482999;display:flex;gap:10px;align-items:center;justify-content:center;'
    + 'flex-wrap:wrap;padding:9px 16px 9px 14px;text-align:center;font:13px/1.5 system-ui,"Segoe UI",sans-serif;'
    + 'background:#3a2415;color:#ffd7a8;border-bottom:1px solid #6b4423}'
    + '#mobile-warn b{color:#ffc27a}'
    + '#mobile-warn button{margin-left:6px;background:transparent;border:1px solid #8a5a2b;color:#ffd7a8;'
    + 'border-radius:6px;padding:2px 9px;font-size:12px;cursor:pointer}'
    + '#mobile-warn button:hover{background:#4a2e1a}'
    + '@media (prefers-color-scheme:light){#mobile-warn{background:#fff4e5;color:#8a4b00;border-bottom-color:#f0d5b0}'
    + '#mobile-warn b{color:#a1470b}#mobile-warn button{border-color:#e0b184;color:#8a4b00}}';

  function isMobile() {
    var ua = navigator.userAgent || '';
    var touch = (navigator.maxTouchPoints || 0) > 1;
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 820px)').matches : window.innerWidth <= 820;
    var uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|MiuiBrowser|MicroMessenger/i.test(ua);
    return uaMobile || (touch && narrow);
  }

  function dismissed() {
    try { return sessionStorage.getItem(MOBILE_KEY) === '1'; } catch (e) { return false; }
  }

  function installMobileWarn() {
    if (!isMobile() || dismissed()) return;
    var bar = document.createElement('div');
    bar.id = 'mobile-warn';
    bar.setAttribute('role', 'alert');
    bar.innerHTML = '<span>📱 <b>手机端只做了基础适配</b>：能看能点，但排版和操作仍以电脑为准，'
      + '体验会明显差一些。</span>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '知道了';
    btn.onclick = function () {
      try { sessionStorage.setItem(MOBILE_KEY, '1'); } catch (e) { /* 无痕模式忽略 */ }
      bar.parentNode && bar.parentNode.removeChild(bar);
    };
    bar.appendChild(btn);
    var anchor = document.getElementById('beta-notice');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
  }

  /* 第一方匿名计数：只报"哪一页、从哪来、什么语言、屏幕多宽"，不带 Cookie / 不带 IP。
     后端没开（Analytics Engine 未启用）时第一次失败就本会话不再试，别让 404 刷控制台。 */
  function countOff() { try { sessionStorage.setItem('dsh.hit.off', '1'); } catch (e) { /* 无痕忽略 */ } }
  function countView() {
    if (NO_COUNT || !API) return;
    try { if (sessionStorage.getItem('dsh.hit.off') === '1') return; } catch (e) { /* 继续尝试 */ }
    try {
      var body = JSON.stringify({
        p: location.pathname,
        r: document.referrer ? document.referrer.split('/')[2] || '' : '',
        w: window.innerWidth || 0,
        l: navigator.language || '',
      });
      fetch(API + '/api/hit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true, mode: 'cors' })
        .then(function (r) { if (!r.ok) countOff(); })
        .catch(countOff);
    } catch (e) { countOff(); }
  }

  function install() {
    if (document.getElementById('beta-notice')) { installMobileWarn(); countView(); return; }  // 游戏页自带 BETA 条
    var style = document.createElement('style');
    style.id = 'beta-notice-style';
    style.textContent = CSS;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'beta-notice';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="tag">BETA</span>'
      + '<span>当前版本 <i class="ver">' + PAGE_VERSION + '</i></span>'
      + '<span class="sep">·</span>'
      + '<span>本版本仍在开发中，<b class="warn">不代表最终品质</b></span>';
    document.body.insertBefore(bar, document.body.firstChild);
    /* 兜底：个别页面用 flex/grid 把内容居中（如 OAuth 回调页），sticky 会被摆到画面中间 */
    requestAnimationFrame(function () {
      if (bar.getBoundingClientRect().top > 4) {
        bar.style.position = 'fixed';
        bar.style.top = '0';
        bar.style.left = '0';
        bar.style.right = '0';
        document.body.style.paddingTop = bar.offsetHeight + 'px';
      }
    });
    installMobileWarn();
    countView();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
