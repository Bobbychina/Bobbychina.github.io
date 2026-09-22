/* ===========================================================
   全站榜界面（开始面板的「🌍 全站榜」）
   —— 读榜不用登录；上榜要云账号，没登录就只显示榜单 + 一行说明
   =========================================================== */
(function (VS) {
  'use strict';

  var dom = null;
  var last = [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function note(text, kind) {
    if (!dom || !dom.msg) return;
    dom.msg.textContent = text || '';
    dom.msg.className = 'lb-msg' + (kind ? ' ' + kind : '');
  }

  function render(list) {
    last = Array.isArray(list) ? list : [];
    if (!dom) return;
    dom.list.textContent = '';
    if (!last.length) {
      dom.list.appendChild(el('p', 'lb-empty', '榜上还没人 —— 第一个上榜的就是你（要云账号登录）'));
      return;
    }
    last.slice(0, 10).forEach(function (r, i) {
      var row = el('div', 'lb-row');
      row.appendChild(el('span', 'lb-no', '#' + (i + 1)));
      row.appendChild(el('span', 'lb-name', r.name || '?'));
      row.appendChild(el('span', 'lb-score', VS.Leaderboard.line(r, i).replace(/^#\d+\s+\S+\s+·\s+/, '')));
      if (VS.Leaderboard.who() && r.name === VS.Leaderboard.who()) row.classList.add('lb-me');
      dom.list.appendChild(row);
    });
  }

  async function refresh(quiet) {
    if (!dom) return;
    if (!VS.Leaderboard.available()) { note('这个页面没接云后端（auth-config.js 里 api 为空），全站榜不可用', 'warn'); return; }
    if (!quiet) note('正在取榜单…');
    var r = await VS.Leaderboard.top();
    if (r.ok && r.data) {
      render(r.data.list || []);
      note(VS.Leaderboard.canSubmit() ? ('已云账号登录：' + (VS.Leaderboard.who() || '') + ' —— 每局结束自动上榜')
        : '看榜不用登录；上榜要云账号登录（GitHub 登录的存档走自己的 Gist，不经过服务端）', VS.Leaderboard.canSubmit() ? 'ok' : '');
    } else {
      note(r.err || '取榜单失败', 'bad');
    }
  }

  /** 一局结束：能提交就提交，并把结果显示出来 */
  async function submitRun(run) {
    if (!dom || !VS.Leaderboard.canSubmit()) return null;
    var r = await VS.Leaderboard.submit(run);
    if (r.ok && r.data) {
      if (Array.isArray(r.data.list)) render(r.data.list);
      note(r.data.better
        ? ('已上榜：全站第 ' + r.data.rank + ' 名（个人最好 ' + VS.Utils.formatTime(r.data.best.time) + '）')
        : ('这局没超过你的最好成绩（全站第 ' + r.data.rank + ' 名）'), 'ok');
    } else {
      note(r.err || '提交成绩失败', 'warn');
    }
    return r;
  }

  function build() {
    if (dom || !VS.Leaderboard) return;
    var panel = document.getElementById('panel-start');
    if (!panel) return;

    var root = el('div', 'lb');
    var head = el('div', 'lb-head');
    head.appendChild(el('b', null, '🌍 全站榜'));
    var refreshBtn = el('button', 'cbtn ghost', '刷新');
    refreshBtn.type = 'button';
    head.appendChild(refreshBtn);
    var list = el('div', 'lb-list');
    var msg = el('p', 'lb-msg', '');
    root.appendChild(head);
    root.appendChild(list);
    root.appendChild(msg);
    panel.appendChild(root);

    dom = { root: root, list: list, msg: msg };
    refreshBtn.onclick = function () { refresh(false); };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(true); });
    else refresh(true);
  }

  var LeaderboardUI = { build: build, refresh: refresh, submitRun: submitRun, note: note };

  VS.register('LeaderboardUI', LeaderboardUI);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.VS = window.VS || {});
