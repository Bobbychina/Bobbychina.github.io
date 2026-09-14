/* 隐藏彩蛋入口 ·《站长失踪案》第一层
 * 触发方式（三种，任选）：
 *   ① 键盘依次敲下 bobby（页面任意处，不在输入框内）
 *   ② 连点页脚 "© 2026 Bobbychina" 3 次
 *   ③ 访问 /#secret
 *   （源码里那段"值班记录"注释用零宽字符藏了同一句提示，解出来就是 type bobby）
 * 状态：localStorage['dsh_secret_l1'] === 'ok' 表示第一层已通关。
 */
(function () {
  'use strict';
  var KEY1 = 'dsh_secret_l1';
  var buf = '', taps = 0, tapTimer = null;

  function unlocked() { try { return localStorage.getItem(KEY1) === 'ok'; } catch (e) { return false; } }

  var CSS = [
    '#egg{margin-top:26px;background:var(--card);border:1px solid color-mix(in srgb,var(--yellow) 45%,var(--line));',
    'border-radius:12px;padding:18px 20px}',
    '#egg h3{font-family:var(--mono);font-size:14px;color:var(--yellow);display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '#egg p{color:var(--dim);font-size:13.8px;margin-top:8px}',
    '#egg p b{color:var(--ink)}',
    '#egg .egg-acts{display:flex;gap:10px;margin-top:14px;font-size:13.5px;flex-wrap:wrap}',
    '#egg .egg-acts a{display:inline-block;padding:10px 16px;border:1px solid var(--line2);border-radius:9px;transition:.16s}',
    '#egg .egg-acts a:hover{border-color:var(--green);color:var(--green);text-decoration:none}',
    '#egg .egg-acts a.primary{border-color:color-mix(in srgb,var(--green) 45%,transparent);',
    'color:var(--green);background:color-mix(in srgb,var(--green) 12%,transparent)}',
    '#egg .ok{color:var(--green);border:1px solid color-mix(in srgb,var(--green) 45%,transparent);border-radius:20px;',
    'padding:1px 10px;font-family:var(--mono);font-size:11.5px}'
  ].join('');

  function build() {
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);

    var p = document.createElement('section');
    p.id = 'egg';
    p.hidden = true;
    p.setAttribute('aria-label', '站长失踪案 · 隐藏线索');
    p.innerHTML =
      '<h3>⚠ 站长离线 · 第 3 天<span class="ok" id="egg-ok" hidden>✓ 署名已找回</span></h3>' +
      '<p>后台只剩一张照片：<b>一面墙</b>。AI 把 base64、栅栏、隐写工具都试过一遍——' +
      '它读不了"手写的旧密码"，它需要一个人。</p>' +
      '<div class="egg-acts">' +
      '<a class="primary" href="/secret/">进入现场 →</a>' +
      '<a href="/secret/wall.png" download>取走照片</a>' +
      '</div>';

    var footer = document.querySelector('footer');
    if (footer && footer.parentNode) footer.parentNode.insertBefore(p, footer);
    else document.body.appendChild(p);
    return p;
  }

  var panel = null;
  function reveal() {
    if (!panel) panel = build();
    if (unlocked()) { var ok = panel.querySelector('#egg-ok'); if (ok) ok.hidden = false; }
    if (panel.hidden) {
      panel.hidden = false;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { panel.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } catch (e) { panel.scrollIntoView(); }
    }
  }

  // ① 键盘：依次敲 bobby
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)) {
      buf = (buf + e.key.toLowerCase()).slice(-5);
      if (buf === 'bobby') reveal();
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
})();
