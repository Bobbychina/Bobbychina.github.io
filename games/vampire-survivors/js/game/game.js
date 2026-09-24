/* ===========================================================
   游戏主控：状态机 + 每帧调度 + 升级选卡 + 关卡推进 + 结算
   状态：menu / playing / levelup / petselect / levelclear / paused / gameover
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
    LEVELUP: 'levelup',
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

  /**
   * 生成三张升级卡：
   *  - 已拥有且未满级的武器（可升级）
   *  - 尚未拥有且武器栏没满的新武器
   *  - 各类增益（未达叠加上限）
   * 按权重不重复抽取 3 个
   *
   * 关卡还能把关卡专属的东西挡在外面：`onlyFromLevel: 1` 的武器/增益
   * （柠檬喷射器 / 雷击链 / 酸液抗性 / 嗜血）只在第二关及以后进池子。
   */
  function buildChoices(game) {
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
        tag: 'Lv ' + w.level + ' → ' + (w.level + 1)
      });
      weights.push(12);
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
        tag: lv > 0 ? ('Lv ' + lv + ' → ' + (lv + 1)) : '新增益'
      });
      weights.push(up.weight);
    }

    /* --- 流派增益（2026-09-23 新增） ---
       已经拥有的武器各自带一张"流派"卡，思路是**缺什么补什么**：
       腐化光环补吸血+范围、环绕骨刃补刃数+转速……（定义在 C.WEAPONS[x].school） */
    for (i = 0; i < p.weapons.length; i++) {
      var w2 = p.weapons[i];
      var wdef2 = C.WEAPONS[w2.id];
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
        isSchool: true
      });
      weights.push(11);
    }

    var out = [];
    var guard = 0;
    while (out.length < 3 && pool.length > 0 && guard++ < 50) {
      var idx = U.weightedIndex(weights);
      out.push(pool[idx]);
      pool.splice(idx, 1);
      weights.splice(idx, 1);
    }

    return out;
  }

  function applyChoice(game, c) {
    var p = game.player;

    if (c.kind === 'weapon-up') {
      VS.Weapons.upgrade(p, c.id);
    } else if (c.kind === 'weapon-new') {
      VS.Weapons.add(p, c.id);
    } else if (c.kind === 'school') {
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
  }

  var Game = {

    STATE: STATE,
    current: null,

    create: function (deps) {
      deps = deps || {};

      var game = {
        state: STATE.MENU,
        time: 0,
        totalTime: 0,          // 已经打完的关卡时长之和（结算/排行用 runTime()）
        level: 0,              // 当前关卡下标（0 起）
        levelDef: null,
        victory: false,        // 通关（而不是被打死）
        kills: 0,
        shake: 0,
        textBudget: 14,
        sparkBudget: 8,
        pendingLevels: 0,
        choices: [],
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
        pendingPetSelect: false,
        petChoices: [],
        draftCards: 0,         // 跳关预览时"还要自己选几张卡"
        orbitMode: 0,          // 环绕骨刃的形态下标（E 键切换，见 C.ORBIT_MODES）
        failedClear: false,    // 时间到但没打死最终 Boss
        failReason: ''
      };

      /* 吃到经验石时由拾取模块回调到这里 */
      game.onXp = function (amount) {
        var levels = VS.Player.gainXp(game.player, amount);
        if (levels > 0) game.pendingLevels += levels;
      };

      /* 超级经验球：不加经验，等级直接 +1（同样要给一次选卡机会） */
      game.onInstantLevel = function () {
        if (VS.Player.grantLevel(game.player)) {
          game.pendingLevels += 1;
        }
      };

      /* 击杀第一只 Boss 的奖励：等级 +1 + 解锁宠物三选一 */
      game.onFirstBossReward = function () {
        if (VS.Player.grantLevel(game.player)) {
          game.pendingLevels += 1;
        }
        game.pendingPetSelect = true;

        /* 这里**故意不弹横幅**：横幅和紧接着出现的宠物面板会叠在一起（实测挡标题），
           奖励信息已经写在面板副标题里（「击杀尸潮之王的奖励 · 等级 +1」）。 */
      };

      /* 第二关起的 Boss 奖励：等级 +1（宠物已经在第一关选过了） */
      game.onBossReward = function () {
        if (VS.Player.grantLevel(game.player)) {
          game.pendingLevels += 1;
          if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
            game.deps.panels.showBanner('击 杀 奖 励', '等级 +1');
          }
        }
      };

      Game.newRun(game);
      return game;
    },

    /** 重置一整局（不改变 state，由调用方决定） */
    newRun: function (game) {
      game.time = 0;
      game.totalTime = 0;
      game.level = 0;
      game.victory = false;
      game.kills = 0;
      game.shake = 0;
      game.pendingLevels = 0;
      game.choices = [];
      game.animTime = 0;

      game.world = VS.World.create();
      game.fx = VS.Effects.create();
      game.weapons = VS.Weapons.create();
      game.enemies = VS.Enemies.create();
      game.pickups = VS.Pickups.create();
      game.pets = VS.Pets.create();
      game.player = VS.Player.create(game.world);

      game.pendingPetSelect = false;
      game.petChoices = [];
      game.draftCards = 0;

      /* 主角皮肤：从存档取（换皮肤在开始面板，走 VS.Save.setSkin）。
         取不到就给默认值，渲染层还会再兜一次底。 */
      game.playerSkin = (game.data && game.data.playerSkin) || 'witch';
      game.levelDef = VS.Levels.def(0);

      VS.Weapons.add(game.player, C.PLAYER.START_WEAPON);

      VS.World.snapCamera(game.world, game.player.x, game.player.y, viewW(game), viewH(game));

      game.phase = VS.Phases.at(0).id;

      return game;
    },

    /**
     * 进入/切换到某一关。
     * · 普通换关：保留玩家等级、经验、武器、增益、宠物、总击杀
     * · `def.fresh` 的关（第二关）：**和第一关没有任何关系** —— 等级/武器/增益/宠物
     *   全部重来，等于从 1 级重新开一局；只有"这一局的总时长/总击杀"这类跑图统计留着。
     * 两种情况下都重置：本关时间、怪物、掉落物、弹幕与酸液池、特效、玩家位置与血量。
     */
    startLevel: function (game, index, opt) {
      opt = opt || {};

      game.level = index;
      game.levelDef = VS.Levels.def(index);
      game.time = 0;
      game.phase = VS.Phases.at(0).id;
      game.pendingLevels = 0;
      game.choices = [];

      game.enemies = VS.Enemies.create();
      game.pickups = VS.Pickups.create();
      game.weapons = VS.Weapons.create();
      game.fx = VS.Effects.create();

      /* 本关从零开始：换一个全新的玩家（等级 / 武器 / 增益都清空），宠物也重新选 */
      if (VS.Levels.isFresh(index)) {
        var carriedKills = game.player ? game.player.kills : 0;

        game.player = VS.Player.create(game.world);
        game.player.kills = carriedKills;      // 跑图总击杀继续累计（结算面板要用）
        VS.Weapons.add(game.player, C.PLAYER.START_WEAPON);

        game.pets = VS.Pets.create();
        game.pendingPetSelect = false;

        /* 宠物与金球档位都跟着重置：第二关的第一只 Boss 会再给一次三选一 */
        game.enemies.firstBossDefeated = false;

        if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
          game.deps.panels.showBanner('重 新 开 始', '第二关从 1 级重来 · 只有本关的怪更凶');
        }
      }

      /* 玩家：位置回地图中心，回满血，给一小段无敌（免得一进来就被贴脸） */
      var p = game.player;
      p.x = game.world.w / 2;
      p.y = game.world.h / 2;
      p.vx = 0;
      p.vy = 0;
      p.hp = p.maxHp;
      p.invuln = opt.invuln === undefined ? 3 : opt.invuln;
      p.alive = true;

      VS.World.snapCamera(game.world, p.x, p.y, viewW(game), viewH(game));

      if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
        game.deps.panels.showBanner(VS.Levels.label(index), '本关时长 ' +
          U.formatTime(game.levelDef.duration) + ' · 撑住');
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
    start: function (game) {
      Game.newRun(game);
      game.state = STATE.PLAYING;

      if (game.deps.audio) game.deps.audio.unlock();
      if (game.deps.panels) game.deps.panels.hideAll();
      if (game.deps.hud) {
        game.deps.hud.show();
        game.deps.hud.update(game);
      }
      if (game.deps.audio) game.deps.audio.play('click');
    },

    /**
     * 从第 N 关直接开跑（关卡选择还没做，先给开始面板一个"预览第二关"按钮）。
     *
     * 跳关**不发保底构筑**，而是让玩家自己配：
     *   ① 先弹宠物三选一（自己挑）；
     *   ② 选完连抽 `opt.draft` 张升级卡（走现成的选卡面板，一张一张自己选）。
     * 这样"跳关看第二关"和正式流程的差别只剩下"少了前面 15 分钟"，构筑口味仍然是玩家自己的。
     *
     * @param {object} [opt] { draft: 自选卡张数（默认 8）, pet: 是否让玩家自己选宠物（默认 true） }
     */
    startAt: function (game, index, opt) {
      opt = opt || {};
      Game.newRun(game);

      index = Math.max(0, Math.min(Math.floor(index || 0), VS.Levels.count() - 1));

      game.draftCards = 0;

      if (index > 0) {
        Game.startLevel(game, index);

        var draft = opt.draft === undefined ? 8 : Math.max(0, Math.floor(opt.draft));

        if (opt.pet === false) {
          /* 不选宠物就直接把卡发了（测试/调试用） */
          Game.grantDraftCards(game, draft);
          if (draft > 0) draft = 0;
          game.draftCards = 0;
        } else {
          /* 宠物先选：选完在 choosePet 里把卡发下去，顺序就是"宠物 → 连抽 N 张" */
          game.pendingPetSelect = true;
          game.draftCards = draft;
        }

        game.player.hp = game.player.maxHp;
        game.player.invuln = 5;      // 自选期间站在怪堆里也要有活路
      }

      game.state = STATE.PLAYING;

      if (game.deps.audio) game.deps.audio.unlock();
      if (game.deps.panels) game.deps.panels.hideAll();
      if (game.deps.hud) {
        game.deps.hud.show();
        game.deps.hud.update(game);
      }
      if (game.deps.audio) game.deps.audio.play('click');
      return game;
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
      var entered = VS.Phases.crossed(prevTime, game.time);
      if (entered) {
        game.phase = entered.id;
        Game.announcePhase(game, entered);
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

      var input = game.deps.input || VS.Input;
      var axis = input && input.getAxis ? input.getAxis() : { x: 0, y: 0 };

      VS.Effects.beginFrame(game.fx);
      game.textBudget = 14;
      game.sparkBudget = 8;

      /* --- 逻辑推进 --- */
      VS.Player.update(game.player, dt, game.world, axis);
      VS.Pets.update(game.pets, dt, game);
      VS.Enemies.update(game.enemies, dt, game);
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
      if (game.time >= game.levelDef.duration) {
        Game.clearLevel(game);
        return;
      }
      if (game.pendingLevels > 0) {
        Game.openLevelUp(game);
        return;
      }
      if (game.pendingPetSelect && !VS.Pets.chosen(game.pets)) {
        Game.openPetSelect(game);
      }
    },

    /* ---------------- 环绕骨刃：E 键切换范围 ----------------
       只有拥有环绕骨刃时才生效；切换后立刻给一次反馈（横幅 + 音效 + 特效）。
       半径与转速的换算在 Weapons.statsFor 里，游戏状态只存一个下标（game.orbitMode）。 */

    toggleOrbitRange: function (game) {
      var p = game.player;
      if (!p || !VS.Weapons.has(p, 'orbit')) return false;

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

    /**
     * 跳关预览的"自选卡"：按张数给这么多次选卡机会。
     * 等级会真的涨（和正常升级一样），卡片走现成的三选一面板。
     */
    grantDraftCards: function (game, count) {
      var n = Math.max(0, Math.floor(count || 0));
      for (var i = 0; i < n; i++) {
        if (VS.Player.grantLevel(game.player)) game.pendingLevels += 1;
      }
      return n;
    },

    /** 本关时间到：符合通关条件就弹过关面板，否则判负（最后一关则是通关结算） */
    clearLevel: function (game) {
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

    /* ---------------- 升级 ---------------- */

    openLevelUp: function (game) {
      game.choices = buildChoices(game);

      if (game.choices.length === 0) {
        game.pendingLevels = 0;
        return;
      }

      game.state = STATE.LEVELUP;

      if (game.deps.audio) game.deps.audio.play('level');
      if (game.deps.hud) game.deps.hud.update(game);
      if (game.deps.panels) game.deps.panels.showLevelUp(game.choices, game.player.level);
    },

    choose: function (game, index) {
      /* 键盘 1/2/3 与卡片点击走同一条路：宠物面板期间就当作选宠物 */
      if (game.state === STATE.PETSELECT) return Game.choosePet(game, index);
      if (game.state !== STATE.LEVELUP) return false;

      var c = game.choices[index];
      if (!c) return false;

      applyChoice(game, c);
      game.pendingLevels = Math.max(0, game.pendingLevels - 1);

      if (game.deps.panels) game.deps.panels.hideLevelUp();

      if (game.pendingLevels > 0) {
        Game.openLevelUp(game);
      } else {
        game.state = STATE.PLAYING;
        VS.Effects.beginFrame(game.fx);
      }
      return true;
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
        game.deps.panels.showPetSelect(game.petChoices);
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

      /* 跳关预览：宠物选完接着把"自选卡"发下去（一张一张自己选） */
      if (game.draftCards > 0) {
        var n = game.draftCards;
        game.draftCards = 0;
        Game.grantDraftCards(game, n);
      }

      if (game.pendingLevels > 0) {
        Game.openLevelUp(game);
      } else {
        game.state = STATE.PLAYING;
        VS.Effects.beginFrame(game.fx);
      }
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
          ' · 等级 ' + game.player.level
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
      if (game.state === STATE.PLAYING) return Game.pause(game);
      if (game.state === STATE.PAUSED) return Game.resume(game);
      return false;
    },

    /* ---------------- 结算 ---------------- */

    endRun: function (game, opt) {
      opt = opt || {};
      game.state = STATE.GAMEOVER;
      game.victory = !!opt.victory;
      game.failedClear = !!opt.failedClear;      // 时间到但没打死最终 Boss
      game.failReason = opt.reason || '';

      /* 一局的总时长：打完的关卡 + 本关已经过的时间。
         第一关就死了的话就等于第一关的时间，和以前的口径一致。 */
      var total = runTime(game);
      var wave = VS.Enemies.waveFor(game.time);
      var p = game.player;

      var isNewBest = VS.Save.submit({
        time: total,
        kills: p.kills,
        level: p.level,
        wave: wave,
        stage: game.level + 1
      }, game.data);

      /* 个人纪录榜（本机 top5，登录后跟着云存档合并） */
      var rankInfo = null;
      if (VS.Scores) {
        rankInfo = VS.Scores.add({ time: total, kills: p.kills, level: p.level, wave: wave, stage: game.level + 1 });
        if (VS.ScoresUI) VS.ScoresUI.refresh();
      }

      if (game.deps.audio) game.deps.audio.play(game.victory ? 'level' : 'over');
      if (game.deps.panels && game.deps.panels.hideBanner) game.deps.panels.hideBanner();

      /* 云存档：登录了就往自己的 Gist 推一份（安静做，失败只更新一下面板提示） */
      if (VS.Cloud && VS.Cloud.logged()) {
        VS.Cloud.push(true).then(function (r) {
          if (r && r.ok && VS.CloudUI) VS.CloudUI.note('本局成绩已同步到云端 Gist', 'ok');
        });
      }

      /* 死亡爆散 */
      game.shake = 13;
      VS.Effects.burst(game.fx, p.x, p.y, '#e6dcff', 44, { speed: 280, life: 0.95, size: 4 });
      VS.Effects.burst(game.fx, p.x, p.y, '#b58cff', 26, { speed: 180, life: 1.2, size: 5 });

      if (game.deps.hud) game.deps.hud.hide();
      if (game.deps.panels) {
        game.deps.panels.showGameOver({
          time: total,
          best: game.data.bestTime,
          kills: p.kills,
          level: p.level,
          wave: wave,
          stage: game.level + 1,
          stageLabel: VS.Levels.label(game.level),
          victory: game.victory,
          failedClear: game.failedClear,
          reason: game.failReason,
          isNewBest: isNewBest
        });
      }
      if (VS.ScoresUI) VS.ScoresUI.showRank(rankInfo);   // 本局排名（没进前 5 就自己藏起来）

      /* 全站榜：云账号登录了就提交（GitHub-Gist 模式的账号不经过服务端，跳过） */
      if (VS.Leaderboard && VS.LeaderboardUI && VS.Leaderboard.canSubmit()) {
        VS.LeaderboardUI.submitRun({ time: total, kills: p.kills, level: p.level, wave: wave });
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
    _buildChoices: buildChoices,
    _applyChoice: applyChoice,
    _runTime: runTime
  };

  VS.register('Game', Game);

})(window.VS = window.VS || {});
