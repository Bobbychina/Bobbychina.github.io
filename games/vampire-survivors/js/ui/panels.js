/* ===========================================================
   面板：开始 / 升级选卡 / 暂停 / 游戏结束
   这一层是唯一直接操作覆盖层 DOM 的地方。
   =========================================================== */
(function (VS) {
  'use strict';

  var U = VS.Utils;

  var cb = {};                 // 回调
  var dom = null;
  var currentChoices = [];     // 当前展示的三张卡
  var bannerTimer = null;

  function el(id) { return document.getElementById(id); }

  function syncOverlay() {
    if (!dom || !dom.overlays) return;
    var anyVisible = false;
    for (var i = 0; i < dom.panels.length; i++) {
      if (!dom.panels[i].hidden) { anyVisible = true; break; }
    }
    if (anyVisible) dom.overlays.classList.remove('hidden');
    else dom.overlays.classList.add('hidden');
  }

  function show(panel) {
    if (!dom) return;
    for (var i = 0; i < dom.panels.length; i++) dom.panels[i].hidden = true;
    panel.hidden = false;
    syncOverlay();
  }

  function hideAll() {
    if (!dom) return;
    for (var i = 0; i < dom.panels.length; i++) dom.panels[i].hidden = true;
    syncOverlay();
  }

  function bindClick(node, fn) {
    if (!node) return;
    node.addEventListener('click', function (e) {
      e.stopPropagation();
      VS.Audio.play('click');
      fn();
    });
  }

  var Panels = {

    init: function (callbacks) {
      cb = callbacks || {};

      dom = {
        overlays: el('overlays'),
        panelStart: el('panel-start'),
        panelLevelUp: el('panel-levelup'),
        panelPause: el('panel-pause'),
        panelGameOver: el('panel-gameover'),

        startBest: el('startBest'),
        startBtn: el('startBtn'),

        luLevel: el('luLevel'),
        luCards: el('luCards'),

        pauseInfo: el('pauseInfo'),
        resumeBtn: el('resumeBtn'),
        pauseRestartBtn: el('pauseRestartBtn'),

        goTime: el('goTime'),
        goBest: el('goBest'),
        goNewBest: el('goNewBest'),
        goKills: el('goKills'),
        goLevel: el('goLevel'),
        goWave: el('goWave'),
        retryBtn: el('retryBtn'),

        banner: el('banner'),
        bannerTitle: el('bannerTitle'),
        bannerSub: el('bannerSub')
      };

      dom.panels = [dom.panelStart, dom.panelLevelUp, dom.panelPause, dom.panelGameOver];

      bindClick(dom.startBtn, function () { if (cb.onStart) cb.onStart(); });
      bindClick(dom.retryBtn, function () { if (cb.onRetry) cb.onRetry(); });
      bindClick(dom.resumeBtn, function () { if (cb.onResume) cb.onResume(); });
      bindClick(dom.pauseRestartBtn, function () { if (cb.onRestart) cb.onRestart(); });

      hideAll();
      return Panels;   // 返回模块本身（而不是内部 dom 缓存）
    },

    /* ---------------- 阶段播报横幅 ----------------
       不占用覆盖层，也不拦截点击：游戏照常进行，
       横幅自己淡入淡出。 */

    showBanner: function (title, sub) {
      if (!dom || !dom.banner) return;

      if (dom.bannerTitle) dom.bannerTitle.textContent = title || '';
      if (dom.bannerSub) {
        dom.bannerSub.textContent = sub || '';
        dom.bannerSub.hidden = !sub;
      }

      dom.banner.hidden = false;

      // 先移除再强制重排，让 CSS 动画每次都能重新播放
      dom.banner.classList.remove('show');
      void dom.banner.offsetWidth;
      dom.banner.classList.add('show');

      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(function () {
        if (dom && dom.banner) {
          dom.banner.hidden = true;
          dom.banner.classList.remove('show');
        }
      }, 2600);
    },

    hideBanner: function () {
      if (!dom || !dom.banner) return;
      if (bannerTimer) clearTimeout(bannerTimer);
      dom.banner.hidden = true;
      dom.banner.classList.remove('show');
    },

    /* ---------------- 开始面板 ---------------- */

    showStart: function (bestTime) {
      if (!dom) return;
      if (dom.startBest) dom.startBest.textContent = bestTime > 0 ? U.formatTime(bestTime) : '--:--';
      show(dom.panelStart);
    },

    /* ---------------- 升级面板 ---------------- */

    showLevelUp: function (choices, level) {
      if (!dom) return;
      currentChoices = choices || [];

      if (dom.luLevel) dom.luLevel.textContent = ' Lv.' + level;

      var html = '';
      for (var i = 0; i < currentChoices.length; i++) {
        var c = currentChoices[i];
        // 卡片主色：新武器=青，武器升级=金，增益=紫
        var accent = c.color || (c.kind === 'buff' ? '#b58cff' : '#7ee0ff');

        html += '<div class="card" data-index="' + i + '" style="--card-accent:' + accent + '">' +
                  '<div class="ico">' + c.icon + '</div>' +
                  '<div class="nm">' + c.name + '</div>' +
                  '<div class="ds">' + c.desc + '</div>' +
                  (c.tag ? '<div class="tag' + (c.isNew ? ' new' : '') + '">' + c.tag + '</div>' : '') +
                  '<div class="key">按 ' + (i + 1) + ' 选择</div>' +
                '</div>';
      }

      if (dom.luCards) {
        dom.luCards.innerHTML = html;

        var cards = dom.luCards.querySelectorAll('.card');
        for (var j = 0; j < cards.length; j++) {
          (function (node) {
            node.addEventListener('click', function (e) {
              e.stopPropagation();
              var idx = parseInt(node.getAttribute('data-index'), 10);
              Panels.choose(idx);
            });
          })(cards[j]);
        }
      }

      show(dom.panelLevelUp);
    },

    /** 玩家点了某张卡（或被键盘 1/2/3 触发） */
    choose: function (index) {
      if (!currentChoices[index]) return;
      if (cb.onChoose) cb.onChoose(index, currentChoices[index]);
    },

    hideLevelUp: function () {
      if (!dom) return;
      dom.panelLevelUp.hidden = true;
      currentChoices = [];
      syncOverlay();
    },

    /* ---------------- 暂停面板 ---------------- */

    showPause: function (info) {
      if (!dom) return;
      if (dom.pauseInfo) dom.pauseInfo.textContent = info || '';
      show(dom.panelPause);
    },

    /* ---------------- 结束面板 ---------------- */

    showGameOver: function (r) {
      if (!dom) return;

      if (dom.goTime) dom.goTime.textContent = U.formatTime(r.time);
      if (dom.goBest) dom.goBest.textContent = U.formatTime(r.best);
      if (dom.goKills) dom.goKills.textContent = U.group(r.kills);
      if (dom.goLevel) dom.goLevel.textContent = String(r.level);
      if (dom.goWave) dom.goWave.textContent = String(r.wave);
      if (dom.goNewBest) dom.goNewBest.hidden = !r.isNewBest;

      show(dom.panelGameOver);
    },

    hideAll: hideAll,

    /** 当前是否有面板挡住画面（用于决定要不要接受移动输入） */
    anyVisible: function () {
      if (!dom) return false;
      for (var i = 0; i < dom.panels.length; i++) {
        if (!dom.panels[i].hidden) return true;
      }
      return false;
    },

    which: function () {
      if (!dom) return null;
      if (!dom.panelLevelUp.hidden) return 'levelup';
      if (!dom.panelPause.hidden) return 'pause';
      if (!dom.panelGameOver.hidden) return 'gameover';
      if (!dom.panelStart.hidden) return 'start';
      return null;
    }
  };

  VS.register('Panels', Panels);

})(window.VS = window.VS || {});
