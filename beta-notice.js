/* 站点级 BETA 声明条 —— 仿《逃离塔科夫》主界面那条"当前版本 / 不代表最终品质"的提示。
 *
 * 用法（每个子页面都在 <head> 里引一行，或者放到 </body> 前）：
 *   <script src="/beta-notice.js" defer></script>
 *   <script src="/beta-notice.js" data-version="v4.0.0-beta" defer></script>   ← 该页想显示自己的版本号
 *
 * 特性：
 *   · 插到 <body> 第一个子元素，position:sticky —— 在正常流里占住自己那一行，滚动时吸顶，
 *     所以不用给 body 补 padding，也不会盖住页头；
 *   · 幂等：页面自己（比如游戏的单文件构建）已经有 #beta-notice 就跳过，不会出现两条；
 *   · 深浅色自动适配（跟站点其它页面的 prefers-color-scheme 策略一致）。
 */
(function () {
  var SITE_VERSION = 'v2026.09-beta';
  var TAG_TEXT = 'BETA';
  /* 必须在"脚本同步执行"这一刻读 currentScript：defer 脚本等到 DOMContentLoaded 时它已经是 null 了 */
  var me = document.currentScript;
  var PAGE_VERSION = (me && me.getAttribute('data-version')) || SITE_VERSION;

  function install() {
    if (document.getElementById('beta-notice')) return;         // 已经有（游戏页自带）→ 不重复
    var version = PAGE_VERSION;

    var css = ''
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
      + '#beta-notice .warn{color:#a1470b}}';

    var style = document.createElement('style');
    style.id = 'beta-notice-style';
    style.textContent = css;
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'beta-notice';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="tag">' + TAG_TEXT + '</span>'
      + '<span>当前版本 <i class="ver">' + version + '</i></span>'
      + '<span class="sep">·</span>'
      + '<span>本版本仍在开发中，<b class="warn">不代表最终品质</b></span>';
    document.body.insertBefore(bar, document.body.firstChild);
    /* 兜底：个别页面用 flex/grid 把内容居中（如 OAuth 回调页），sticky 会被摆到画面中间。
       这种情况改成固定吸顶，并给 body 留出等高内边距，保证它真的"在最上面"。 */
    requestAnimationFrame(function () {
      if (bar.getBoundingClientRect().top > 4) {
        bar.style.position = 'fixed';
        bar.style.top = '0';
        bar.style.left = '0';
        bar.style.right = '0';
        document.body.style.paddingTop = bar.offsetHeight + 'px';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
