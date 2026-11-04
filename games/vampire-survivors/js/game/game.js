/* ===========================================================
   游戏主控：状态机 + 每帧调度 + 金币商店 + 关卡推进 + 结算
   状态：menu / playing / shop / petselect / levelclear / paused / gameover
   调度顺序：玩家 → 宠物 → 怪物 → 武器 → 拾取 → 特效 → 摄像机 → 判定

   关卡：一次"跑图"由若干关组成（C.LEVELS）。本关时间到 → levelclear 面板 →
   下一关（保留构筑与宠物，回满血、重置本关时间与怪物）；最后一关打完 = 通关。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  var STATE = {
    MENU: 'menu',
    PLAYING: 'playing',
    SHOP: 'shop',
    RELICSELECT: 'relicselect',
    PETSELECT: 'petselect',
    LEVELCLEAR: 'levelclear',
    PAUSED: 'paused',
    GAMEOVER: 'gameover'
  };

  /** 一局的总时长 = 已打完的关卡 + 本关已经过的时间 */
  function runTime(game) {
    return (game.totalTime || 0) + game.time;
  }

  function viewW(game) {
    var r = game.deps && game.deps.renderer;
    if (r && r.w) return r.w;
    return (typeof window !== 'undefined' && window.innerWidth) || 1280;
  }

  function viewH(game) {
    var r = game.deps && game.deps.renderer;
    if (r && r.h) return r.h;
    return (typeof window !== 'undefined' && window.innerHeight) || 720;
  }

  function findUpgrade(id) {
    for (var i = 0; i < C.UPGRADES.length; i++) {
      if (C.UPGRADES[i].id === id) return C.UPGRADES[i];
    }
    return null;
  }

  /** 商店使用的合法强化池：武器、被动、流派和满足配方的进化。 */
  function upgradePool(game) {
    var p = game.player;
    var pool = [];
    var weights = [];
    var i;
    var lvIndex = game.level || 0;
    var gate = function (def) { return VS.Levels ? VS.Levels.allows(lvIndex, def) : true; };

    /* --- 武器升级 --- */
    for (i = 0; i < p.weapons.length; i++) {
      var w = p.weapons[i];
      var wdef = C.WEAPONS[w.id];
      if (!wdef) continue;
      if (w.level >= wdef.maxLevel) continue;

      pool.push({
        kind: 'weapon-up',
        id: w.id,
        name: wdef.name,
        icon: wdef.icon,
        color: wdef.color,
        desc: wdef.describe(w.level + 1),
        currentDesc: wdef.describe(w.level),
        tag: 'Lv ' + w.level + ' → ' + (w.level + 1),
        maxLevel: wdef.maxLevel
      });
      weights.push(12);
    }

    for (i = 0; i < p.weapons.length; i++) {
      var status = VS.Weapons.evolutionStatus(p, p.weapons[i].id);
      if (!status || !status.ready) continue;
      pool.push({
        kind: 'evolution', id: p.weapons[i].id,
        name: status.def.name, icon: status.def.icon, color: status.def.color,
        desc: status.def.desc, tag: '武器进化 · 保留流派', isEvolution: true
      });
      weights.push(30);
    }

    /* --- 新武器 --- */
    if (p.weapons.length < C.MAX_WEAPONS) {
      for (i = 0; i < C.NEW_WEAPON_POOL.length; i++) {
        var nid = C.NEW_WEAPON_POOL[i];
        if (VS.Weapons.has(p, nid)) continue;
        var ndef = C.WEAPONS[nid];
        if (!gate(ndef)) continue;

        pool.push({
          kind: 'weapon-new',
          id: nid,
          name: ndef.name,
          icon: ndef.icon,
          color: ndef.color,
          desc: ndef.desc + '<br>' + ndef.describe(1),
          tag: '新武器',
          maxLevel: ndef.maxLevel,
          isNew: true
        });
        weights.push(13);
      }
    }

    /* --- 增益 --- */
    for (i = 0; i < C.UPGRADES.length; i++) {
      var up = C.UPGRADES[i];
      if (!gate(up)) continue;
      var lv = VS.Player.upgradeLevel(p, up.id);
      if (lv >= up.max) continue;

      pool.push({
        kind: 'buff',
        id: up.id,
        name: up.name,
        icon: up.icon,
        color: '#b58cff',
        desc: up.desc,
        tag: lv > 0 ? ('Lv ' + lv + ' → ' + (lv + 1)) : '新增益',
        maxLevel: up.max
      });
      weights.push(up.weight);
    }

    /* --- 流派增益（2026-09-23 新增） ---
       已经拥有的武器各自带一张"流派"卡，思路是**缺什么补什么**：
       腐化光环补吸血+范围、环绕骨刃补刃数+转速……（定义在 C.WEAPONS[x].school） */
    for (i = 0; i < p.weapons.length; i++) {
      var w2 = p.weapons[i];
      var wdef2 = C.WEAPONS[w2.id];
      if (wdef2 && wdef2.schools) {
        for (var branch = 0; branch < wdef2.schools.length; branch++) {
          var schoolId = wdef2.schools[branch];
          if (w2.schoolId && w2.schoolId !== schoolId) continue;
          var school = C.SCHOOLS[schoolId];
          var rank = w2.schoolId === schoolId ? (w2.schoolRank || 0) : 0;
          if (!school || rank >= school.max) continue;
          pool.push({ kind: 'school', id: w2.id, schoolId: schoolId,
            name: school.name, icon: school.icon, color: school.color,
            desc: school.short + '<br><span class="school-note">' + wdef2.name + ' · 三选一分支，本局选定后保留</span>',
            tag: rank ? '流派 Lv ' + rank + ' → ' + (rank + 1) : '选择流派分支', maxLevel: school.max, isSchool: true });
          weights.push(school.weight || 9);
        }
        continue;
      }
      if (!wdef2 || !wdef2.school) continue;

      var stacks = w2.school || 0;
      if (stacks >= wdef2.school.max) continue;

      pool.push({
        kind: 'school',
        id: w2.id,
        name: wdef2.school.name,
        icon: wdef2.school.icon,
        color: wdef2.school.color,
        desc: wdef2.school.short + '<br><span class="school-note">' +
              wdef2.name + ' 的流派增益</span>',
        tag: stacks > 0 ? ('流派 Lv ' + stacks + ' → ' + (stacks + 1)) : '流派增益',
        maxLevel: wdef2.school.max,
        isSchool: true
      });
      weights.push(11);
    }

    if (pool.length < 4) {
      [
        { id: 'heal', name: '战场补给', icon: '✚', desc: '立即回复最大生命的 30%' },
        { id: 'power', name: '无尽战意', icon: '⚔', desc: '全武器伤害 +2%（最高 ×1000000）' },
        { id: 'guard', name: '百战护甲', icon: '⛨', desc: '护甲 +0.5（最高 500）' }
      ].forEach(function (supply) {
        if (supply.id === 'heal' && p.hp >= p.maxHp) return;
        if (supply.id !== 'heal' && game.mode !== 'endless') return;
        if (supply.id === 'power' && p.damageMul >= 1000000 || supply.id === 'guard' && p.armor >= 500) return;
        pool.push({ kind: 'supply', id: supply.id, name: supply.name, icon: supply.icon,
          color: '#dfc58e', desc: supply.desc, tag: '无尽补给' }); weights.push(8);
      });
    }

    return pool.map(function (choice, i) { choice.weight = weights[i]; return choice; });
  }

  function rewardLevels(game, count) {
    if (count <= 0) return;
    var coins = VS.Shop.levelReward(game, count);
    if (game.fx) VS.Effects.text(game.fx, game.player.x, game.player.y - 28,
      '等级 +' + count + ' · +' + coins + ' 金币', '#ffd166', { life: 1.1, size: 15 });
  }

  function applyChoice(game, c) {
    if (!c || !upgradePool(game).some(function (item) {
      return item.kind === c.kind && item.id === c.id && (item.schoolId || '') === (c.schoolId || '');
    })) return false;
    var p = game.player;

    if (c.kind === 'supply') {
      if (c.id === 'heal') VS.Player.heal(p, p.maxHp * 0.3, game);
      if (c.id === 'power') p.damageMul = Math.min(1000000, p.damageMul * 1.02);
      if (c.id === 'guard') p.armor = Math.min(500, p.armor + 0.5);
    } else if (c.kind === 'evolution') {
      return VS.Weapons.evolve(p, c.id);
    } else if (c.kind === 'weapon-up') {
      VS.Weapons.upgrade(p, c.id);
    } else if (c.kind === 'weapon-new') {
      VS.Weapons.add(p, c.id);
    } else if (c.kind === 'school') {
      if (c.schoolId) return VS.Weapons.chooseSchool(p, c.id, c.schoolId);
      /* 流派增益：层数记在武器上，具体效果由武器自己的 school.apply 决定 */
      var wdef = C.WEAPONS[c.id];
      var w = VS.Weapons.get(p, c.id);
      if (wdef && wdef.school && w) {
        w.school = (w.school || 0) + 1;
        wdef.school.apply(p, w, game);
      }
    } else {
      var up = findUpgrade(c.id);
      if (up) VS.Player.applyUpgrade(p, up);
    }
    return true;
  }

  var Game = {

    STATE: STATE,
    current: null,

    create: function (deps) {
      deps = deps || {};

      var game = {
        state: STATE.MENU,
        mode: 'campaign',
        endlessWave: 1,
        time: 0,
        totalTime: 0,          // 已经打完的关卡时长之和（结算/排行用 runTime()）
        level: 0,              // 当前关卡下标（0 起）
        levelDef: null,
        victory: false,        // 通关（而不是被打死）
        kills: 0,
        shake: 0,
        textBudget: 14,
        sparkBudget: 8,
        shop: null,
        animTime: 0,
        deps: deps,
        data: deps.data || VS.Save.load(),
        world: null,
        fx: null,
        weapons: null,
        enemies: null,
        pickups: null,
        pets: null,
        player: null,
        startWeapon: C.PLAYER.START_WEAPON,
        pendingPetSelect: false,
        petChoices: [],
        orbitMode: 0,          // 环绕骨刃的形态下标（E 键切换，见 C.ORBIT_MODES）
        failedClear: false,    // 时间到但没打死最终 Boss
        failReason: ''
      };

      /* 吃到经验石时由拾取模块回调到这里 */
      game.onXp = function (amount) {
        var levels = VS.Player.gainXp(game.player, amount);
        rewardLevels(game, levels);
      };

      /* 超级经验球：不加经验，等级直接 +1 并领取金币奖励。 */
      game.onInstantLevel = function () {
        if (VS.Player.grantLevel(game.player)) {
          rewardLevels(game, 1);
        }
      };

      /* 击杀第一只 Boss 的奖励：等级 +1 + 解锁宠物三选一 */
      game.onFirstBossReward = function () {
        if (VS.Player.grantLevel(game.player)) {
          rewardLevels(game, 1);
        }
        VS.Shop.earn(game, 100 + game.level * 50);
        game.pendingPetSelect = !VS.Pets.chosen(game.pets);

        /* 这里**故意不弹横幅**：横幅和紧接着出现的宠物面板会叠在一起（实测挡标题），
           奖励信息已经写在面板副标题里（「击杀尸潮之王的奖励 · 等级 +1」）。 */
      };

      /* 第二关起的 Boss 奖励：等级 +1（宠物已经在第一关选过了） */
      game.onBossReward = function () {
        VS.Shop.earn(game, 100 + game.level * 50);
        if (VS.Player.grantLevel(game.player)) {
          rewardLevels(game, 1);
          if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
            game.deps.panels.showBanner('击 杀 奖 励', '等级 +1 · 金币 +' + (112 + game.level * 50));
          }
        }
      };

      Game.newRun(game);
      return game;
    },

    /** 重置一整局（不改变 state，由调用方决定） */
    newRun: function (game, opt) {
      opt = opt || {};
      game.runSerial = (game.runSerial || 0) + 1;
      game.cheated = false;
      game.relics = [];
      game.relicChoices = [];
      if (opt.mode === 'campaign' || opt.mode === 'endless') game.mode = opt.mode;
      if (C.START_WEAPONS.indexOf(opt.startWeapon) >= 0) game.startWeapon = opt.startWeapon;
      game.time = 0;
      game.totalTime = 0;
      game.level = 0;
      game.victory = false;
      game.kills = 0;
      game.shake = 0;
      game.animTime = 0;
      game.endlessWave = 1;
      game.shop = VS.Shop.create();

      game.world = VS.World.create();
      game.fx = VS.Effects.create();
      game.weapons = VS.Weapons.create();
      game.enemies = VS.Enemies.create();
      game.encounters = VS.Encounters ? VS.Encounters.create() : null;
      game.pickups = VS.Pickups.create();
      game.pets = VS.Pets.create();
      game.player = VS.Player.create(game.world);
      game.player.endless = game.mode === 'endless';
      if (VS.Stages) VS.Stages.enter(game);

      game.pendingPetSelect = false;
      game.petChoices = [];

      /* 主角皮肤：从存档取（换皮肤在开始面板，走 VS.Save.setSkin）。
         取不到就给默认值，渲染层还会再兜一次底。 */
      game.playerSkin = (game.data && game.data.playerSkin) || 'witch';
      game.levelDef = VS.Levels.def(0);

      VS.Weapons.add(game.player, game.startWeapon || C.PLAYER.START_WEAPON);
      VS.Shop.enter(game);

      VS.World.snapCamera(game.world, game.player.x, game.player.y, viewW(game), viewH(game));

      game.phase = VS.Phases.at(0).id;

      return game;
    },

    /** 换关保留等级、构筑、宠物、遗物和金币；重置场上实体、位置与本关时间并回满血。 */
    startLevel: function (game, index, opt) {
      opt = opt || {};

      game.level = index;
      game.levelDef = VS.Levels.def(index);
      game.time = 0;
      game.phase = VS.Phases.at(0).id;

      game.enemies = VS.Enemies.create();
      game.encounters = VS.Encounters ? VS.Encounters.create() : null;
      game.pickups = VS.Pickups.create();
      game.weapons = VS.Weapons.create();
      game.fx = VS.Effects.create();

      VS.Shop.enter(game);

      /* 玩家：位置回地图中心，回满血，给一小段无敌（免得一进来就被贴脸） */
      var p = game.player;
      p.x = game.world.w / 2;
      p.y = game.world.h / 2;
      p.vx = 0;
      p.vy = 0;
      p.hp = p.maxHp;
      p.invuln = opt.invuln === undefined ? 3 : opt.invuln;
      p.alive = true;
      if (VS.Stages) VS.Stages.enter(game);

      VS.World.snapCamera(game.world, p.x, p.y, viewW(game), viewH(game));

      if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
        game.deps.panels.showBanner(VS.Levels.label(index), '本关时长 ' +
          U.formatTime(game.levelDef.duration) + (VS.Levels.clearRule(index) === 'killFinalBoss' ? ' · 击败章节首领' : ' · 撑住'));
      }
      if (game.deps && game.deps.audio) game.deps.audio.play('level');

      return game;
    },

    /** 阶段切换时的播报（横幅 + 音效） */
    announcePhase: function (game, ph) {
      if (!ph || !ph.tip) return;

      if (game.deps.audio) game.deps.audio.play('level');
      if (game.deps.panels && game.deps.panels.showBanner) {
        game.deps.panels.showBanner(ph.tip, ph.sub);
      }
    },

    /** 开局 */
    start: function (game, opt) {
      Game.newRun(game, opt);
      game.state = STATE.PLAYING;

      if (game.deps.audio) game.deps.audio.unlock();
      if (game.deps.panels) game.deps.panels.hideAll();
      if (game.deps.hud) {
        game.deps.hud.show();
        game.deps.hud.update(game);
      }
      if (game.deps.audio) game.deps.audio.play('click');
    },

    /** 摄像机跟随（开局立即就位） */
    snapCamera: function (game) {
      VS.World.snapCamera(game.world, game.player.x, game.player.y, viewW(game), viewH(game));
    },

    /* ---------------- 每帧推进（固定步长） ---------------- */

    step: function (game, dt) {
      if (game.state !== STATE.PLAYING) return;

      var prevTime = game.time;
      game.time += dt;

      /* --- 阶段推进：跨过时间点就播报一次 --- */
      if (game.mode === 'endless') {
        var wave = Math.floor(game.time / C.ENDLESS.WAVE_SECONDS) + 1;
        if (wave !== game.endlessWave) {
          game.endlessWave = wave;
          if (game.deps.panels) game.deps.panels.showBanner('无 尽 · 第 ' + wave + ' 波', '敌人继续强化 · 随时按 B 购买强化');
        }
        var biome = VS.Stages ? VS.Stages.endlessIndex(game.time) : game.time >= C.ENDLESS.BIOME_AT ? Math.min(1, VS.Levels.count() - 1) : 0;
        if (biome !== game.level) {
          game.level = biome;
          game.levelDef = VS.Levels.def(game.level);
          VS.Shop.enter(game);
          if (VS.Stages) VS.Stages.enter(game);
          if (game.deps.panels) game.deps.panels.showBanner(game.levelDef.subtitle, '无尽场景轮换 · 保留构筑、宠物与遗物');
        }
      } else {
        var entered = VS.Phases.crossed(prevTime, game.time);
        if (entered && game.level < 2 && !(entered.id === 'rest' && VS.Levels.noRest(game.level))) {
          game.phase = entered.id;
          Game.announcePhase(game, entered);
        }
      }

      /* --- 金色经验球解锁（存活满 3 分钟）：单独播报一次 --- */
      if (prevTime < C.DROP.GOLD_ORB_FROM && game.time >= C.DROP.GOLD_ORB_FROM) {
        if (game.deps.audio) game.deps.audio.play('level');
        if (game.deps.panels && game.deps.panels.showBanner) {
          game.deps.panels.showBanner('金 色 经 验 球 解 锁', '3 分钟后开始掉落 · 一颗顶 100 颗');
        }
      }

      /* --- 超级经验球解锁（存活满 10 分钟）--- */
      if (prevTime < C.DROP.SUPER_ORB_FROM && game.time >= C.DROP.SUPER_ORB_FROM) {
        if (game.deps.audio) game.deps.audio.play('level');
        if (game.deps.panels && game.deps.panels.showBanner) {
          game.deps.panels.showBanner('超 级 经 验 球', '0.3% 概率掉落 · 拾取直接升一级');
        }
      }

      VS.Shop.update(game);

      var input = game.deps.input || VS.Input;
      var axis = input && input.getAxis ? input.getAxis() : { x: 0, y: 0 };

      VS.Effects.beginFrame(game.fx);
      game.textBudget = 14;
      game.sparkBudget = 8;

      /* --- 逻辑推进 --- */
      if (VS.Stages) VS.Stages.update(game, dt);
      VS.Player.update(game.player, dt, game.world, axis);
      VS.Pets.update(game.pets, dt, game);
      VS.Enemies.update(game.enemies, dt, game);
      if (VS.Encounters) VS.Encounters.update(game.encounters, dt, game);
      VS.Weapons.update(game.weapons, dt, game);
      VS.Pickups.update(game.pickups, dt, game);
      VS.Effects.update(game.fx, dt);

      /* --- 摄像机 --- */
      var leadX = game.player.moving ? game.player.facing.x * game.player.speed : 0;
      var leadY = game.player.moving ? game.player.facing.y * game.player.speed : 0;
      VS.World.updateCamera(game.world, game.player.x, game.player.y,
                            viewW(game), viewH(game), dt, leadX, leadY);

      /* --- 屏幕震动衰减 --- */
      if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 26);

      /* --- 判定：死亡（先让宠物尝试救一次）→ 本关时间到 → 升级 → 选宠物 --- */
      if (!game.player.alive) {
        if (!VS.Pets.tryRevive(game)) {
          Game.endRun(game);
          return;
        }
      }
      if (game.mode !== 'endless' && game.time >= game.levelDef.duration) {
        Game.clearLevel(game);
        return;
      }
      if (game.pendingPetSelect && !VS.Pets.chosen(game.pets)) {
        Game.openPetSelect(game);
      }
      if (VS.Stages) VS.Stages.openRelic(game);
    },

    /* ---------------- 环绕骨刃：E 键切换范围 ----------------
       只有拥有环绕骨刃时才生效；切换后立刻给一次反馈（横幅 + 音效 + 特效）。
       半径与转速的换算在 Weapons.statsFor 里，游戏状态只存一个下标（game.orbitMode）。 */

    toggleOrbitRange: function (game) {
      var p = game.player;
      if (game.state !== STATE.PLAYING || !p || !VS.Weapons.has(p, 'orbit')) return false;

      var list = C.ORBIT_MODES || [];
      if (list.length < 2) return false;

      game.orbitMode = ((game.orbitMode || 0) + 1) % list.length;
      var mode = list[game.orbitMode];

      if (game.deps.audio) game.deps.audio.play('click');
      VS.Effects.burst(game.fx, p.x, p.y, '#ffd166', 14, { speed: 190, life: 0.5, size: 3 });
      if (game.deps.panels && game.deps.panels.showBanner) {
        game.deps.panels.showBanner('环绕骨刃 · ' + mode.name, mode.tip);
      }
      if (game.deps.hud) game.deps.hud.update(game);
      return true;
    },

    /* ---------------- 关卡推进 ---------------- */

    /** 练习码等明确奖励只增加等级与金币，不产生免费选卡。 */
    grantLevels: function (game, count) {
      var n = Number.isFinite(count) ? Math.max(0, Math.min(10000, Math.floor(count))) : 0, granted = 0;
      for (var i = 0; i < n; i++) if (VS.Player.grantLevel(game.player)) granted++;
      rewardLevels(game, granted);
      return granted;
    },

    /** 本关时间到：符合通关条件就弹过关面板，否则判负（最后一关则是通关结算） */
    clearLevel: function (game) {
      if (game.mode === 'endless') return false;
      game.time = game.levelDef.duration;

      /* 通关条件：某些关要求"最终 Boss 必须被打死"（C.LEVELS[i].clearRule）。
         15:00 时它还活着 → 这一局无法通关，直接按失败结算。 */
      var need = VS.Levels.requiredBosses(game.level).length;
      var got = game.enemies.requiredKilled || 0;
      if (VS.Levels.clearRule(game.level) === 'killFinalBoss' && got < need) {
        var boss = game.enemies.boss;
        Game.endRun(game, {
          failedClear: true,
          reason: boss && !boss.dead
            ? ('时间到 · 「' + (boss.name || '最终 Boss') + '」还活着，无法通关')
            : '时间到 · 没能击杀最终 Boss，无法通关'
        });
        return;
      }

      game.state = STATE.LEVELCLEAR;

      /* 注意：这里**不要**把本关时长并进 totalTime —— 此刻 game.time 还是本关时长，
         runTime() = totalTime + time 会把它算两遍（面板上会显示成 30:00）。
         并账放在 nextLevel()：真正离开这一关的时候再加。 */

      var last = VS.Levels.isLast(game.level);

      /* 面板一出来就把横幅收掉：横幅是浮层，会和面板标题叠在一起 */
      if (game.deps.panels && game.deps.panels.hideBanner) game.deps.panels.hideBanner();

      if (game.deps.audio) game.deps.audio.play('level');
      if (game.deps.hud) game.deps.hud.update(game);

      if (game.deps.panels && game.deps.panels.showLevelClear) {
        game.deps.panels.showLevelClear({
          level: game.level,
          label: VS.Levels.label(game.level),
          last: last,
          time: game.levelDef.duration,
          total: runTime(game),
          kills: game.player.kills,
          playerLevel: game.player.level,
          pet: VS.Pets.statusText(game.pets),
          nextLabel: last ? '' : VS.Levels.label(game.level + 1),
          nextFresh: last ? false : VS.Levels.isFresh(game.level + 1)
        });
      } else {
        /* 没有面板就兜底：直接进下一关 / 直接结算，别卡死 */
        Game.nextLevel(game);
      }
    },

    /** 过关面板上点「继续」：进下一关，或（最后一关）通关结算 */
    nextLevel: function (game) {
      if (game.state !== STATE.LEVELCLEAR) return false;

      if (game.deps.panels && game.deps.panels.hideLevelClear) {
        game.deps.panels.hideLevelClear();
      }

      /* 离开本关：把它的时长并进总时长（runTime() 用的是 totalTime + 本关时间）。
         之后必须把本关时间清零 —— 否则通关结算时会再算一遍（面板上会变成 39:00 而不是 27:00）。 */
      game.totalTime += game.levelDef.duration;
      game.time = 0;

      if (VS.Levels.isLast(game.level)) {
        Game.endRun(game, { victory: true });
        return true;
      }

      Game.startLevel(game, game.level + 1);
      game.state = STATE.PLAYING;
      if (game.deps.hud) game.deps.hud.update(game);
      return true;
    },

    /* ---------------- 随时暂停的金币商店 ---------------- */

    openShop: function (game) {
      if ([STATE.PLAYING, STATE.PAUSED].indexOf(game.state) < 0) return false;
      game.shopReturnState = game.state;
      game.state = STATE.SHOP;
      if (VS.Input && VS.Input.reset) VS.Input.reset();
      VS.Shop.sync(game);
      if (game.deps.panels) { game.deps.panels.hideBanner(); game.deps.panels.showShop(game); }
      if (game.deps.hud) game.deps.hud.update(game);
      return true;
    },

    closeShop: function (game) {
      if (game.state !== STATE.SHOP) return false;
      if (VS.Input && VS.Input.reset) VS.Input.reset();
      if (game.deps.panels) game.deps.panels.hideAll();
      game.state = STATE.PLAYING;
      if (game.shopReturnState === STATE.PAUSED) Game.pause(game);
      return true;
    },

    toggleShop: function (game) {
      return game.state === STATE.SHOP ? Game.closeShop(game) : Game.openShop(game);
    },

    buyShop: function (game, index, token) {
      if (!VS.Shop.buy(game, index, token)) return false;
      if (game.deps.panels) game.deps.panels.showShop(game, '购买成功 · 强化已生效');
      if (game.deps.hud) game.deps.hud.update(game);
      return true;
    },

    refreshShop: function (game) {
      if (game.state !== STATE.SHOP || !VS.Shop.refresh(game, true)) return false;
      if (game.deps.panels) game.deps.panels.showShop(game, '货架已刷新 · 锁定商品保留');
      if (game.deps.hud) game.deps.hud.update(game);
      return true;
    },

    lockShop: function (game, index, token) {
      if (!VS.Shop.toggleLock(game, index, token)) return false;
      if (game.deps.panels) game.deps.panels.showShop(game);
      return true;
    },

    choose: function (game, index) {
      if (game.state === STATE.RELICSELECT && VS.Stages) return VS.Stages.chooseRelic(game, index);
      if (game.state === STATE.PETSELECT) return Game.choosePet(game, index);
      var offer = game.shop && game.shop.offers[index];
      if (game.state === STATE.SHOP && offer) return Game.buyShop(game, index, offer.token);
      return false;
    },

    /* ---------------- 宠物三选一 ---------------- */

    openPetSelect: function (game) {
      if (!game.pets || game.pets.id) {
        game.pendingPetSelect = false;
        return;
      }

      game.state = STATE.PETSELECT;
      game.petChoices = VS.Pets.list(game.level);   // 宠物也按关卡过滤（柠檬猪只有第二关有）

      if (game.deps.audio) game.deps.audio.play('level');
      if (game.deps.hud) game.deps.hud.update(game);

      if (game.deps.panels && game.deps.panels.showPetSelect) {
        game.deps.panels.showPetSelect(game.petChoices, game.level);
      } else {
        /* 没有面板时兜底：直接选第一个，避免卡死 */
        Game.choosePet(game, 0);
      }
    },

    choosePet: function (game, index) {
      if (game.state !== STATE.PETSELECT) return false;

      var d = (game.petChoices || [])[index];
      if (!d) return false;

      if (!VS.Pets.choose(game.pets, d.id, game)) return false;

      game.pendingPetSelect = false;

      if (game.deps.panels && game.deps.panels.hidePetSelect) {
        game.deps.panels.hidePetSelect();
      }

      game.state = STATE.PLAYING;
      VS.Effects.beginFrame(game.fx);
      return true;
    },

    /* ---------------- 暂停 ---------------- */

    pause: function (game) {
      if (game.state !== STATE.PLAYING) return false;
      game.state = STATE.PAUSED;
      if (game.deps.panels) {
        game.deps.panels.showPause(
          '存活 ' + U.formatTime(game.time) +
          ' · 击杀 ' + game.player.kills +
          ' · 等级 ' + game.player.level, game
        );
      }
      return true;
    },

    resume: function (game) {
      if (game.state !== STATE.PAUSED) return false;
      game.state = STATE.PLAYING;
      if (game.deps.panels) game.deps.panels.hideAll();
      return true;
    },

    togglePause: function (game) {
      if (game.state === STATE.SHOP) return Game.closeShop(game);
      if (game.state === STATE.PLAYING) return Game.pause(game);
      if (game.state === STATE.PAUSED) return Game.resume(game);
      return false;
    },

    /* ---------------- 结算 ---------------- */

    endRun: function (game, opt) {
      opt = opt || {};
      if (game.state === STATE.GAMEOVER) return false;
      game.state = STATE.GAMEOVER;
      game.victory = !!opt.victory;
      game.failedClear = !!opt.failedClear;      // 时间到但没打死最终 Boss
      game.failReason = opt.reason || '';
      if (game.cheated) game.failReason += (game.failReason ? ' · ' : '') + '作弊练习局 · 不提交全站排行榜';

      /* 一局的总时长：打完的关卡 + 本关已经过的时间。
         第一关就死了的话就等于第一关的时间，和以前的口径一致。 */
      var total = runTime(game);
      var wave = game.mode === 'endless' ? game.endlessWave : VS.Enemies.waveFor(game.time);
      var p = game.player;

      var isNewBest = VS.Save.submit({
        time: total,
        kills: p.kills,
        level: p.level,
        wave: wave,
        stage: game.level + 1
      }, game.data, game.mode);

      /* 两种模式分别保存本机个人纪录。 */
      var rankInfo = null;
      if (VS.Scores) {
        rankInfo = VS.Scores.add({ time: total, kills: p.kills, level: p.level, wave: wave, stage: game.level + 1, mode: game.mode });
        if (VS.ScoresUI) VS.ScoresUI.refresh(game.mode);
      }

      if (game.deps.audio) game.deps.audio.play(game.victory ? 'level' : 'over');
      if (game.deps.panels && game.deps.panels.hideBanner) game.deps.panels.hideBanner();

      /* 死亡爆散 */
      game.shake = 13;
      VS.Effects.burst(game.fx, p.x, p.y, '#e6dcff', 44, { speed: 280, life: 0.95, size: 4 });
      VS.Effects.burst(game.fx, p.x, p.y, '#b58cff', 26, { speed: 180, life: 1.2, size: 5 });

      if (game.deps.hud) game.deps.hud.hide();
      if (game.deps.panels) {
        game.deps.panels.showGameOver({
          time: total,
          best: VS.Save.profile(game.data, game.mode).bestTime,
          kills: p.kills,
          level: p.level,
          wave: wave,
          stage: game.level + 1,
          stageLabel: game.mode === 'endless' ? '无尽 · 第 ' + game.endlessWave + ' 波' : VS.Levels.label(game.level),
          mode: game.mode,
          victory: game.victory,
          failedClear: game.failedClear,
          reason: game.failReason,
          isNewBest: isNewBest
        });
      }
      if (VS.ScoresUI) VS.ScoresUI.showRank(rankInfo);   // 本局排名（没进前 5 就自己藏起来）

      if (VS.LeaderboardUI && VS.LeaderboardUI.showRank) VS.LeaderboardUI.showRank(null);
      if (!game.cheated && game.mode !== 'endless' && VS.Leaderboard && VS.LeaderboardUI && VS.Leaderboard.canSubmit()) {
        VS.LeaderboardUI.submitRun({ time: total, kills: p.kills, level: p.level, wave: wave, mode: game.mode });
      }
    },

    /** 回到主菜单（当前 UI 用不到，留给扩展） */
    toMenu: function (game) {
      Game.newRun(game);
      game.state = STATE.MENU;
      if (game.deps.hud) game.deps.hud.hide();
      if (game.deps.panels) game.deps.panels.showStart(game.data.bestTime);
    },

    /* 供测试/调试使用的内部函数 */
    upgradePool: upgradePool,
    _applyChoice: applyChoice,
    _runTime: runTime
  };

  VS.register('Game', Game);

})(window.VS = window.VS || {});
