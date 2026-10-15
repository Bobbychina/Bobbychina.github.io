/* SITE-Ψ 监听终端 · 通用控制台（THE FINALS 式形式：终端交互 / 分阶段 / 失败才放提示）
 * 用法：
 *   <div id="term"></div>
 *   <script src="/secret/console.js"></script>
 *   <script>PsiConsole.boot({ stage:1, ...配置 });</script>
 * 配置字段：
 *   stage        1|2
 *   salt/hash    答案校验（SHA-256(salt+答案)）
 *   storeKey     localStorage 进度键（dsh_secret_l1 / dsh_secret_l2）
 *   needKey      前置进度键（第二阶段需要 dsh_secret_l1）
 *   assets       [{id,name,bytes,href,note}]
 *   intro        [行文本]
 *   hints        [ [第0档...], [第1档...], [第2档...] ]  每档多行
 *   onPass       成功后的额外行函数(state) -> [行文本]
 */
window.PsiConsole = (function () {
  'use strict';

  var ZW = { t: 'Ψ' };

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function sha256hex(s) {
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) return Promise.reject(new Error('no-subtle'));
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /* 通行标记：解锁后立刻在页眉/页脚挂上（THE FINALS 式小奖励） */
  function refreshBadge() {
    var el = document.getElementById('clearance');
    if (!el) return;
    var t1 = false, t2 = false;
    try { t1 = localStorage.getItem('dsh_secret_l1') === 'ok'; t2 = localStorage.getItem('dsh_secret_l2') === 'ok'; } catch (e) {}
    if (!t1) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = 'CLEARANCE ' + (t2 ? 'T2' : 'T1');
  }

  var CSS = [
    '#term{background:var(--bg2);border:1px solid var(--line);border-radius:12px;overflow:hidden}',
    '#term .bar{display:flex;align-items:center;gap:7px;padding:9px 13px;background:var(--card);border-bottom:1px solid var(--line)}',
    '#term .dot{width:10px;height:10px;border-radius:50%;background:var(--line2)}',
    '#term .dot.g{background:var(--green)}#term .dot.a{background:var(--yellow)}',
    '#term .title{margin-left:8px;font-family:var(--mono);font-size:11.5px;color:var(--dim)}',
    '#term .body{font-family:var(--mono);font-size:12.8px;line-height:1.8;padding:14px 16px;height:360px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}',
    '#term .ln{opacity:0;animation:fi .18s forwards}',
    '@keyframes fi{to{opacity:1}}',
    '#term .sys{color:var(--ink)}#term .dim{color:var(--dim)}#term .ok{color:var(--green)}',
    '#term .warn{color:var(--yellow)}#term .err{color:var(--red)}#term .bc{color:var(--blue)}',
    '#term .cmd{color:var(--green)}',
    '#term .row{display:flex;align-items:center;gap:8px;border-top:1px solid var(--line);padding:10px 12px;background:var(--card)}',
    '#term .row .ps1{font-family:var(--mono);font-size:12.5px;color:var(--green);white-space:nowrap}',
    '#term input{flex:1;background:transparent;border:none;outline:none;color:var(--ink);font-family:var(--mono);font-size:13px;padding:6px 0;min-width:80px}',
    '#term input::placeholder{color:var(--dim)}',
    '#chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
    '#chips button{font-family:var(--mono);font-size:12.5px;color:var(--dim);background:var(--card);border:1px solid var(--line2);',
    'border-radius:8px;padding:10px 14px;cursor:pointer;min-height:44px}',
    '#chips button:hover{color:var(--green);border-color:var(--green)}',
    '@media (prefers-reduced-motion: reduce){#term .ln{opacity:1;animation:none}}'
  ].join('');

  function boot(config) {
    var factory = typeof config === 'function' ? config : function () { return config; };
    var cfg = factory();
    var st = { stage: cfg.stage, failKey: 'dsh_secret_fail' + cfg.stage, fails: 0, hintTier: -1, passed: false };
    st.fails = parseInt(ls(st.failKey) || '0', 10) || 0;
    st.passed = ls(cfg.storeKey) === 'ok';

    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);

    var mount = document.getElementById('term');
    mount.innerHTML =
      '<div class="bar"><span class="dot g"></span><span class="dot a"></span><span class="dot"></span>' +
      '<span class="title">' + esc(cfg.title || 'site-psi') + '</span></div>' +
      '<div class="body" id="tbody" role="log" aria-live="polite"></div>' +
      '<div class="row"><span class="ps1">psi@' + (cfg.stage === 1 ? 'terminal-03' : 'vault') + ':~$</span>' +
      I18N.t("site.copy.79a0e300568a");
    var chips = document.createElement('div');
    chips.id = 'chips';
    chips.innerHTML = ['help', 'scan', 'hint', 'status'].map(function (c) {
      return '<button type="button" data-cmd="' + c + '">' + c + '</button>';
    }).join('');
    mount.parentNode.insertBefore(chips, mount.nextSibling);

    var body = document.getElementById('tbody');
    function out(text, cls) {
      var d = document.createElement('div');
      d.className = 'ln ' + (cls || 'sys');
      var state = Object.assign({}, st);
      I18N.bind(d, 'textContent', function () { return I18N.resolve(typeof text === 'function' ? text(state) : text); });
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }
    function rule() { out('────────────────────────────────────────', 'dim'); }

    function assetLines() {
      if (!cfg.assets || !cfg.assets.length) { out(function(state){return I18N.t("site.copy.260d40720807");}, 'dim'); return; }
      out(function(state){return I18N.t("site.copy.f7fcb8e28b61") + cfg.assets.length + I18N.t("site.copy.1e3cc3bc1577");}, 'sys');
      cfg.assets.forEach(function (a) {
        out(function () { return '  ' + a.id + '  ' + a.name + '  ' + a.bytes + '  — ' + I18N.resolve(a.note) + '   ' + a.href; }, 'bc');
      });
    }
    function statusLines() {
      var tierOne = ls('dsh_secret_l1') === 'ok', tierTwo = ls('dsh_secret_l2') === 'ok';
      out(function(state){return I18N.t("site.copy.a2fbbfe8733b") + state.stage + I18N.t("site.copy.31e6e5d4b4e2") + state.fails + I18N.t("site.copy.b7e6a2599edb") + (state.hintTier < 0 ? I18N.t("site.copy.484d55613910") : (I18N.t("site.copy.9552fe3bd366") + (state.hintTier + 1) + I18N.t("site.copy.c46844ac5668")));}, 'dim');
      out(function(){return I18N.t("site.copy.c19824ad4093") + (tierOne ? I18N.t("site.copy.521e65ffc7d0") : I18N.t("site.copy.94bc3d40defe")) +
          ' ｜ TIER-2 ' + (tierTwo ? I18N.t("site.copy.521e65ffc7d0") : I18N.t("site.copy.94bc3d40defe"));}, 'dim');
    }
    function hintLines() {
      var tier = st.fails >= 6 ? 2 : (st.fails >= 3 ? 1 : 0);
      var block = (cfg.hints && cfg.hints[tier]) || [I18N.t("site.copy.793d7888f431")];
      if (tier <= st.hintTier) { out(function(state){return I18N.t("site.copy.813c5611f061");}, 'dim'); }
      else { st.hintTier = tier; }
      out(function(state){return I18N.t("site.copy.7dc1a05a1b03") + (tier + 1) + I18N.t("site.copy.c46844ac5668") + (tier < 2 ? I18N.t("site.copy.424f041cab87") : I18N.t("site.copy.185f9ed5dc18")) + ']';}, 'warn');
      block.forEach(function (l) { out(l, 'sys'); });
    }
    function broadcast() {
      var lines = cfg.broadcast || [];
      var line = lines[Math.floor(Math.random() * lines.length)];
      if (lines.length) out(function(){return I18N.t("site.copy.8f79c2a19104") + I18N.resolve(line);}, 'bc');
    }

    function pass(name) {
      st.passed = true;
      ls(cfg.storeKey, 'ok');
      ls(cfg.storeKey + '_name', name);
      refreshBadge();
      rule();
      out(function(state){return I18N.t("site.copy.531c2c387247") + name;}, 'ok');
      (cfg.onPass ? cfg.onPass(name) : []).forEach(function (l, i) { out(function () { return cfg.onPass ? cfg.onPass(name)[i] : l; }, 'ok'); });
      rule();
      statusLines();
    }

    function submit(v) {
      if (!v) { out(function(state){return I18N.t("site.copy.94c0b316cdd4");}, 'warn'); return; }
      if (st.passed) { out(function(state){return I18N.t("site.copy.1ca027e69b56");}, 'dim'); return; }
      out(function(state){return I18N.t("site.copy.8867c400e9cc");}, 'dim');
      sha256hex(cfg.salt + v).then(function (h) {
        if (h === cfg.hash) { pass(v); return; }
        st.fails += 1; ls(st.failKey, String(st.fails));
        rule();
        out(function(state){return '[' + (cfg.failCode || 'E-403') + I18N.t("site.copy.13dd4ce5ad36") + state.fails + I18N.t("site.copy.1105b88ed6ef");}, 'err');
        out(function(state){return I18N.t("site.copy.19dcd561ea06") + (cfg.failLine || I18N.t("site.copy.a5dc3792e0b2"));} , 'dim');
        broadcast();
        if ([3, 6].indexOf(st.fails) >= 0) out(function(state){return I18N.t("site.copy.3c1d5970270b");}, 'warn');
      }).catch(function () {
        out(function(state){return I18N.t("site.copy.7dd9067a6753");}, 'err');
      });
    }

    function run(raw) {
      var line = String(raw || '').trim();
      if (!line) return;
      out('psi@~$ ' + line, 'cmd');
      var m = line.match(/^(\S+)\s*([\s\S]*)$/);
      var cmd = (m ? m[1] : line).toLowerCase(), arg = m ? m[2].trim() : '';
      switch (cmd) {
        case 'help': case '?':
          out(function(state){return I18N.t("site.copy.65fd33532be7");}, 'sys');
          out(function(state){return I18N.t("site.copy.43364e15bc84");}, 'dim');
          break;
        case 'scan': case 'assets': case 'ls': assetLines(); break;
        case 'hint': hintLines(); break;
        case 'status': case 'whoami': statusLines(); break;
        case 'log': (cfg.log || []).forEach(function (l) { out(l, 'dim'); }); break;
        case 'clear': body.innerHTML = ''; break;
        case 'submit': submit(arg.toLowerCase().replace(/[\s-]/g, '')); break;
        case 'open': if (cfg.nextUrl && st.passed) { out(function(state){return I18N.t("site.copy.19dcd561ea06") + cfg.nextUrl;}, 'ok'); location.href = cfg.nextUrl; } else out(function(state){return I18N.t("site.copy.cb16e49200b2");}, 'warn'); break;
        default: submit(line.toLowerCase().replace(/[\s-]/g, ''));
      }
    }

    var input = document.getElementById('tin');
    I18N.onChange(function () {
      cfg = factory();
      mount.querySelector('.title').textContent = cfg.title || 'site-psi';
      input.setAttribute('aria-label', I18N.current() === 'en' ? 'Terminal input' : I18N.current() === 'zh-TW' ? '終端輸入' : '终端输入');
      input.placeholder = I18N.current() === 'en' ? 'Enter help' : I18N.current() === 'zh-TW' ? '輸入 help' : '输入 help';
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { run(input.value); input.value = ''; } });
    chips.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (b) run(b.getAttribute('data-cmd'));
    });

    (cfg.intro || []).forEach(function (l) { out(l.text || l, l.cls || 'sys'); });
    rule();
    refreshBadge();
    if (st.passed) {
      out(function(state){return I18N.t("site.copy.5978eed92372");}, 'ok');
      (cfg.onPass ? cfg.onPass(ls(cfg.storeKey + '_name') || I18N.t("site.copy.3fa9b684903a")) : []).forEach(function (l) { out(l, 'ok'); });
    } else {
      out(function(state){return I18N.t("site.copy.7ad9e7dca7b4");}, 'dim');
    }
    return st;
  }

  return { boot: boot };
})();
