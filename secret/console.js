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

  function boot(cfg) {
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
      '<input id="tin" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="终端输入" placeholder="输入 help"></div>';
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
      d.textContent = text;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }
    function rule() { out('────────────────────────────────────────', 'dim'); }

    function assetLines() {
      if (!cfg.assets || !cfg.assets.length) { out('[系统] 本阶段没有可下载资产。', 'dim'); return; }
      out('[系统] 扫描到 ' + cfg.assets.length + ' 件资产：', 'sys');
      cfg.assets.forEach(function (a) {
        out('  ' + a.id + '  ' + a.name + '  ' + a.bytes + '  — ' + a.note + '   ' + a.href, 'bc');
      });
    }
    function statusLines() {
      out('[状态] 阶段 ' + st.stage + ' / 失败次数 ' + st.fails + ' / 已放提示 ' + (st.hintTier < 0 ? '无' : ('第 ' + (st.hintTier + 1) + ' 档')), 'dim');
      out('[状态] TIER-1 ' + (ls('dsh_secret_l1') === 'ok' ? '已授权' : '未授权') +
          ' ｜ TIER-2 ' + (ls('dsh_secret_l2') === 'ok' ? '已授权' : '未授权'), 'dim');
    }
    function hintLines() {
      var tier = st.fails >= 6 ? 2 : (st.fails >= 3 ? 1 : 0);
      var block = (cfg.hints && cfg.hints[tier]) || ['[系统] 暂无可用提示。'];
      if (tier <= st.hintTier) { out('[系统] 这一档提示已经给过你了：', 'dim'); }
      else { st.hintTier = tier; }
      out('[提示 · 第 ' + (tier + 1) + ' 档' + (tier < 2 ? '（再失败几次会放开更多）' : '（最后一档）') + ']', 'warn');
      block.forEach(function (l) { out(l, 'sys'); });
    }
    function broadcast() {
      var lines = cfg.broadcast || [];
      if (lines.length) out('[串扰] ' + lines[Math.floor(Math.random() * lines.length)], 'bc');
    }

    function pass(name) {
      st.passed = true;
      ls(cfg.storeKey, 'ok');
      ls(cfg.storeKey + '_name', name);
      refreshBadge();
      rule();
      out('[系统] 校验通过 · 结论：' + name, 'ok');
      (cfg.onPass ? cfg.onPass(name) : []).forEach(function (l) { out(l, 'ok'); });
      rule();
      statusLines();
    }

    function submit(v) {
      if (!v) { out('[系统] 用法：submit <你的答案>', 'warn'); return; }
      if (st.passed) { out('[系统] 这一阶段你已经通过了。', 'dim'); return; }
      out('[系统] 正在本地校验（SHA-256，不联网）…', 'dim');
      sha256hex(cfg.salt + v).then(function (h) {
        if (h === cfg.hash) { pass(v); return; }
        st.fails += 1; ls(st.failKey, String(st.fails));
        rule();
        out('[' + (cfg.failCode || 'E-403') + '] 校验未通过。本站已记录第 ' + st.fails + ' 次尝试。', 'err');
        out('[系统] ' + (cfg.failLine || '回去看那一页残页。') , 'dim');
        broadcast();
        if ([3, 6].indexOf(st.fails) >= 0) out('[系统] 检测到你反复失败——广播里有人在替你说话，输入 hint 领取。', 'warn');
      }).catch(function () {
        out('[系统] 当前环境不支持本地哈希校验，请用 https 或现代浏览器打开。', 'err');
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
          out('[指令] scan 扫描资产 ｜ submit <答案> 提交 ｜ hint 申请提示 ｜ status 状态 ｜ log 串扰记录 ｜ clear 清屏', 'sys');
          out('[说明] 直接输入一串字符也会当成一次提交。', 'dim');
          break;
        case 'scan': case 'assets': case 'ls': assetLines(); break;
        case 'hint': hintLines(); break;
        case 'status': case 'whoami': statusLines(); break;
        case 'log': (cfg.log || []).forEach(function (l) { out(l, 'dim'); }); break;
        case 'clear': body.innerHTML = ''; break;
        case 'submit': submit(arg.toLowerCase().replace(/[\s-]/g, '')); break;
        case 'open': if (cfg.nextUrl && st.passed) { out('[系统] ' + cfg.nextUrl, 'ok'); location.href = cfg.nextUrl; } else out('[系统] 还不能去那儿。', 'warn'); break;
        default: submit(line.toLowerCase().replace(/[\s-]/g, ''));
      }
    }

    var input = document.getElementById('tin');
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { run(input.value); input.value = ''; } });
    chips.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (b) run(b.getAttribute('data-cmd'));
    });

    (cfg.intro || []).forEach(function (l) { out(l.text || l, l.cls || 'sys'); });
    rule();
    refreshBadge();
    if (st.passed) {
      out('[系统] 这一阶段已完成（本机存档）。', 'ok');
      (cfg.onPass ? cfg.onPass(ls(cfg.storeKey + '_name') || '已通过') : []).forEach(function (l) { out(l, 'ok'); });
    } else {
      out('[系统] 输入 help 查看可用指令。', 'dim');
    }
    return st;
  }

  return { boot: boot };
})();
