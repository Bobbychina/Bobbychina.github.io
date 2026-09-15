/* SITE-Ψ 彩蛋入口 · 串扰信号
 * 触发：① 键盘敲 bobby 或 psi ② 连点页脚年份 3 次 ③ 访问 /#secret
 *   （源码里那段"值班记录"注释用零宽字符藏了同一句提示：type bobby）
 * 奖励：解锁后页脚挂上 CLEARANCE T1 / T2 通行标记（本地存档，不联网）
 */
(function () {
  'use strict';
  var K1 = 'dsh_secret_l1', K2 = 'dsh_secret_l2';
  var buf = '', taps = 0, tapTimer = null;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lvl() { return get(K2) === 'ok' ? 2 : (get(K1) === 'ok' ? 1 : 0); }

  var CSS = [
    '#egg{margin-top:26px;background:var(--card);border:1px solid color-mix(in srgb,var(--blue) 40%,var(--line));',
    'border-radius:12px;padding:18px 20px}',
    '#egg h3{font-family:var(--mono);font-size:14px;color:var(--blue);display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '#egg p{color:var(--dim);font-size:13.8px;margin-top:8px}',
    '#egg p b{color:var(--ink)}',
    '#egg .egg-acts{display:flex;gap:10px;margin-top:14px;font-size:13.5px;flex-wrap:wrap}',
    '#egg .egg-acts a{display:inline-block;padding:10px 16px;border:1px solid var(--line2);border-radius:9px;transition:.16s}',
    '#egg .egg-acts a:hover{border-color:var(--green);color:var(--green);text-decoration:none}',
    '#egg .egg-acts a.primary{border-color:color-mix(in srgb,var(--green) 45%,transparent);',
    'color:var(--green);background:color-mix(in srgb,var(--green) 12%,transparent)}',
    '#egg .ok{color:var(--green);border:1px solid color-mix(in srgb,var(--green) 45%,transparent);border-radius:20px;',
    'padding:1px 10px;font-family:var(--mono);font-size:11.5px}',
    '.clearance{font-family:var(--mono);font-size:11.5px;color:var(--yellow);',
    'border:1px solid color-mix(in srgb,var(--yellow) 45%,transparent);border-radius:20px;padding:1px 9px}'
  ].join('');

  function footerBadge() {
    var l = lvl();
    if (!l) return;
    var f = document.querySelector('footer');
    if (!f || f.querySelector('.clearance')) return;
    var s = document.createElement('span');
    s.className = 'clearance';
    s.textContent = 'CLEARANCE T' + l;
    f.appendChild(s);
  }

  function build() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);

    var l = lvl();
    var p = document.createElement('section');
    p.id = 'egg';
    p.hidden = true;
    p.setAttribute('aria-label', 'SITE-Ψ 串扰信号');
    p.innerHTML =
      '<h3>[串扰] 频道 7.3 · 不明信号<span class="ok" id="egg-ok" hidden></span></h3>' +
      '<p><b>SITE-Ψ 外联线</b>：一段收容影像的残页掉进了本站附件区（编号 Ψ12-A01），值班监听员没跟进——' +
      '他说他已经被广播里的解说吵到申请调岗三次。</p>' +
      '<p>终端还开着。广播里的人说，等你先动手。</p>' +
      '<div class="egg-acts">' +
      '<a class="primary" href="/secret/">接入监听终端 03 →</a>' +
      '<a href="/secret/wall.png" download>取走残页 Ψ12-A01</a>' +
      '</div>';

    var footer = document.querySelector('footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(p, footer);
    else document.body.appendChild(p);

    var ok = p.querySelector('#egg-ok');
    if (l === 2) { ok.hidden = false; ok.textContent = '✓ CLEARANCE T2'; }
    else if (l === 1) { ok.hidden = false; ok.textContent = '✓ CLEARANCE T1'; }
    return p;
  }

  var panel = null;
  function reveal() {
    if (!panel) panel = build();
    if (panel.hidden) {
      panel.hidden = false;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } catch (e) { panel.scrollIntoView(); }
    }
  }

  // ① 键盘：敲 bobby（呼号）或 psi（站点代号）
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      buf = (buf + e.key.toLowerCase()).slice(-7);
      if (/(bobby|psi)$/.test(buf)) reveal();
    } else {
      buf = '';
    }
  });

  // ② 连点页脚年份 3 次
  var year = document.querySelector('footer span');
  if (year) {
    year.style.cursor = 'default';
    year.addEventListener('click', function () {
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () { taps = 0; }, 1200);
      if (taps >= 3) { taps = 0; reveal(); }
    });
  }

  // ③ URL 直达
  function hashCheck() { if (location.hash.replace('#', '') === 'secret') reveal(); }
  window.addEventListener('hashchange', hashCheck);
  hashCheck();
  footerBadge();
})();
