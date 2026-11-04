/* ===========================================================
   面板：开始 / 金币商店 / 遗物 / 暂停 / 游戏结束
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
      ? '无时间上限 · 每 3 分钟提升波次 · 每 10 分钟推进场景，随后轮换寒潮与熔炉'
      : '四关远征 · 全程继承构筑与金币 · 随时按 B 购买强化';
    var game = VS.Game && VS.Game.current;
    var data = game ? game.data : VS.Save.load();
    var best = VS.Save.profile(data, endless ? 'endless' : 'campaign').bestTime || 0;
    if (dom.startBest) dom.startBest.textContent = best > 0 ? U.formatTime(best) : '--:--';
    if (dom.startBtn && !dom.startBtn.disabled) dom.startBtn.textContent = endless ? '开始无尽狩猎' : '开始战役';
    if (VS.ScoresUI) VS.ScoresUI.refresh(endless ? 'endless' : 'campaign');
  }

  function renderChapters() {
    if (!dom || !dom.chapterGuide) return;
    var html = '<p>四关依次推进，全程保留等级、构筑、宠物、遗物和金币。按 B 暂停战斗并购买强化。</p>';
    VS.Levels.list().slice(2).forEach(function (level) {
      html += '<div class="arsenal-entry"><p><b>' + level.name + ' · ' + level.subtitle + '</b> · 12 分钟</p><p>' +
        (level.mechanic === 'frost' ? '寒潮会累积寒意，高寒意使普通移动变慢；满值会持续受伤。靠近金色暖灯回温，闪避速度不受影响。' :
          '地火交替沿横向、纵向喷发，先预警再造成伤害。靠近青色卸压阀 1.2 秒能取消下轮喷发；熔心巨像在场时，还能打断招式并制造 2 秒增伤窗口。') + '</p>';
      level.bosses.forEach(function (boss) {
        var def = VS.Config.ENEMY_TYPES[boss.type];
        html += '<p><b>' + U.formatTime(boss.at) + ' · ' + def.name + '</b> · ' + (def.encounter === 'bell' ? '有缺口的钟环、扇形冰针与冰裂落点。' :
          def.encounter === 'queen' ? '冰晶交叉射线、交替钟环与延迟冰牢；半血后加快施法。' : '熔心扫射、延迟喷发与交错弹幕；利用卸压阀争取输出窗口。') +
          (boss.requireKill ? ' 本关结束前必须击败。' : '') + '</p>';
      });
      html += '</div>';
    });
    var roles = { warder: '交替举盾，闪避贴近可破盾', archer: '保持距离，瞄准后射出冰针', charger: '前摇后突进，重骑会连续冲锋',
      healer: '为附近普通敌人治疗，优先处理', bomber: '贴近后自爆，预警时击杀可阻止', caster: '预判走位并延迟轰击', splitter: '死亡后裂变为两只幼体' };
    html += '<div class="arsenal-entry"><p><b>新敌人 · 8 种常规敌人与裂变幼体</b></p>';
    Object.keys(VS.Config.ENEMY_TYPES).forEach(function (id) {
      var e = VS.Config.ENEMY_TYPES[id];
      if (e.behavior && !e.spawnOnly) html += '<p>' + e.name + '：' + roles[e.behavior] + '</p>';
    });
    html += '</div><p><b>遗物祭坛 · 靠近金色祭坛，额外三选一</b></p><p>新关卡在 01:30 与 05:30 出现祭坛，不消耗金币。每件遗物本局只可获得一次。</p>';
    VS.Config.RELICS.forEach(function (r) { html += '<p><b>' + r.icon + ' ' + r.name + '</b> · ' + r.desc + '</p>'; });
    dom.chapterGuide.innerHTML = html;
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
    html += '<p>满级武器 + 对应被动 → 商店中出现进化商品。进化保留武器栏位与流派。</p><ul>';
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
      var state = status.evolved ? '已进化' : status.ready ? '可在商店购买' : '配方未齐';
      rows.push('<div class="evolution-recipe' + (status.ready ? ' ready' : '') + '"><b>' + evo.name + ' · ' + state + '</b>' +
        '<span>' + base.name + ' ' + w.level + '/' + base.maxLevel + ' 级 + ' +
        passiveName(evo.passive) + ' ' + Math.min(status.passiveLevel, evo.passiveLevel) + '/' + evo.passiveLevel + ' 级</span></div>');
    });
    return rows.length ? '<details class="build-evolutions"><summary>武器进化 · 查看配方与进度</summary>' + rows.join('') + '</details>' : '';
  }

  function buildSummary(game) {
    if (!game || !game.player) return "";
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
    var relics = (game.relics || []).map(function (id) {
      var r = VS.Config.RELICS.filter(function (item) { return item.id === id; })[0];
      return r ? '<span class="build-chip">' + r.icon + ' ' + r.name + '</span>' : '';
    }).join('');
    var lastStand = p.lastStandBonus > 0 && p.hp <= p.maxHp * 0.5
      ? '<span>背水生效 +' + Math.round(p.lastStandBonus * 100) + '%</span>' : '';
    return '<div class="build-line"><span class="build-label">武器 ' + p.weapons.length + '/' + VS.Config.MAX_WEAPONS + '</span>' + weapons + '</div>' +
      '<div class="build-line build-stats"><span>生命 ' + Math.ceil(p.hp) + '/' + Math.round(p.maxHp) + '</span>' +
      '<span>伤害加成 ×' + p.damageMul.toFixed(2) + '</span>' + lastStand + '<span>护甲 ' + p.armor + '</span>' +
      '<span>闪避冷却 ' + (VS.Config.PLAYER.DASH.CD * p.dashCooldownMul).toFixed(2) + ' 秒</span>' +
      (pet ? '<span>宠物 ' + pet + '</span>' : '') + '</div>' +
      '<details class="build-passives"><summary>被动增益 ' + passives.length + ' 项</summary>' +
      '<div class="build-passive-list">' + (passives.join('') || '<span>尚无被动增益</span>') + '</div></details>' +
      (relics ? '<div class="build-line"><span class="build-label">遗物</span>' + relics + '</div>' : '') + evolutionProgress(p);
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
        panelShop: el('panel-shop'),
        shopCoins: el('shopCoins'),
        shopIncome: el('shopIncome'),
        shopRestock: el('shopRestock'),
        shopCards: el('shopCards'),
        shopStatus: el('shopStatus'),
        shopBuild: el('shopBuild'),
        shopCloseBtn: el('shopCloseBtn'),
        shopRefreshBtn: el('shopRefreshBtn'),
        pauseShopBtn: el('pauseShopBtn'),
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
        startWeapon: el('startWeapon'),
        starterDesc: el('starterDesc'),
        arsenalContent: el('arsenalContent'),
        chapterGuide: el('chapterGuide'),

        luLevel: el('luLevel'),
        luTitle: el('luTitle'),
        luSub: el('luSub'),
        luTip: el('luTip'),
        luCards: el('luCards'),
        luBuild: el('luBuild'),
        luQueue: el('luQueue'),

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

      dom.panels = [dom.panelStart, dom.panelShop, dom.panelLevelUp, dom.panelPetSelect,
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
      renderChapters();
      if (dom.startMode) dom.startMode.addEventListener('change', modeInfo);
      bindClick(dom.startBtn, function () { Panels.start(); });
      bindClick(dom.retryBtn, function () { if (cb.onRetry) cb.onRetry(); });
      bindClick(dom.resumeBtn, function () { if (cb.onResume) cb.onResume(); });
      bindClick(dom.pauseRestartBtn, function () { if (cb.onRestart) cb.onRestart(); });
      bindClick(dom.nextLevelBtn, function () { if (cb.onNextLevel) cb.onNextLevel(); });
      bindClick(dom.endEndlessBtn, function () { if (cb.onEndEndless) cb.onEndEndless(); });
      bindClick(dom.goMenuBtn, function () { if (cb.onMenu) cb.onMenu(); });

      bindClick(dom.pauseShopBtn, function () { if (cb.onShop) cb.onShop(); });
      bindClick(dom.shopCloseBtn, function () { if (cb.onShopClose) cb.onShopClose(); });
      bindClick(dom.shopRefreshBtn, function () { if (cb.onShopRefresh) cb.onShopRefresh(); });
      if (dom.shopCards) dom.shopCards.addEventListener('click', function (e) {
        var button = e.target.closest('button[data-shop-action]');
        if (!button || button.disabled) return;
        e.stopPropagation();
        var i = Number(button.dataset.index), token = button.dataset.token;
        if (button.dataset.shopAction === 'buy' && cb.onShopBuy) cb.onShopBuy(i, token);
        if (button.dataset.shopAction === 'lock' && cb.onShopLock) cb.onShopLock(i, token);
      });
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

    /* ---------------- 金币商店 ---------------- */

    showShop: function (game, message) {
      if (!dom || !game.shop) return;
      var stock = game.shop, wasHidden = dom.panelShop.hidden, scroll = dom.panelShop.scrollTop;
      dom.shopCoins.textContent = U.group(stock.coins);
      dom.shopIncome.textContent = '本局获得 ' + U.group(stock.earned) + ' · 已消费 ' + U.group(stock.spent);
      dom.shopRestock.textContent = '下次免费补货：' + Math.max(0, Math.ceil(stock.nextRefreshAt - VS.Game._runTime(game))) + ' 秒战斗时间';
      dom.shopStatus.textContent = message || '可多次购买；金币不足时继续狩猎，锁定想留到下一次的商品。';
      dom.shopCloseBtn.textContent = game.shopReturnState === VS.Game.STATE.PAUSED ? '返回暂停菜单 · B / Esc' : '继续狩猎 · B / Esc';
      var cost = VS.Shop.refreshCost(game);
      dom.shopRefreshBtn.textContent = '刷新货架 · ' + cost + ' 金币';
      dom.shopRefreshBtn.disabled = stock.coins < cost || !VS.Game.upgradePool(game).length || stock.offers.every(function (o) { return o && o.locked; });
      dom.shopBuild.innerHTML = buildSummary(game);
      dom.shopCards.innerHTML = Array.from({ length: 4 }, function (_, i) {
        var offer = stock.offers[i];
        if (!offer) return '<article class="shop-offer empty"><span class="shop-slot">0' + (i + 1) + '</span><h3>暂时无货</h3><p>当前没有可购买的强化。</p></article>';
        var c = offer.choice, inactive = offer.sold || offer.unavailable, short = Math.max(0, offer.price - stock.coins);
        var kind = c.kind === 'weapon-new' ? '新武器' : c.kind === 'weapon-up' ? '武器升级' : c.kind === 'school' ? '流派' : c.kind === 'evolution' ? '武器进化' : c.kind === 'supply' ? '补给' : '被动增益';
        var status = offer.sold ? '已购买' : offer.unavailable ? '当前构筑不可购买' : short > 0 ? '还差 ' + short + ' 金币' : '购买 · ' + offer.price + ' 金币';
        var attrs = ' data-index="' + i + '" data-token="' + offer.token + '"';
        return '<article class="shop-offer' + (offer.locked ? ' locked' : '') + (inactive ? ' inactive' : '') + '" style="--offer-accent:' + (c.color || '#d7bd81') + '">' +
          '<div class="shop-offer-top"><span>' + kind + ' / 0' + (i + 1) + '</span><button type="button" class="shop-lock" data-shop-action="lock"' + attrs +
          ' aria-pressed="' + !!offer.locked + '" aria-label="' + (offer.locked ? '解锁' : '锁定') + c.name + '"' + (inactive ? ' disabled' : '') + '>' + (offer.locked ? '已锁定' : '锁定') + '</button></div>' +
          '<div class="shop-item-name"><span aria-hidden="true">' + c.icon + '</span><h3>' + c.name + '</h3></div>' +
          '<p class="shop-tag">' + c.tag + '</p>' + (c.currentDesc ? '<p class="shop-current">当前 · ' + c.currentDesc + '</p>' : '') +
          '<p class="shop-desc">' + (c.currentDesc ? '购买后 · ' : '') + c.desc + '</p>' +
          '<div class="shop-price">' + offer.price + '<small>金币' + (offer.locked ? ' · 已保价' : '') + '</small></div>' +
          '<button type="button" class="shop-buy" data-shop-action="buy"' + attrs + (inactive || short > 0 ? ' disabled' : '') + '>' + status + '</button></article>';
      }).join('');
      show(dom.panelShop);
      dom.panelShop.scrollTop = wasHidden ? 0 : scroll;
      if (wasHidden) dom.shopCloseBtn.focus({ preventScroll: true });
    },

    /* ---------------- 遗物祭坛 ---------------- */

    showRelic: function (choices, game) {
      if (!dom) return;
      currentChoices = choices || [];
      if (dom.luTitle) dom.luTitle.textContent = '遗物祭坛';
      if (dom.luSub) dom.luSub.textContent = '选择一件遗物，本局只可获得一次；留意它的代价';
      if (dom.luLevel) dom.luLevel.textContent = '';
      if (dom.luQueue) dom.luQueue.textContent = '额外选择 · 不消耗金币';
      if (dom.luTip) dom.luTip.innerHTML = '点击卡片，或按 <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> · 遗物保留到本局结束';

      if (dom.luBuild) dom.luBuild.innerHTML = buildSummary(game);

      var html = '';
      for (var i = 0; i < currentChoices.length; i++) {
        var c = currentChoices[i];
        // 卡片主色：新武器=青，武器升级=金，增益=紫，流派=跟着武器自身配色
        var accent = c.color || (c.kind === 'buff' ? '#b58cff' : '#7ee0ff');

        var kind = c.kind === 'relic' ? '遗物' : c.kind === 'evolution' ? '武器进化' : c.kind === 'weapon-new' ? '新武器' : c.kind === 'weapon-up' ? '武器升级' : c.kind === 'school' ? '流派' : '被动';
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

    hideRelic: function () {
      if (!dom) return;
      dom.panelLevelUp.hidden = true;
      currentChoices = [];
      syncOverlay();
    },

    /* ---------------- 宠物三选一面板 ----------------
       打完第一只 Boss 才出现，三选一，选完永久生效。 */

    showPetSelect: function (pets, levelIndex) {
      if (!dom) return;
      currentPets = pets || [];
      if (dom.petSelectSub) dom.petSelectSub.textContent = '击杀首领的奖励 · 等级 +1 与金币 · 宠物随本局跨关保留';

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
