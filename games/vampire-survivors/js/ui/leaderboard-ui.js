/* ===========================================================
   全站榜界面（开始面板的「🌍 全站榜」）
   —— 战役公开读榜；站点账号连接后提交。无尽模式保留独立本机纪录。
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
      dom.list.appendChild(el('p', 'lb-empty', '暂无战役成绩，连接站点账号后即可上榜'));
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
    if (!VS.Leaderboard.available()) { note('排行榜服务暂不可用，本机纪录仍会保存', 'warn'); return; }
    if (!quiet) note('正在取榜单…');
    var r = await VS.Leaderboard.top();
    if (r.ok && r.data) {
      render(r.data.list || []);
      if (VS.Leaderboard.canSubmit()) {
        note('已登录：' + (VS.Leaderboard.who() || '') + ' · 战役结算自动提交；无尽纪录保存在本机', 'ok');
      } else {
        note('看榜无需登录；用上方站点账号连接后，战役结束自动提交成绩', '');
      }
    } else {
      note(r.err || '取榜单失败', 'bad');
    }
    syncLink();
  }

  /** 榜单入口回到本页的统一站点账号面板。 */
  function syncLink() {
    if (!dom || !dom.link) return;
    dom.link.hidden = !!VS.Leaderboard.canSubmit();
  }

  /** 结算面板上补一行「本局全站排名」：和个人榜那行（#goRank）同一套做法，
      上榜这件事得在玩家刚打完那一秒被看见，藏在开始面板里等于没发生。 */
  function showRank(info) {
    var panel = document.getElementById('panel-gameover');
    if (!panel) return;
    var box = document.getElementById('goLbRank');
    if (!box) {
      box = el('p', 'go-rank go-rank-world');
      box.id = 'goLbRank';
      var result = panel.querySelector('.result');
      if (result) result.appendChild(box); else panel.appendChild(box);
    }
    if (info && info.rank > 0) {
      box.hidden = false;
      box.textContent = '🌍 全站第 ' + info.rank + ' 名' + (info.total > 1 ? (' · 榜上 ' + info.total + ' 人') : '');
    } else {
      box.hidden = true;
      box.textContent = '';
    }
  }

  /** 一局结束：能提交就提交，并把结果显示出来 */
  async function submitRun(run) {
    if (!dom || run.mode === 'endless' || !VS.Leaderboard.canSubmit()) return null;
    var runGame = VS.Game && VS.Game.current;
    var runSerial = runGame && runGame.runSerial;
    var identity = VS.SiteAccount.snapshot().user.sub;
    var r = await VS.Leaderboard.submit(run);
    var currentIdentity = VS.SiteAccount.snapshot().user;
    if (!currentIdentity || currentIdentity.sub !== identity) return r;
    if (r.ok && r.data) {
      if (Array.isArray(r.data.list)) render(r.data.list);
      note(r.data.better
        ? ('已上榜：全站第 ' + r.data.rank + ' 名（个人最好 ' + VS.Utils.formatTime(r.data.best.time) + '）')
        : ('这局没超过你的最好成绩（全站第 ' + r.data.rank + ' 名）'), 'ok');
      if (r.data.rank > 0 && runGame && runGame.runSerial === runSerial && runGame.state === VS.Game.STATE.GAMEOVER && runGame.mode !== 'endless') {
        showRank({ rank: r.data.rank, total: (r.data.list || []).length });
      }
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
    var title = el('span', 'lb-title');
    title.appendChild(el('b', null, '🌍 战役全站榜'));
    var refreshBtn = el('button', 'cbtn ghost', '刷新');
    refreshBtn.type = 'button';
    var link = el('button', 'lb-link', '连接站点账号');
    link.type = 'button';
    link.onclick = function () { if (VS.SiteAccount) VS.SiteAccount.focus(); };
    var actions = el('span', 'lb-actions');
    actions.appendChild(link);
    actions.appendChild(refreshBtn);
    head.appendChild(title);
    head.appendChild(actions);
    var list = el('div', 'lb-list');
    var msg = el('p', 'lb-msg', '');
    root.appendChild(head);
    root.appendChild(list);
    root.appendChild(msg);
    /* 排行榜列表独立滚动，个人纪录跟在其后。 */
    panel.insertBefore(root, panel.querySelector('.ranks') || null);

    dom = { root: root, list: list, msg: msg, link: link };
    refreshBtn.onclick = function () { refresh(false); };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(true); });
    else refresh(true);
  }

  var LeaderboardUI = { build: build, refresh: refresh, submitRun: submitRun, showRank: showRank, note: note };

  VS.register('LeaderboardUI', LeaderboardUI);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.VS = window.VS || {});
