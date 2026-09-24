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
   */
  function buildChoices(game) {
    var p = game.player;
    var pool = [];
    var weights = [];
    var i;

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
        petChoices: []
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
      game.levelDef = VS.Levels.def(0);

      VS.Weapons.add(game.player, C.PLAYER.START_WEAPON);

      VS.World.snapCamera(game.world, game.player.x, game.player.y, viewW(game), viewH(game));

      game.phase = VS.Phases.at(0).id;

      return game;
    },

    /**
     * 进入/切换到某一关。
     * 保留：玩家等级、经验、武器、增益、宠物、总击杀、金球档位
     * 重置：本关时间、怪物、掉落物、弹幕/酸液池、特效、玩家位置与血量
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

    /* ---------------- 关卡推进 ---------------- */

    /** 本关时间到：弹过关面板（最后一关则是通关） */
    clearLevel: function (game) {
      game.state = STATE.LEVELCLEAR;

      /* 注意：这里**不要**把本关时长并进 totalTime —— 此刻 game.time 还是本关时长，
         runTime() = totalTime + time 会把它算两遍（面板上会显示成 30:00）。
         并账放在 nextLevel()：真正离开这一关的时候再加。 */
      game.time = game.levelDef.duration;

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
          nextLabel: last ? '' : VS.Levels.label(game.level + 1)
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
      game.petChoices = VS.Pets.list();

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
