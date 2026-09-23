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
   *                       { x, y }  —— 指定出生点（Boss 召唤小弟用，见 summonMinions）
   */
  function spawnEnemy(state, type, game, opt) {
    opt = opt || {};
    var p = game.player;
    var pos = (opt.x !== undefined && opt.y !== undefined)
      ? { x: opt.x, y: opt.y }
      : VS.World.ringSpawnPoint(game.world, p.x, p.y, spawnRadius(game), state._pt);
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

  /* ---------------- Boss ----------------
     固定时间表（C.BOSS.SCHEDULE）：5:00 尸潮之王、10:00 柠檬猪，各一只。
     原先"击杀后 90 秒再来一只"的循环已经删掉（那只会落在 7 分多钟）。
  ---------------------------------------- */

  function spawnBoss(state, game, entry) {
    var def = C.ENEMY_TYPES[entry.type];
    if (!def) return null;

    var e = spawnEnemy(state, def, game);

    e.bossEntry = entry;
    e.name = entry.name || def.name;

    /* 时间表里 kit:false 的 Boss（柠檬猪）不走 BossKit 的招式状态机：
       它只有"慢慢逼近 + 吐酸液"两件事，招式由下面的 updateBossAttack 负责。
       BossKit 只服务尸潮之王那套四档七招。 */
    if (entry.kit === false) e.noKit = true;

    /* 远程攻击的伤害按生成时的难度倍率定下来 */
    if (def.ranged) {
      e.fireCd = def.ranged.cooldown * 0.6;    // 登场后先缓一下再吐
      e.rangedDamage = def.ranged.damage * scaleFor(game.time).dmg;
    }

    state.boss = e;
    state.bossCount++;

    /* 登场：镜头震动 + 爆炸 */
    game.shake = Math.max(game.shake || 0, C.BOSS.ENTRY_SHAKE);
    VS.Effects.explosion(game.fx, e.x, e.y, 2.6);
    VS.Effects.burst(game.fx, e.x, e.y, def.edge, 30, { speed: 230, life: 0.8, size: 3.4 });
    VS.Audio.play('over');

    if (game.deps && game.deps.panels && game.deps.panels.showBanner && entry.tip) {
      game.deps.panels.showBanner(entry.tip, entry.sub);
    }

    for (var i = 0; i < C.BOSS.MINION_BATCH; i++) {
      if (state.list.length >= C.SPAWN.MAX_ENEMIES) break;
      spawnEnemy(state, pickType(game.time), game);
    }

    return e;
  }

  /** Boss 召唤小弟：在 Boss 周围撒一圈，位置不重叠、不越地图边界。
   *  上限由 BossKit 按 C.BOSS.MINION_MAX 把关（这里只负责生成）。 */
  function summonMinions(state, n, game, ox, oy) {
    var made = 0;
    var world = game.world, pad = world.pad;
    for (var i = 0; i < n; i++) {
      if (state.list.length >= C.SPAWN.MAX_ENEMIES) break;
      var a = (i / Math.max(1, n)) * U.TAU + Math.random() * 0.6;
      var dist = 54 + Math.random() * 46;
      var x = U.clamp(ox + Math.cos(a) * dist, pad + 30, world.w - pad - 30);
      var y = U.clamp(oy + Math.sin(a) * dist, pad + 30, world.h - pad - 30);
      var e = spawnEnemy(state, pickType(game.time), game, { x: x, y: y });
      if (e) { made++; VS.Effects.burst(game.fx, x, y, '#ff9a6c', 8, { speed: 150, life: 0.4, size: 2.6 }); }
    }
    return made;
  }

  /** 时间表推进：场上没 Boss 且到点了就投放下一只 */
  function updateBoss(state, dt, game) {
    if (state.boss) return;                              // 上一只还活着

    var sched = C.BOSS.SCHEDULE;
    if (state.bossIndex >= sched.length) return;         // 时间表跑完，不再有 Boss

    if (game.time < sched[state.bossIndex].at) return;

    spawnBoss(state, game, sched[state.bossIndex]);
    state.bossIndex++;
  }

  /* ---------------- Boss 的远程攻击（柠檬酸液） ---------------- */

  function updateBossAttack(state, dt, game) {
    var b = state.boss;
    if (!b || b.dead) return;

    var def = C.ENEMY_TYPES[b.type];
    if (!def || !def.ranged) return;

    var R = def.ranged;
    b.fireCd -= dt;
    if (b.fireCd > 0) return;

    var p = game.player;
    if (!p.alive) return;

    var d2 = U.dist2(b.x, b.y, p.x, p.y);
    if (d2 > R.range * R.range) return;                  // 玩家太远，先走近再说

    b.fireCd = R.cooldown;

    var base = Math.atan2(p.y - b.y, p.x - b.x);
    var count = R.count;

    for (var i = 0; i < count; i++) {
      var a = base + (i - (count - 1) / 2) * R.spread;
      state.shots.push({
        x: b.x + Math.cos(a) * (b.radius * 0.55),
        y: b.y + Math.sin(a) * (b.radius * 0.55),
        vx: Math.cos(a) * R.speed,
        vy: Math.sin(a) * R.speed,
        r: R.radius,
        angle: a,
        damage: b.rangedDamage || R.damage,
        life: R.life,
        phase: Math.random() * U.TAU
      });
    }

    VS.Audio.play('nova');
  }

  /** 酸液飞行 + 命中玩家 */
  function updateShots(state, dt, game) {
    var list = state.shots;
    if (!list.length) return;

    var p = game.player;
    var world = game.world;

    for (var i = list.length - 1; i >= 0; i--) {
      var s = list[i];

      s.life -= dt;
      s.phase += dt * 6;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (s.life <= 0 || !VS.World.isInside(world, s.x, s.y, 0)) {
        VS.Effects.burst(game.fx, s.x, s.y, '#c8e04a', 4, { speed: 70, life: 0.3, size: 2.4 });
        U.swapRemove(list, i);
        continue;
      }

      if (p.alive && U.circleHit(p.x, p.y, p.radius, s.x, s.y, s.r)) {
        VS.Player.takeDamage(p, s.damage, game, s.x, s.y);
        VS.Effects.burst(game.fx, s.x, s.y, '#d8f05a', 12, { speed: 150, life: 0.45, size: 3 });
        U.swapRemove(list, i);
      }
    }
  }

  /* ---------------- 每帧更新 ---------------- */

  function updateSpawning(state, dt, game) {
    var t = game.time;

    /*
     * 两段"完全不刷怪"的时间：
     *   1) 休整阶段（4:00–5:00）：让玩家专心把地上的经验捡干净
     *   2) Boss 战期间：直到 Boss 死亡，场上只有它一个
     * 注意是"停止刷新"，场上已有的怪不会凭空消失，仍然要打掉。
     */
    var bossAlive = !!(state.boss && !state.boss.dead);
    if (VS.Phases.noSpawn(t) || (bossAlive && C.BOSS.PAUSE_SPAWN)) {
      state.spawnAcc = 0;   // 清掉欠账，恢复刷怪时才不会一次涌出一大批
      return;
    }

    /* 阶段倍率：尸潮阶段间隔缩短、每波数量翻倍 */
    var spawnMul = VS.Phases.spawnMul(t);
    var batchMul = VS.Phases.batchMul(t);

    /* 人潮刹车（平衡安全网，2026-09-23 测量台数据）：
       弱构筑时"刷得比打得快"会滚成雪崩 —— 实测最差的一局 180 秒就顶到 520 硬上限、
       之后只能被磨死。场上怪超过 CROWD_AT 之后把刷怪间隔乘 CROWD_MUL，给玩家一个喘息的窗口；
       怪掉回阈值以下立刻恢复正常节奏（不是永久削弱）。 */
    var crowdBrake = 1;
    if (state.list.length >= C.SPAWN.CROWD_AT) crowdBrake = C.SPAWN.CROWD_MUL;

    var interval = Math.max(
      C.SPAWN.MIN_INTERVAL,
      (C.SPAWN.START_INTERVAL - t * C.SPAWN.INTERVAL_DECAY) * spawnMul
    ) * crowdBrake;
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

      /* --- Boss 的移动/招式交给 BossKit（弹幕、召唤、冲撞都在那边）；
             柠檬猪标了 noKit，走下面的常规追击 + 自己的酸液 --- */
      var driven = !!(e.boss && VS.BossKit && !e.noKit);
      if (driven) VS.BossKit.step(e, dt, game);

      /* --- 朝玩家移动 --- */
      var dx = p.x - e.x;
      var dy = p.y - e.y;
      var d2 = dx * dx + dy * dy;

      if (!driven && d2 > 1e-6) {
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

    /* Boss 死亡：更大的爆炸、掉落一大把经验石、结算奖励 */
    if (e.boss) {
      var es = game.enemies;

      VS.Effects.explosion(game.fx, e.x, e.y, 3.4);
      VS.Effects.explosion(game.fx, e.x, e.y, 2.2);
      VS.Effects.gib(game.fx, e.x, e.y, e.color, 60);
      VS.Effects.burst(game.fx, e.x, e.y, '#ffd166', 40, { speed: 320, life: 1.1, size: 4 });
      game.shake = Math.max(game.shake || 0, 18);
      VS.Audio.play('over');

      es.boss = null;
      es.bossesKilled++;

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

      /* 第一只 Boss 的击杀奖励：等级 +1 + 解锁宠物三选一 */
      if (e.bossEntry && e.bossEntry.reward === 'firstBoss' && !es.firstBossDefeated) {
        es.firstBossDefeated = true;
        if (game.onFirstBossReward) game.onFirstBossReward();
      }
      return;
    }

    VS.Effects.gib(game.fx, e.x, e.y, e.color, e.elite ? 26 : C.FX.DEATH_PARTICLES);
    VS.Effects.burst(game.fx, e.x, e.y, e.edge, 5, { speed: 170, life: 0.4, size: 2.6 });

    /* 死亡爆炸：体积随怪物大小缩放，精英炸得最大 */
    VS.Effects.explosion(game.fx, e.x, e.y, 0.5 + e.radius / 22);

    VS.Audio.play('die');

    var xp = Math.max(1, Math.round(e.xp * game.player.luck));
    VS.Pickups.spawnXp(game.pickups, e.x, e.y, xp);

    /* 金色经验球：3 分钟后 5%，打完第一只 Boss 后 20%；经验量 = 普通球的 100 倍 */
    if (VS.Pickups.rollGold(game.time, game.enemies.firstBossDefeated)) {
      VS.Pickups.spawnGold(game.pickups, e.x, e.y, xp * C.DROP.GOLD_ORB_MULT);
    }

    /* 超级经验球：10 分钟后 0.3%，拾取直接升一级 */
    if (VS.Pickups.rollSuper(game.time)) {
      VS.Pickups.spawnSuper(game.pickups, e.x, e.y);
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
        shots: [],                     // Boss 吐出来的酸液（敌方弹幕）
        spawnAcc: 0,
        sepAcc: 0,
        uid: 1,
        kills: 0,
        boss: null,                    // 当前存活的 Boss（HUD 血条读它）
        bossIndex: 0,                  // 时间表指针：下一只要投放的是第几条
        bossCount: 0,                  // 已经投放了几只
        bossesKilled: 0,               // 已经打死了几只
        firstBossDefeated: false,      // 第一只 Boss 是否已击杀（金球掉率分档要用）
        _pt: { x: 0, y: 0 }            // 复用的生成点对象
      };
    },

    reset: function (state) {
      state.list.length = 0;
      state.shots.length = 0;
      state.spawnAcc = 0;
      state.sepAcc = 0;
      state.uid = 1;
      state.kills = 0;
      state.boss = null;
      state.bossIndex = 0;
      state.bossCount = 0;
      state.bossesKilled = 0;
      state.firstBossDefeated = false;
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

      /* Boss 的护盾阶段：无敌（必须清掉它召唤的那一波才破盾）—— 这就是"配队思路"的落点：
         纯单体构筑会在这一阶段干瞪眼，纯 AoE 构筑又清得慢、Boss 打得久。
         虚弱期反过来给伤害加成，让"会打断"的玩家有正反馈。 */
      if (e.boss && e.ai) {
        if (e.ai.invuln > 0) {
          if (game.textBudget > 0) {
            game.textBudget--;
            VS.Effects.text(game.fx, e.x, e.y - e.radius, '免疫', '#9fd6ff', { crit: false });
          }
          return 0;
        }
        if (e.ai.vulnBonus > 1) amount *= e.ai.vulnBonus;
      }

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
    spawnBoss: spawnBoss,
    summonMinions: summonMinions,
    updateSpawning: updateSpawning,
    kill: kill,

    update: function (state, dt, game) {
      if (prof.on) {
        /* Boss 必须先结算：它一登场就要立刻掐掉常规刷怪，
           否则登场那一帧刷怪逻辑已经跑过了，会漏出一只小怪 */
        var t = nowMs();
        updateBoss(state, dt, game);
        updateBossAttack(state, dt, game);
        updateShots(state, dt, game);
        prof.move += nowMs() - t;

        t = nowMs();
        updateSpawning(state, dt, game); prof.spawn += nowMs() - t;

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

      /* 顺序要紧：先 Boss 再刷怪（见上面注释） */
      updateBoss(state, dt, game);
      updateBossAttack(state, dt, game);
      updateShots(state, dt, game);
      updateSpawning(state, dt, game);
      moveAndCollide(state, dt, game);
      rebuildGrid(state, game);
      separate(state, dt, game);
      if (VS.BossKit) VS.BossKit.updateShots(game, dt);   // 敌方弹幕：移动、命中、回收
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
