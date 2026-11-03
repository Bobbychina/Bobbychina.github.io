/* ===========================================================
   个人纪录榜界面：开始面板的「🏆 个人纪录」+ 结算面板的「本局排名」
   战役与无尽各自记录本机 top5。
   =========================================================== */
(function (VS) {
  'use strict';

  var dom = null;
  var mode = 'campaign';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function refresh(nextMode) {
    if (!dom || !VS.Scores) return;
    if (nextMode === 'campaign' || nextMode === 'endless') mode = nextMode;
    dom.tabs.forEach(function (tab) { tab.setAttribute('aria-pressed', String(tab.dataset.mode === mode)); });
    var list = VS.Scores.list(mode);
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
    head.appendChild(el('span', 'ranks-sub', '前 5 · 仅当前浏览器'));
    var list = el('div', 'ranks-list');
    var tabs = el('div', 'record-tabs');
    ['campaign', 'endless'].forEach(function (id) {
      var tab = el('button', null, id === 'endless' ? '无尽纪录' : '战役纪录');
      tab.type = 'button'; tab.dataset.mode = id;
      tab.addEventListener('click', function () { refresh(id); }); tabs.appendChild(tab);
    });
    root.appendChild(head);
    root.appendChild(tabs);
    root.appendChild(list);
    /* 全站榜插在个人纪录之前，两套纪录通过标签切换。 */
    panel.appendChild(root);
    dom = { root: root, list: list, tabs: Array.prototype.slice.call(tabs.children) };

    refresh();

  }

  var ScoresUI = { build: build, refresh: refresh, showRank: showRank };

  VS.register('ScoresUI', ScoresUI);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.VS = window.VS || {});
