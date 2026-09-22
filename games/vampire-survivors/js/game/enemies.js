/* ===========================================================
   怪物：类型抽取、随时间强化的刷怪、AI 追击、分离、与玩家碰撞伤害
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  /* ---------------- 难度曲线 ---------------- */

  /**
   * 当前时间下的属性倍率。
   * 血量/伤害走 Phases 里的关键帧曲线（可按阶段压平），
   * 速度仍旧是缓和的线性增长。
   */
  function scaleFor(t) {
    return {
      hp: VS.Phases.hpMult(t),
      dmg: VS.Phases.dmgMult(t),
      speed: VS.Phases.speedMult(t)
    };
  }

  /** 当前波次（每 WAVE_PERIOD 秒 +1） */
  function waveFor(t) {
    return Math.floor(t / C.SPAWN.WAVE_PERIOD) + 1;
  }

  /**
   * 依权重抽一个已解锁的怪物类型。
   * 阶段可以通过 typeBias 给某类怪加权（尸潮阶段就是靠这个让僵尸特别多）。
   */
  function pickType(t) {
    var ids = [];
    var weights = [];

    for (var id in C.ENEMY_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(C.ENEMY_TYPES, id)) continue;
      var def = C.ENEMY_TYPES[id];
      if (def.boss) continue;            // Boss 单独投放，不进常规池
      if (t < def.minTime) continue;

      var w = def.weight * VS.Phases.typeBias(t, id);
      if (w <= 0) continue;

      ids.push(id);
      weights.push(w);
    }

    if (ids.length === 0) return C.ENEMY_TYPES.bat;
    return C.ENEMY_TYPES[ids[U.weightedIndex(weights)]];
  }

  /** 在屏幕外多远生成 */
  function spawnRadius(game) {
    var cam = game.world.camera;
    var half = Math.max(cam.w || 1280, cam.h || 720) * 0.5;
    return half + C.SPAWN.RING_MARGIN;
  }

  /* ---------------- 生成 ---------------- */

  /**
   * @param {object} [opt] { hpMult } —— Boss 用额外的血量倍率
   */
  function spawnEnemy(state, type, game, opt) {
    opt = opt || {};
    var p = game.player;
    var pos = VS.World.ringSpawnPoint(game.world, p.x, p.y, spawnRadius(game), state._pt);
    var sc = scaleFor(game.time);

    var hp = type.hp * sc.hp * (opt.hpMult || 1);

    var e = {
      uid: state.uid++,
      type: type.id,
      shape: type.shape,
      x: pos.x,
      y: pos.y,
      radius: type.radius,
      hp: hp,
      maxHp: hp,
      speed: type.speed * sc.speed,
      damage: type.damage * sc.dmg,
      xp: type.xp,
      color: type.color,
      edge: type.edge,
      elite: !!type.elite,
      boss: !!type.boss,
      name: type.name || type.id,

      dead: false,
      hitFlash: 0,
      orbitCd: 0,
      wobble: Math.random() * U.TAU,
      wobbleAmp: U.rand(0.7, 1.5)
    };

    state.list.push(e);
    return e;
  }

  /* ---------------- Boss ---------------- */

  function spawnBoss(state, game) {
    var def = C.ENEMY_TYPES.boss;
    var mult = Math.pow(C.BOSS.HP_GROWTH, state.bossCount);

    var e = spawnEnemy(state, def, game, { hpMult: mult });

    state.boss = e;
    state.bossCount++;

    /* 登场：镜头震动 + 一圈小怪 */
    game.shake = Math.max(game.shake || 0, C.BOSS.ENTRY_SHAKE);
    VS.Effects.explosion(game.fx, e.x, e.y, 2.4);
    VS.Effects.burst(game.fx, e.x, e.y, '#9be08a', 26, { speed: 220, life: 0.7, size: 3.4 });
    VS.Audio.play('over');

    for (var i = 0; i < C.BOSS.MINION_BATCH; i++) {
      if (state.list.length >= C.SPAWN.MAX_ENEMIES) break;
      spawnEnemy(state, pickType(game.time), game);
    }

    return e;
  }

  /** Boss 计时：没 Boss 时倒计时，到点投放；Boss 死了则排下一只 */
  function updateBoss(state, dt, game) {
    if (state.boss) {
      if (state.boss.dead) {
        state.boss = null;
        state.bossTimer = C.BOSS.REPEAT_DELAY;   // 下一只更厚的
      }
      return;
    }

    state.bossTimer -= dt;
    if (state.bossTimer <= 0) {
      spawnBoss(state, game);
    }
  }

  /* ---------------- 每帧更新 ---------------- */

  function updateSpawning(state, dt, game) {
    var t = game.time;

    /* 阶段倍率：尸潮阶段间隔缩短、每波数量翻倍；休整阶段反过来 */
    var spawnMul = VS.Phases.spawnMul(t);
    var batchMul = VS.Phases.batchMul(t);

    var interval = Math.max(
      C.SPAWN.MIN_INTERVAL,
      (C.SPAWN.START_INTERVAL - t * C.SPAWN.INTERVAL_DECAY) * spawnMul
    );
    state.spawnAcc += dt;

    var batch = Math.min(
      C.SPAWN.MAX_BATCH,
      Math.max(1, Math.round((1 + Math.floor(t * C.SPAWN.BATCH_GROWTH)) * batchMul))
    );

    var guard = 0;
    while (state.spawnAcc >= interval && guard++ < 64) {
      state.spawnAcc -= interval;

      if (state.list.length >= C.SPAWN.MAX_ENEMIES) break;

      var n = Math.min(batch, C.SPAWN.MAX_ENEMIES - state.list.length);
      for (var i = 0; i < n; i++) {
        spawnEnemy(state, pickType(t), game);
      }
    }
  }

  /**
   * 用本帧怪物移动后的位置重建空间网格。
   * 必须在武器结算之前重建，否则投射物/光环/骨刃会按上一帧的位置判定。
   */
  function rebuildGrid(state, game) {
    var grid = game.world.grid;
    grid.clear();

    var list = state.list;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].dead) grid.insert(list[i]);
    }
  }

  /** 分离力最多参考多少个邻居（限流，防止怪群挤成一团时退化成 O(n²)） */
  var SEPARATION_MAX_NEIGHBORS = 12;
  /** 分离力按 30Hz 结算即可：它只是视觉上的"别叠在一起"，没必要每帧算 */
  var SEPARATION_STEP = 1 / 30;

  function separate(state, dt, game) {
    state.sepAcc += dt;
    if (state.sepAcc < SEPARATION_STEP) return;

    var elapsed = state.sepAcc;   // 按真实经过的时间补上位移，保证手感一致
    state.sepAcc = 0;

    var list = state.list;
    var grid = game.world.grid;
    var scratch = game.world.scratch;
    var strength = C.SPAWN.SEPARATION;
    var rad = C.SPAWN.SEPARATION_RADIUS;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      if (e.boss) continue;          // Boss 体型巨大，不参与互相推挤

      grid.queryCircle(e.x, e.y, rad, scratch, SEPARATION_MAX_NEIGHBORS);

      var px = 0, py = 0;
      for (var j = 0; j < scratch.length; j++) {
        var o = scratch[j];
        if (o === e || o.dead) continue;

        var dx = e.x - o.x, dy = e.y - o.y;
        var d2 = dx * dx + dy * dy;
        if (d2 >= rad * rad || d2 < 0.0001) continue;

        var d = Math.sqrt(d2);
        var push = (rad - d) / rad;
        px += (dx / d) * push;
        py += (dy / d) * push;
      }

      if (px !== 0 || py !== 0) {
        e.x += px * strength * elapsed;
        e.y += py * strength * elapsed;
      }
    }
  }

  function moveAndCollide(state, dt, game) {
    var list = state.list;
    var p = game.player;
    var world = game.world;

    var pad = world.pad;
    var maxX = world.w - pad;
    var maxY = world.h - pad;

    /* 只有屏幕附近的怪才做"蛇形"运算（Math.sin 不便宜，
       几百只怪时这一步能吃掉好几毫秒）；屏幕外的怪直接直线追击。 */
    var view = VS.World.viewRect(world, 160);

    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];

      if (e.dead) { U.swapRemove(list, i); continue; }

      if (e.hitFlash > 0) e.hitFlash -= dt;
      if (e.orbitCd > 0) e.orbitCd -= dt;

      /* --- 朝玩家移动 --- */
      var dx = p.x - e.x;
      var dy = p.y - e.y;
      var d2 = dx * dx + dy * dy;

      if (d2 > 1e-6) {
        var d = Math.sqrt(d2);
        var ux = dx / d, uy = dy / d;

        var nearScreen = (e.x >= view.x0 && e.x <= view.x1 && e.y >= view.y0 && e.y <= view.y1);

        if (nearScreen) {
          e.wobble += dt * 3.1;
          var sway = Math.sin(e.wobble) * e.wobbleAmp * 0.18;
          var sx = ux - uy * sway;
          var sy = uy + ux * sway;
          var sl = Math.sqrt(sx * sx + sy * sy) || 1;
          ux = sx / sl;
          uy = sy / sl;
        }

        e.x += ux * e.speed * dt;
        e.y += uy * e.speed * dt;
      }

      /* --- 地图边界（内联，省掉每只怪 3 次函数调用） --- */
      var r = e.radius;
      var loX = pad + r, hiX = maxX - r;
      var loY = pad + r, hiY = maxY - r;
      if (e.x < loX) e.x = loX; else if (e.x > hiX) e.x = hiX;
      if (e.y < loY) e.y = loY; else if (e.y > hiY) e.y = hiY;

      /* --- 与玩家的碰撞伤害（无敌帧内只结算一次） --- */
      if (p.alive && p.invuln <= 0) {
        var rr = p.radius + r;
        var cdx = p.x - e.x, cdy = p.y - e.y;
        if (cdx * cdx + cdy * cdy <= rr * rr) {
          VS.Player.takeDamage(p, e.damage, game, e.x, e.y);
        }
      }
    }
  }

  /* ---------------- 伤害与死亡 ---------------- */

  function kill(game, e) {
    if (e.dead) return;
    e.dead = true;

    game.player.kills++;
    game.kills++;

    /* Boss 死亡：更大的爆炸、掉落一大把经验石、并且排队下一只 */
    if (e.boss) {
      VS.Effects.explosion(game.fx, e.x, e.y, 3.4);
      VS.Effects.explosion(game.fx, e.x, e.y, 2.2);
      VS.Effects.gib(game.fx, e.x, e.y, e.color, 60);
      VS.Effects.burst(game.fx, e.x, e.y, '#ffd166', 40, { speed: 320, life: 1.1, size: 4 });
      game.shake = Math.max(game.shake || 0, 18);
      VS.Audio.play('over');

      // 经验石撒成一圈，方便一口气全捡
      var orbs = 14;
      for (var k = 0; k < orbs; k++) {
        var a = (k / orbs) * U.TAU;
        var dist = 44 + Math.random() * 40;
        VS.Pickups.spawnXp(game.pickups, e.x + Math.cos(a) * dist, e.y + Math.sin(a) * dist,
                           Math.max(1, Math.round((e.xp / orbs) * game.player.luck)));
      }
      VS.Pickups.spawnHeart(game.pickups, e.x, e.y);
      VS.Pickups.spawnHeart(game.pickups, e.x + 34, e.y);
      return;
    }

    VS.Effects.gib(game.fx, e.x, e.y, e.color, e.elite ? 26 : C.FX.DEATH_PARTICLES);
    VS.Effects.burst(game.fx, e.x, e.y, e.edge, 5, { speed: 170, life: 0.4, size: 2.6 });

    /* 死亡爆炸：体积随怪物大小缩放，精英炸得最大 */
    VS.Effects.explosion(game.fx, e.x, e.y, 0.5 + e.radius / 22);

    VS.Audio.play('die');

    var xp = Math.max(1, Math.round(e.xp * game.player.luck));
    VS.Pickups.spawnXp(game.pickups, e.x, e.y, xp);

    /* 金色经验球：存活满 3 分钟后才开始掉，10% 概率，经验量 = 普通球的 100 倍 */
    if (VS.Pickups.rollGold(game.time)) {
      VS.Pickups.spawnGold(game.pickups, e.x, e.y, xp * C.DROP.GOLD_ORB_MULT);
    }

    var heartChance = e.elite ? C.DROP.HEART_ELITE_CHANCE : C.DROP.HEART_CHANCE;
    if (Math.random() < heartChance) {
      VS.Pickups.spawnHeart(game.pickups, e.x, e.y);
    }
  }

  /* ---------------- 性能分析钩子 ----------------
     默认关闭；打开后只多一次布尔判断，用来定位"哪一段在吃帧"。
     VS.Enemies.prof.on = true 后，四个子阶段的累计毫秒数会写进 prof。
  ------------------------------------------------- */
  var prof = { on: false, spawn: 0, move: 0, grid: 0, separate: 0, ticks: 0 };
  var nowMs = (typeof performance !== 'undefined' && performance && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  var Enemies = {

    waveFor: waveFor,
    scaleFor: scaleFor,

    create: function () {
      return {
        list: [],
        spawnAcc: 0,
        sepAcc: 0,
        uid: 1,
        kills: 0,
        boss: null,                    // 当前存活的 Boss（HUD 血条读它）
        bossCount: 0,                  // 已经投放了几只（决定强度）
        bossTimer: C.BOSS.FIRST_AT,    // 倒计时到第 5 分钟
        _pt: { x: 0, y: 0 }            // 复用的生成点对象
      };
    },

    reset: function (state) {
      state.list.length = 0;
      state.spawnAcc = 0;
      state.sepAcc = 0;
      state.uid = 1;
      state.kills = 0;
      state.boss = null;
      state.bossCount = 0;
      state.bossTimer = C.BOSS.FIRST_AT;
    },

    /**
     * 对怪物造成伤害
     * @param {object} game
     * @param {object} e 怪物
     * @param {number} amount 已经算好增益/暴击的最终伤害
     * @param {boolean} crit 是否暴击（只影响表现）
     * @param {number} [kx] @param {number} [ky] 击退方向（不必归一化）
     */
    hurt: function (game, e, amount, crit, kx, ky) {
      if (e.dead) return;

      e.hp -= amount;
      e.hitFlash = 0.12;
      game.player.damageDealt += amount;

      /* 击退：给一个很小的直接位移；精英抗性高，Boss 基本推不动 */
      if (kx || ky) {
        var kl = Math.sqrt(kx * kx + ky * ky);
        if (kl > 0.001) {
          var mass = e.boss ? 0.04 : (e.elite ? 0.28 : 1);
          var push = Math.min(kl * 0.05, 24) * mass;
          e.x += (kx / kl) * push;
          e.y += (ky / kl) * push;
        }
      }

      /* 飘字受每帧预算限制，避免几百次命中把屏幕刷满 */
      if (game.textBudget > 0) {
        game.textBudget--;
        VS.Effects.text(
          game.fx, e.x, e.y - e.radius,
          (crit ? '✧' : '') + Math.round(amount),
          crit ? '#ffd166' : '#f2f7ff',
          { crit: crit }
        );
      }

      VS.Effects.burst(game.fx, e.x, e.y, e.edge, crit ? 5 : 3, {
        speed: 120, life: 0.26, size: 2.2
      });

      /* 命中火花：每帧限量，避免几百次命中刷满屏幕 */
      if (game.sparkBudget > 0) {
        game.sparkBudget--;
        VS.Effects.spark(game.fx, e.x, e.y - e.radius * 0.35);
      }

      if (e.hp <= 0) {
        kill(game, e);
      } else {
        VS.Audio.play('hit');
      }
    },

    spawn: spawnEnemy,
    updateSpawning: updateSpawning,
    kill: kill,

    update: function (state, dt, game) {
      if (prof.on) {
        var t = nowMs();
        updateSpawning(state, dt, game); prof.spawn += nowMs() - t;

        t = nowMs();
        updateBoss(state, dt, game);
        prof.move += nowMs() - t;

        t = nowMs();
        moveAndCollide(state, dt, game);   // 内部会剔除已死亡的怪
        prof.move += nowMs() - t;

        t = nowMs();
        rebuildGrid(state, game);          // 网格与最新位置同步
        prof.grid += nowMs() - t;

        t = nowMs();
        separate(state, dt, game);
        prof.separate += nowMs() - t;

        prof.ticks++;
        return;
      }

      updateSpawning(state, dt, game);
      updateBoss(state, dt, game);
      moveAndCollide(state, dt, game);
      rebuildGrid(state, game);
      separate(state, dt, game);
    },

    prof: prof,

    rebuildGrid: rebuildGrid,
    separate: separate,
    moveAndCollide: moveAndCollide,
    spawnBoss: spawnBoss,
    updateBoss: updateBoss,

    /** 统计存活怪物数量（UI 用） */
    aliveCount: function (state) {
      var n = 0;
      for (var i = 0; i < state.list.length; i++) {
        if (!state.list[i].dead) n++;
      }
      return n;
    }
  };

  VS.register('Enemies', Enemies);

})(window.VS = window.VS || {});
