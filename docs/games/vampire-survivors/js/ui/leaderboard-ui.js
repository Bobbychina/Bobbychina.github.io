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
      if (VS.Leaderboard.canSubmit()) {
        note('已云账号登录：' + (VS.Leaderboard.who() || '') + ' —— 每局结束自动上榜', 'ok');
      } else if (VS.Cloud && VS.Cloud.logged && VS.Cloud.logged()) {
        /* GitHub/第三方登录的存档走自己的 Gist、不经过服务端，服务端认不出人 → 上不了榜 */
        note('你现在是第三方登录（GitHub），这条路不经过服务端、上不了榜；用下面「云账号登录」才能上榜（账号在游戏厅注册）', 'warn');
      } else {
        note('看榜不用登录；上榜要云账号 —— 在游戏厅注册后，回这里用「云账号登录」即可（每局结束自动上榜）', '');
      }
    } else {
      note(r.err || '取榜单失败', 'bad');
    }
    syncLink();
  }

  /** 没登录云账号时，头部给一条明确的路（不然玩家根本不知道去哪注册） */
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
    if (!dom || !VS.Leaderboard.canSubmit()) return null;
    var r = await VS.Leaderboard.submit(run);
    if (r.ok && r.data) {
      if (Array.isArray(r.data.list)) render(r.data.list);
      note(r.data.better
        ? ('已上榜：全站第 ' + r.data.rank + ' 名（个人最好 ' + VS.Utils.formatTime(r.data.best.time) + '）')
        : ('这局没超过你的最好成绩（全站第 ' + r.data.rank + ' 名）'), 'ok');
      if (r.data.rank > 0) showRank({ rank: r.data.rank, total: (r.data.list || []).length });
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
    title.appendChild(el('b', null, '🌍 全站榜'));
    var refreshBtn = el('button', 'cbtn ghost', '刷新');
    refreshBtn.type = 'button';
    /* 注册/登录入口就放在榜单旁边：全站榜必须用云账号才上得了，玩家不该去别处找 */
    var link = el('a', 'lb-link', '注册 / 登录云账号');
    link.href = '/games/';
    link.target = '_blank';
    link.rel = 'noopener';
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
    /* 根因修复：原来 appendChild 到面板最末尾 —— 开始面板 1100px 高，900px 窗口里榜单顶部在 901px，
       整块落在首屏外（玩家永远看不到，榜一直是空的）。现在挂在「个人纪录」之前、云存档设置之前：
       全站榜长期保持首屏可见，个人纪录/云存档往后排。 */
    panel.insertBefore(root, panel.querySelector('.ranks') || panel.querySelector('.cloud') || null);

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
