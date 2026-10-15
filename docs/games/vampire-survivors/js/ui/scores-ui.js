/* ===========================================================
   个人纪录榜界面：开始面板的「🏆 个人纪录」+ 结算面板的「本局排名」
   数据来自 VS.Scores（本机 top5，登录后跟着云存档合并，见 core/scores.js）
   =========================================================== */
(function (VS) {
  'use strict';

  var dom = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function refresh() {
    if (!dom || !VS.Scores) return;
    var list = VS.Scores.list();
    dom.list.textContent = '';
    if (!list.length) {
      dom.list.appendChild(el('p', 'rank-empty', '还没有记录 —— 玩一局就会出现在这里'));
      return;
    }
    list.forEach(function (r, i) {
      var row = el('div', 'rank-row');
      row.appendChild(el('span', 'rank-no', '#' + (i + 1)));
      row.appendChild(el('span', 'rank-main', VS.Scores.line(r, i).replace(/^#\d+\s+/, '')));
      if (i === 0) row.classList.add('rank-top');
      dom.list.appendChild(row);
    });
  }

  /** 结算面板上加一行「本局排名」（没进前 5 就不显示） */
  function showRank(info) {
    var panel = document.getElementById('panel-gameover');
    if (!panel) return;
    var box = panel.querySelector('#goRank');
    if (!box) {
      box = el('p', 'go-rank');
      box.id = 'goRank';
      var result = panel.querySelector('.result');
      if (result) result.appendChild(box); else panel.appendChild(box);
    }
    if (info && info.rank > 0) {
      box.hidden = false;
      box.textContent = info.rank === 1 ? '🏆 本局是你自己的第 1 名！' : '🏆 本局排进个人榜第 ' + info.rank + ' 名';
    } else {
      box.hidden = true;
      box.textContent = '';
    }
  }

  function build() {
    if (dom || !VS.Scores) return;
    var panel = document.getElementById('panel-start');
    if (!panel) return;

    var root = el('div', 'ranks');
    var head = el('div', 'ranks-head');
    head.appendChild(el('b', null, '🏆 个人纪录'));
    head.appendChild(el('span', 'ranks-sub', '前 5 · 登录后跟着云存档走'));
    var list = el('div', 'ranks-list');
    root.appendChild(head);
    root.appendChild(list);
    /* 个人纪录跟在「全站榜」后面（leaderboard-ui 会插到 .ranks 之前），一起放在云存档设置之前：
       榜单留在首屏可见，账号/存档那套设置沉到面板底部滚动查看。 */
    panel.insertBefore(root, panel.querySelector('.cloud') || null);
    dom = { root: root, list: list };

    refresh();

    if (VS.Cloud && VS.Cloud.on) {
      VS.Cloud.on(function (type) { if (type === 'pull' || type === 'sync' || type === 'push') refresh(); });
    }
  }

  var ScoresUI = { build: build, refresh: refresh, showRank: showRank };

  VS.register('ScoresUI', ScoresUI);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.VS = window.VS || {});
