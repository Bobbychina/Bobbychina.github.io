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
  var currentPets = [];        // 当前展示的三只宠物
  var bannerTimer = null;

  function el(id) { return document.getElementById(id); }

  function passiveName(id) {
    for (var i = 0; i < VS.Config.UPGRADES.length; i++) {
      if (VS.Config.UPGRADES[i].id === id) return VS.Config.UPGRADES[i].name;
    }
    return id;
  }

  function starterInfo() {
    if (!dom || !dom.startWeapon || !dom.starterDesc) return;
    var def = VS.Config.WEAPONS[dom.startWeapon.value];
    if (def) dom.starterDesc.textContent = def.desc;
  }

  function modeInfo() {
    if (!dom) return;
    var endless = dom.startMode && dom.startMode.value === 'endless';
    if (dom.modeDesc) dom.modeDesc.textContent = endless
      ? '无时间上限 · 构筑持续保留 · 每 3 分钟提升波次 · 每 5 分钟刷新首领'
      : '双关战役 · 第一关生存 15 分钟 · 第二关从 1 级重来，并在 15 分钟内击败最终首领';
    if (dom.previewL2Btn) dom.previewL2Btn.hidden = endless;
    var game = VS.Game && VS.Game.current;
    var data = game ? game.data : VS.Save.load();
    var best = VS.Save.profile(data, endless ? 'endless' : 'campaign').bestTime || 0;
    if (dom.startBest) dom.startBest.textContent = best > 0 ? U.formatTime(best) : '--:--';
    if (dom.startBtn && !dom.startBtn.disabled) dom.startBtn.textContent = endless ? '开始无尽狩猎' : '开始战役';
    if (VS.ScoresUI) VS.ScoresUI.refresh(endless ? 'endless' : 'campaign');
  }

  function renderArsenal() {
    if (!dom || !dom.arsenalContent) return;
    var html = '<p>16 把基础武器，每局最多携带 4 把。八把扩展武器各有三条互斥分支，共新增 24 条流派，每条最高 3 级。第二关专属武器在无尽 10 分钟后入池。</p>';
    Object.keys(VS.Config.WEAPONS).forEach(function (id) {
      var weapon = VS.Config.WEAPONS[id];
      html += '<div class="arsenal-entry"><p><b style="color:' + weapon.color + '">' + weapon.icon + ' ' + weapon.name + '</b> · ' + weapon.desc + '</p>';
      if (weapon.schools) {
        html += '<div class="arsenal-branches">';
        weapon.schools.forEach(function (schoolId) {
          var s = VS.Config.SCHOOLS[schoolId];
          html += '<div class="arsenal-branch" style="--branch-color:' + s.color + '"><b>' + s.icon + ' ' + s.name + '</b><span>' + s.short + '</span></div>';
        });
        html += '</div>';
      } else if (weapon.school) html += '<p>原有流派 · ' + weapon.school.name + '：' + weapon.school.short + '</p>';
      html += '</div>';
    });
    html += '<p>满级武器 + 对应被动 → 升级时出现进化卡。进化保留武器栏位与流派。</p><ul>';
    Object.keys(VS.Config.EVOLUTIONS).forEach(function (id) {
      var evo = VS.Config.EVOLUTIONS[id], base = VS.Config.WEAPONS[id];
      html += '<li><b>' + evo.name + '</b>：' + base.name + ' Lv.' + base.maxLevel + ' + ' +
        passiveName(evo.passive) + ' Lv.' + evo.passiveLevel + '<br>' + evo.desc + '</li>';
    });
    dom.arsenalContent.innerHTML = html + '</ul>';
  }

  function evolutionProgress(player) {
    var rows = [];
    player.weapons.forEach(function (w) {
      var status = VS.Weapons.evolutionStatus(player, w.id);
      if (!status) return;
      var base = VS.Config.WEAPONS[w.id], evo = status.def;
      var state = status.evolved ? '已进化' : status.ready ? '可进化 · 升级时出现' : '配方未齐';
      rows.push('<div class="evolution-recipe' + (status.ready ? ' ready' : '') + '"><b>' + evo.name + ' · ' + state + '</b>' +
        '<span>' + base.name + ' ' + w.level + '/' + base.maxLevel + ' 级 + ' +
        passiveName(evo.passive) + ' ' + Math.min(status.passiveLevel, evo.passiveLevel) + '/' + evo.passiveLevel + ' 级</span></div>');
    });
    return rows.length ? '<details class="build-evolutions"><summary>武器进化 · 查看配方与进度</summary>' + rows.join('') + '</details>' : '';
  }

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
        panelPetSelect: el('panel-petselect'),
        panelLevelClear: el('panel-levelclear'),
        panelPause: el('panel-pause'),
        panelGameOver: el('panel-gameover'),

        startBest: el('startBest'),
        startLevels: el('startLevels'),
        startBtn: el('startBtn'),
        startMode: el('startMode'),
        modeDesc: el('modeDesc'),
        previewL2Btn: el('previewL2Btn'),
        startWeapon: el('startWeapon'),
        starterDesc: el('starterDesc'),
        arsenalContent: el('arsenalContent'),

        luLevel: el('luLevel'),
        luCards: el('luCards'),
        luBuild: el('luBuild'),
        luQueue: el('luQueue'),
        rerollBtn: el('rerollBtn'),

        petCards: el('petCards'),
        petSelectSub: el('petSelectSub'),

        lcTitle: el('lcTitle'),
        lcSub: el('lcSub'),
        lcTime: el('lcTime'),
        lcKills: el('lcKills'),
        lcLevel: el('lcLevel'),
        lcPet: el('lcPet'),
        lcTotal: el('lcTotal'),
        lcTip: el('lcTip'),
        nextLevelBtn: el('nextLevelBtn'),

        pauseInfo: el('pauseInfo'),
        resumeBtn: el('resumeBtn'),
        pauseRestartBtn: el('pauseRestartBtn'),
        endEndlessBtn: el('endEndlessBtn'),
        goMenuBtn: el('goMenuBtn'),

        goTitle: el('goTitle'),
        goReason: el('goReason'),
        goTime: el('goTime'),
        goBest: el('goBest'),
        goNewBest: el('goNewBest'),
        goKills: el('goKills'),
        goLevel: el('goLevel'),
        goStage: el('goStage'),
        retryBtn: el('retryBtn'),

        banner: el('banner'),
        bannerTitle: el('bannerTitle'),
        bannerSub: el('bannerSub')
      };

      dom.panels = [dom.panelStart, dom.panelLevelUp, dom.panelPetSelect,
                    dom.panelLevelClear, dom.panelPause, dom.panelGameOver];

      if (dom.startWeapon) {
        dom.startWeapon.innerHTML = VS.Config.START_WEAPONS.map(function (id) {
          var w = VS.Config.WEAPONS[id];
          return '<option value="' + id + '">' + w.icon + ' ' + w.name + '</option>';
        }).join('');
        dom.startWeapon.addEventListener('change', starterInfo);
        starterInfo();
      }
      renderArsenal();
      if (dom.startMode) dom.startMode.addEventListener('change', modeInfo);
      bindClick(dom.startBtn, function () { Panels.start(); });
      bindClick(dom.previewL2Btn, function () { if (cb.onPreviewLevel) cb.onPreviewLevel(1, dom.startWeapon ? dom.startWeapon.value : null); });
      bindClick(dom.retryBtn, function () { if (cb.onRetry) cb.onRetry(); });
      bindClick(dom.resumeBtn, function () { if (cb.onResume) cb.onResume(); });
      bindClick(dom.pauseRestartBtn, function () { if (cb.onRestart) cb.onRestart(); });
      bindClick(dom.nextLevelBtn, function () { if (cb.onNextLevel) cb.onNextLevel(); });
      bindClick(dom.rerollBtn, function () { if (cb.onReroll) cb.onReroll(); });
      bindClick(dom.endEndlessBtn, function () { if (cb.onEndEndless) cb.onEndEndless(); });
      bindClick(dom.goMenuBtn, function () { if (cb.onMenu) cb.onMenu(); });

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

    start: function () {
      if (cb.onStart) cb.onStart(dom && dom.startWeapon ? dom.startWeapon.value : null,
        dom && dom.startMode ? dom.startMode.value : 'campaign');
    },

    showStart: function (bestTime, levelCount) {
      if (!dom) return;
      if (dom.startBest) dom.startBest.textContent = bestTime > 0 ? U.formatTime(bestTime) : '--:--';
      if (dom.startLevels && levelCount) dom.startLevels.textContent = String(levelCount);
      modeInfo();
      show(dom.panelStart);
    },

    /* ---------------- 升级面板 ---------------- */

    showLevelUp: function (choices, level, game) {
      if (!dom) return;
      currentChoices = choices || [];

      if (dom.luLevel) dom.luLevel.textContent = ' Lv.' + level;
      if (dom.luQueue) dom.luQueue.textContent = game && game.pendingLevels > 1
        ? '还需选择 ' + game.pendingLevels + ' 次' : '选择 1 项';

      if (dom.luBuild && game && game.player) {
        var p = game.player;
        var weapons = p.weapons.map(function (w) {
          var def = VS.Config.WEAPONS[w.id];
          if (!def) return '';
          var display = w.evolved && VS.Config.EVOLUTIONS[w.id] ? VS.Config.EVOLUTIONS[w.id] : def;
          var branch = VS.Config.SCHOOLS && VS.Config.SCHOOLS[w.schoolId];
          return '<span class="build-chip" style="--chip-accent:' + display.color + '">' +
            display.icon + ' ' + display.name + ' <b>' + (w.evolved ? '进化' : 'Lv.' + w.level) + '</b>' +
            (branch ? ' · ' + branch.name + ' ' + w.schoolRank + '/3' : w.school ? ' · ' + def.school.name + ' ' + w.school : '') + '</span>';
        }).join('');
        var passives = VS.Config.UPGRADES.filter(function (up) { return p.upgrades[up.id] > 0; })
          .map(function (up) { return '<span class="build-chip">' + up.name + ' <b>Lv.' + p.upgrades[up.id] + '</b></span>'; });
        var pet = VS.Pets && VS.Pets.statusText ? VS.Pets.statusText(game.pets) : '';
        var lastStand = p.lastStandBonus > 0 && p.hp <= p.maxHp * 0.5
          ? '<span>背水生效 +' + Math.round(p.lastStandBonus * 100) + '%</span>' : '';
        dom.luBuild.innerHTML = '<div class="build-line"><span class="build-label">武器 ' + p.weapons.length + '/' + VS.Config.MAX_WEAPONS + '</span>' + weapons + '</div>' +
          '<div class="build-line build-stats"><span>生命 ' + Math.ceil(p.hp) + '/' + Math.round(p.maxHp) + '</span>' +
          '<span>伤害加成 ×' + p.damageMul.toFixed(2) + '</span>' + lastStand + '<span>护甲 ' + p.armor + '</span>' +
          '<span>闪避冷却 ' + (VS.Config.PLAYER.DASH.CD * p.dashCooldownMul).toFixed(2) + ' 秒</span>' +
          (pet ? '<span>宠物 ' + pet + '</span>' : '') + '</div>' +
          '<details class="build-passives"><summary>被动增益 ' + passives.length + ' 项</summary>' +
          '<div class="build-passive-list">' + (passives.join('') || '<span>尚无被动增益</span>') + '</div></details>' + evolutionProgress(p);
      }
      if (dom.rerollBtn && game) {
        dom.rerollBtn.textContent = !game.choiceHasAlternative ? '没有其他可重选技能' :
          (game.rerollsRemaining > 0 ? '重选技能 · 剩余 ' + game.rerollsRemaining + ' 次' : '重选次数已用完');
        dom.rerollBtn.disabled = game.rerollsRemaining <= 0 || !game.choiceHasAlternative;
        dom.rerollBtn.title = !game.choiceHasAlternative ? '没有其他可选技能' : '优先抽取本次未展示的技能';
      }

      var html = '';
      for (var i = 0; i < currentChoices.length; i++) {
        var c = currentChoices[i];
        // 卡片主色：新武器=青，武器升级=金，增益=紫，流派=跟着武器自身配色
        var accent = c.color || (c.kind === 'buff' ? '#b58cff' : '#7ee0ff');

        var kind = c.kind === 'evolution' ? '武器进化' : c.kind === 'weapon-new' ? '新武器' : c.kind === 'weapon-up' ? '武器升级' : c.kind === 'school' ? '流派' : '被动';
        html += '<button type="button" class="card' + (c.isSchool ? ' school' : '') + (c.isEvolution ? ' evolution' : '') + '" data-index="' + i +
                  '" style="--card-accent:' + accent + '">' +
                  '<span class="card-top"><span class="card-kind">' + kind + '</span><span class="card-number">0' + (i + 1) + '</span></span>' +
                  '<span class="ico" aria-hidden="true">' + c.icon + '</span>' +
                  '<span class="nm">' + c.name + '</span>' +
                  (c.tag ? '<span class="tag' + (c.isNew ? ' new' : (c.isSchool ? ' school' : '')) + '">' +
                           c.tag + (c.maxLevel ? (c.tag.indexOf('→') >= 0 ? ' / ' + c.maxLevel : ' · 上限 ' + c.maxLevel + ' 级') : '') + '</span>' : '') +
                  (c.currentDesc ? '<span class="compare-current">当前 · ' + c.currentDesc + '</span>' : '') +
                  '<span class="ds">' + (c.currentDesc ? '<strong>升级后 · </strong>' : '') + c.desc + '</span>' +
                  '<span class="key">按 ' + (i + 1) + ' 选择 ↗</span>' +
                '</button>';
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
      dom.panelLevelUp.scrollTop = 0;
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

    /* ---------------- 宠物三选一面板 ----------------
       打完第一只 Boss 才出现，三选一，选完永久生效。 */

    showPetSelect: function (pets, levelIndex, draftCards) {
      if (!dom) return;
      currentPets = pets || [];
      if (dom.petSelectSub) dom.petSelectSub.textContent = draftCards > 0
        ? '第二关预览 · 先选择宠物，再选择 ' + draftCards + ' 项强化'
        : '击杀尸潮之王的奖励 · 等级 +1 · 宠物本关生效' +
          (levelIndex > 0 ? ' · 第二关可选专属宠物' : ' · 进入第二关后宠物会重置');

      var html = '';
      for (var i = 0; i < currentPets.length; i++) {
        var p = currentPets[i];
        var accent = p.color || '#ffd166';

        html += '<button type="button" class="card pet" data-index="' + i + '" style="--card-accent:' + accent + '">' +
                  '<div class="ico">' + p.icon + '</div>' +
                  '<div class="nm">' + p.name + '</div>' +
                  '<div class="ds">' + p.desc + '</div>' +
                  '<div class="tag">' + (p.detail || '永久生效') + '</div>' +
                  '<div class="key">按 ' + (i + 1) + ' 选择</div>' +
                '</button>';
      }

      if (dom.petCards) {
        dom.petCards.innerHTML = html;

        var cards = dom.petCards.querySelectorAll('.card');
        for (var j = 0; j < cards.length; j++) {
          (function (node) {
            node.addEventListener('click', function (e) {
              e.stopPropagation();
              var idx = parseInt(node.getAttribute('data-index'), 10);
              Panels.choosePet(idx);
            });
          })(cards[j]);
        }
      }

      show(dom.panelPetSelect);
    },

    /** 玩家点了某只宠物（或被键盘 1/2/3 触发） */
    choosePet: function (index) {
      if (!currentPets[index]) return;
      if (cb.onChoosePet) cb.onChoosePet(index, currentPets[index]);
    },

    hidePetSelect: function () {
      if (!dom) return;
      dom.panelPetSelect.hidden = true;
      currentPets = [];
      syncOverlay();
    },

    /* ---------------- 过关面板 ----------------
       本关时间到就弹出来：最后一关的按钮变成「查看结算」。 */

    showLevelClear: function (info) {
      if (!dom) return;
      info = info || {};

      if (dom.lcTitle) {
        dom.lcTitle.textContent = info.last
          ? (info.label + ' 通过')
          : (info.label + ' 通过');
      }
      if (dom.lcSub) {
        dom.lcSub.textContent = info.last
          ? '所有关卡都打完了 · 看看这一局的成绩'
          : ('下一关：' + (info.nextLabel || '') +
             (info.nextFresh ? ' · 从 1 级重新开始，怪物生命提高'
                             : ' · 构筑 / 等级 / 宠物都带过去'));
      }
      if (dom.lcTip) dom.lcTip.textContent = info.last ? '查看本局结算。' : (info.nextFresh
        ? '下一关从 1 级开始，武器、被动与宠物会重置；保留本局累计时间和击杀。'
        : '构筑、等级、宠物会带进下一关；血量回满并获得短暂无敌。');
      if (dom.lcTime) dom.lcTime.textContent = U.formatTime(info.time || 0);
      if (dom.lcKills) dom.lcKills.textContent = U.group(info.kills || 0);
      if (dom.lcLevel) dom.lcLevel.textContent = String(info.playerLevel || 1);
      if (dom.lcPet) dom.lcPet.textContent = info.pet || '—';
      if (dom.lcTotal) dom.lcTotal.textContent = U.formatTime(info.total || 0);
      if (dom.nextLevelBtn) {
        dom.nextLevelBtn.textContent = info.last ? '查看结算' : ('进入' + (info.nextLabel || '下一关'));
      }

      show(dom.panelLevelClear);
    },

    hideLevelClear: function () {
      if (!dom) return;
      dom.panelLevelClear.hidden = true;
      syncOverlay();
    },

    /* ---------------- 暂停面板 ---------------- */

    showPause: function (info, game) {
      if (!dom) return;
      if (dom.pauseInfo) dom.pauseInfo.textContent = info || '';
      if (dom.endEndlessBtn) dom.endEndlessBtn.hidden = !game || game.mode !== 'endless';
      show(dom.panelPause);
    },

    /* ---------------- 结束面板 ---------------- */

    showGameOver: function (r) {
      if (!dom) return;

      /* 通关 / 阵亡 / 时间到但没打死最终 Boss —— 三种结局共用一个面板 */
      if (dom.goTitle) {
        if (r.mode === 'endless') {
          dom.goTitle.textContent = '无 尽 结 算';
          dom.goTitle.className = 'clear';
        } else if (r.victory) {
          dom.goTitle.textContent = '通 关 ！';
          dom.goTitle.className = 'clear';
        } else if (r.failedClear) {
          dom.goTitle.textContent = '没 能 通 关';
          dom.goTitle.className = 'dead';
        } else {
          dom.goTitle.textContent = '你已阵亡';
          dom.goTitle.className = 'dead';
        }
      }
      if (dom.goReason) {
        dom.goReason.textContent = r.reason || '';
        dom.goReason.hidden = !r.reason;
      }
      if (dom.goTime) dom.goTime.textContent = U.formatTime(r.time);
      if (dom.goBest) dom.goBest.textContent = U.formatTime(r.best);
      if (dom.goKills) dom.goKills.textContent = U.group(r.kills);
      if (dom.goLevel) dom.goLevel.textContent = String(r.level);
      if (dom.goStage) {
        dom.goStage.textContent = r.stageLabel || String(r.stage || 1);
      }
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
      if (dom.panelPetSelect && !dom.panelPetSelect.hidden) return 'petselect';
      if (dom.panelLevelClear && !dom.panelLevelClear.hidden) return 'levelclear';
      if (!dom.panelPause.hidden) return 'pause';
      if (!dom.panelGameOver.hidden) return 'gameover';
      if (!dom.panelStart.hidden) return 'start';
      return null;
    }
  };

  VS.register('Panels', Panels);

})(window.VS = window.VS || {});
