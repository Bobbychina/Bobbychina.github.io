/*! 站点 i18n 引擎 —— 纯静态、零依赖、无构建
 * ---------------------------------------------------------------------------
 * 用法（每个页面 <head> 里引一行，必须在解析期同步执行，别加 defer/async）：
 *     <script src="/i18n/i18n.js"></script>
 * 页面里标注：
 *     <h1 data-i18n="home.hero.title">默认文案</h1>            ← textContent
 *     <p  data-i18n-html="home.about.p1">默认文案</p>          ← 允许词条带 <b>/<a>
 *     <meta name="description" data-i18n-attr="content:meta.desc">
 *     <span data-i18n-switch></span>                           ← 语言切换器落点
 * 代码里取词：I18N.t('games.login.btn')            （查不到 key 时原样返回，方便渐进改造）
 * 语言切换后要重渲染的动态内容：I18N.onChange(render)，页面里再手动 render() 一次打底。
 *
 * 加一种语言（两步，不用改任何页面）：
 *   1) 复制 /i18n/en.js 为 /i18n/<code>.js，把 I18N.define('<code>', {…}) 里的值换掉；
 *   2) 在下面 LANGS 里加一行 { code:'<code>', label:'显示名', tag:'<html lang 值>' }。
 * 语言优先级：?lang= → localStorage → navigator.language → DEFAULT。
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* ── 语言注册表（唯一的语言清单，切换器由它生成） ── */
  var LANGS = [
    { code: 'zh-CN', label: '中文', tag: 'zh-CN' },
    { code: 'en',    label: 'EN',   tag: 'en' }
  ];
  var DEFAULT = 'zh-CN';
  var STORE = 'bobbychina.lang';

  var me = document.currentScript;
  var BASE = me && me.src ? me.src.replace(/[^/]*$/, '') : '/i18n/';
  var DICT = {};
  var cur = DEFAULT;
  var subs = [];
  var cssDone = false;

  var CSS = ''
    + '.i18n-sw{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono,Consolas,monospace);vertical-align:middle}'
    + '.i18n-sw button{font:inherit;font-size:11.5px;line-height:1;padding:4px 8px;cursor:pointer;border-radius:6px;'
    + 'background:transparent;border:1px solid var(--line,var(--border,#1f2733));color:var(--dim,#7b8a9c);transition:.15s}'
    + '.i18n-sw button:hover{color:var(--ink,var(--text,#dfe8f0));border-color:var(--line2,var(--border,#2a3543))}'
    + '.i18n-sw button[aria-pressed="true"]{color:var(--green,#3fd07a);'
    + 'border-color:color-mix(in srgb,var(--green,#3fd07a) 45%,transparent)}';

  function known(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i]; return null; }

  function detect() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('lang') || ''; } catch (e) { /* 老浏览器忽略 */ }
    if (q && known(q)) return q;
    try { var s = localStorage.getItem(STORE); if (s && known(s)) return s; } catch (e) { /* 无痕模式 */ }
    var n = String((navigator.languages && navigator.languages[0]) || navigator.language || '').toLowerCase();
    for (var i = 0; i < LANGS.length; i++) {
      var c = LANGS[i].code.toLowerCase();
      if (n === c || n.indexOf(c.split('-')[0]) === 0) return LANGS[i].code;
    }
    return DEFAULT;
  }

  var warned = {};
  function t(key, vars) {
    var d = DICT[cur] || {}, v = d[key];
    if (v == null) {
      /* 未登记的键原样返回（允许直接写文案），但每个键只警告一次：漏词条/漏译立刻在控制台可见 */
      v = key;
      if (global.console && !warned[key]) { warned[key] = 1; console.warn('[i18n] 缺词条: ' + key + ' @' + cur); }
    }
    if (vars) v = v.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return v;
  }

  function nodes(root, sel) {
    var out = [];
    if (root.nodeType === 1 && root.matches && root.matches(sel)) out.push(root);
    var list = (root.querySelectorAll ? root.querySelectorAll(sel) : []);
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }

  function apply(root) {
    root = root || document;
    var i, el, list;
    list = nodes(root, '[data-i18n]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.textContent = t(el.getAttribute('data-i18n')); }
    list = nodes(root, '[data-i18n-html]');
    for (i = 0; i < list.length; i++) { el = list[i]; el.innerHTML = t(el.getAttribute('data-i18n-html')); }
    list = nodes(root, '[data-i18n-attr]');
    for (i = 0; i < list.length; i++) {
      el = list[i];
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var k = pair.indexOf(':');
        if (k < 1) return;
        var attr = pair.slice(0, k).trim(), key = pair.slice(k + 1).trim();
        if (attr) el.setAttribute(attr, t(key));
      });
    }
    if (root === document) {
      var m = known(cur);
      document.documentElement.lang = (m && m.tag) || cur;
      document.documentElement.setAttribute('data-lang', cur);
    }
  }

  function switchers() {
    var boxes = nodes(document, '[data-i18n-switch]');
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (box.className.indexOf('i18n-sw') < 0) box.className = (box.className ? box.className + ' ' : '') + 'i18n-sw';
      box.innerHTML = '';
      LANGS.forEach(function (l) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = l.label;
        b.title = l.code;
        b.setAttribute('aria-pressed', l.code === cur ? 'true' : 'false');
        b.setAttribute('aria-label', l.code);
        b.onclick = function () { set(l.code); };
        box.appendChild(b);
      });
    }
  }

  function commit() {
    apply(document);
    switchers();
    for (var i = 0; i < subs.length; i++) { try { subs[i](cur); } catch (e) { if (global.console) console.error('[i18n]', e); } }
    try { document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: cur } })); } catch (e) { /* ignore */ }
  }

  function loadAsync(code, cb) {
    var s = document.createElement('script');
    s.src = BASE + code + '.js';
    s.onload = s.onerror = function () { cb(); };
    document.head.appendChild(s);
  }

  function set(code) {
    if (!known(code)) code = DEFAULT;
    try { localStorage.setItem(STORE, code); } catch (e) { /* 无痕忽略 */ }
    if (!DICT[code]) {                                        // 词典没加载过（用户手动切到别的语言）
      var loaded = false;
      loadAsync(code, function () { if (loaded) return; loaded = true; cur = code; commit(); });
      return;
    }
    cur = code;
    commit();
  }

  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement('style');
    s.id = 'i18n-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ready() { injectCss(); apply(document); switchers(); }

  /* 词典在解析期同步加载 → 首次绘制前词条就绪，切语言不闪 */
  function boot() {
    cur = detect();
    if (document.readyState === 'loading') {
      document.write('<script src="' + BASE + cur + '.js"><\/script>');
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      loadAsync(cur, ready);
    }
  }

  global.I18N = {
    define: function (code, dict) { DICT[code] = dict; },
    t: t,
    apply: apply,
    set: set,
    current: function () { return cur; },
    langs: LANGS,
    onChange: function (fn) { if (typeof fn === 'function') subs.push(fn); }
  };

  boot();
})(window);
