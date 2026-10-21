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
    { code: 'zh-CN', label: '简体', tag: 'zh-CN' },
    { code: 'zh-TW', label: '繁體', tag: 'zh-TW' },
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
  var requestId = 0;
  var bindings = new Map();

  var CSS = ''
    + '.i18n-sw{display:inline-flex;align-items:center;gap:3px;font-family:var(--mono,Consolas,monospace);vertical-align:middle}'
    + '.i18n-sw button{font:inherit;font-size:11.5px;line-height:1;padding:4px 8px;cursor:pointer;border-radius:6px;'
    + 'background:transparent;border:1px solid var(--line,var(--border,#1f2733));color:var(--dim,#7b8a9c);transition:.15s}'
    + '.i18n-sw button:hover{color:var(--ink,var(--text,#dfe8f0));border-color:var(--line2,var(--border,#2a3543))}'
    + '.i18n-sw button[aria-pressed="true"]{color:var(--green,#3fd07a);'
    + 'border-color:color-mix(in srgb,var(--green,#3fd07a) 45%,transparent)}';

  function known(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i]; return null; }
  function normalize(code) {
    var value = String(code || '').toLowerCase().replace(/_/g, '-');
    if (/^zh-(?:tw|hk|mo|hant)(?:-|$)/.test(value)) return 'zh-TW';
    if (/^zh(?:-|$)/.test(value)) return 'zh-CN';
    if (/^en(?:-|$)/.test(value)) return 'en';
    return null;
  }

  function detect() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('lang') || ''; } catch (e) { /* 老浏览器忽略 */ }
    if (normalize(q)) return normalize(q);
    try { var s = localStorage.getItem(STORE); if (normalize(s)) return normalize(s); } catch (e) { /* 无痕模式 */ }
    var preferred = navigator.languages || [navigator.language];
    for (var i = 0; i < preferred.length; i++) if (normalize(preferred[i])) return normalize(preferred[i]);
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
    for (i = 0; i < list.length; i++) {
      el = list[i];
      var vars = null;
      try { vars = JSON.parse(el.getAttribute('data-i18n-vars') || 'null'); } catch (e) {}
      el.textContent = t(el.getAttribute('data-i18n'), vars);
    }
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
    subs.slice().forEach(function (fn) { try { fn(cur); } catch (e) { if (global.console) console.error('[i18n]', e); } });
    bindings.forEach(function (props, el) {
      if (!el.isConnected) { bindings.delete(el); return; }
      Object.keys(props).forEach(function (prop) {
        var entry = props[prop];
        if (el[prop] !== entry.value) { delete props[prop]; return; }
        entry.value = entry.render(); el[prop] = entry.value;
      });
    });
    try { document.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: cur } })); } catch (e) { /* ignore */ }
  }

  /* 词典版本号（2026-09-28 加）：
     CF 按扩展名缓存静态文件（实测 .js 被 HIT 4 小时），词典改了线上不生效。
     ⚠️ 改词典（zh-CN.js / en.js）时**把下面的 VER 改一下**（与页面里 site.css/site.js 的 ?v= 同步跳）。
     一开始想从 document.currentScript 的 ?v= 里取，但词典是在 loadAsync 里异步加载的，
     那时 currentScript 已经是 null，取不到 —— 静态站不搞聪明，写死常量最稳。
     2026-10-09：站点授权上线时漏跳了这个号，线上词典被缓存成 9/29 那份，
     新词条全部显示成 key（表现为"i18n 没生效"）。改词典**必须**同时跳这里。 */
  var VER = '20261021res1';

  function loadAsync(code, cb) {
    var s = document.createElement('script');
    s.src = BASE + code + '.js' + (VER ? ('?v=' + VER) : '');
    s.onload = function () { cb(!!DICT[code]); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  function set(code) {
    code = normalize(code) || DEFAULT;
    var id = ++requestId;
    function finish(ok) {
      if (!ok || id !== requestId) return;
      cur = code;
      try { localStorage.setItem(STORE, code); } catch (e) {}
      try { var url = new URL(location.href); url.searchParams.set('lang', code); history.replaceState(history.state, '', url); } catch (e) {}
      commit();
    }
    if (!DICT[code]) {                                        // 词典没加载过（用户手动切到别的语言）
      var loaded = false;
      loadAsync(code, function (ok) { if (loaded) return; loaded = true; finish(ok); });
      return;
    }
    finish(true);
  }

  function injectCss() {
    if (cssDone) return;
    cssDone = true;
    var s = document.createElement('style');
    s.id = 'i18n-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function ready() {
    if (!DICT[cur]) {
      loadAsync(DEFAULT, function (ok) {
        if (ok) { cur = DEFAULT; ready(); commit(); }
      });
      return;
    }
    try { localStorage.setItem(STORE, cur); } catch (e) {}
    injectCss(); apply(document); switchers();
  }

  /* 词典在解析期同步加载 → 首次绘制前词条就绪，切语言不闪 */
  function boot() {
    cur = detect();
    if (document.readyState === 'loading') {
      // ⚠️ 这条是"首屏同步加载"，改词典不生效的元凶就在这里：早先只给 loadAsync 带了版本号，
      //    结果首次加载仍打到 CF 缓存的旧词典（实测线上一直显示旧词条 / 新键不生效）。
      document.write('<script src="' + BASE + cur + '.js' + (VER ? ('?v=' + VER) : '') + '"><\/script>');
      document.write('<script src="' + BASE + 'errors.js?v=' + VER + '"><\/script>');
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      loadAsync(cur, ready);
    }
  }

  global.I18N = {
    define: function (code, dict) { DICT[code] = dict; },
    t: t,
    resolve: function (value) {
      for (var code in DICT) {
        var dict = DICT[code];
        for (var key in dict) if (dict[key] === value) return t(key);
      }
      return value;
    },
    apply: apply,
    set: set,
    current: function () { return cur; },
    bind: function (el, prop, render) {
      var value = render(); el[prop] = value;
      var props = bindings.get(el) || {};
      props[prop] = { render: render, value: value };
      bindings.set(el, props);
      return value;
    },
    error: function (data, status) {
      var key = status === 401 ? 'common.error.unauthorized' : status === 403 ? 'common.error.forbidden' : status === 429 ? 'common.error.rateLimit' : status >= 500 ? 'common.error.server' : 'common.error.request';
      var message = data && (data.message || data.error_description || data.error);
      if (Array.isArray(message)) message = message.join('; ');
      var errors = global.SITE_ERROR_KEYS || {};
      if (typeof message === 'string' && errors[message]) return t(errors[message]);
      return t(key, { status: status || '—' });
    },
    errorText: function (message) {
      var value = String(message || '');
      if (/failed to fetch|networkerror|fetch failed|load failed/i.test(value)) return t('common.error.network');
      if (global.SITE_ERROR_KEYS && global.SITE_ERROR_KEYS[value]) return t(global.SITE_ERROR_KEYS[value]);
      var match = null;
      for (var code in DICT) for (var key in DICT[code]) {
        var text = DICT[code][key];
        if (text === value) return t(key);
        if (text.length > 2 && !text.includes('<') && /[:：]\s*$/.test(text) && value.indexOf(text) === 0 && (!match || text.length > match.text.length)) match = {key:key,text:text};
      }
      if (match) return t(match.key) + global.I18N.errorText(value.slice(match.text.length));
      var status = value.match(/HTTP\s+(\d{3})/);
      return t('common.error.request',{status:status ? status[1] : '—'});
    },
    normalize: normalize,
    number: function (value, options) { return new Intl.NumberFormat(cur, options).format(value); },
    date: function (value, options) { return new Intl.DateTimeFormat(cur, options).format(new Date(value)); },
    turnstileLanguage: function () { return cur === 'zh-TW' ? 'zh-tw' : cur === 'zh-CN' ? 'zh-cn' : 'en'; },
    langs: LANGS,
    onChange: function (fn) {
      if (typeof fn === 'function') subs.push(fn);
      return function () { subs = subs.filter(function (entry) { return entry !== fn; }); };
    }
  };

  boot();
})(window);
