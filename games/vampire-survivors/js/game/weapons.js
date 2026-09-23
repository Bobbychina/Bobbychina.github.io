/* ===========================================================
   武器：飞弹 / 腐化光环 / 环绕骨刃 / 血爆新星
   负责开火节奏、弹道推进、命中判定（基于世界空间网格）与伤害结算。
   玩家身上只存 [{id, level, cd}]，运行时实体（弹丸/冲击波）挂在 weapons 状态里。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  /* ---------------- 武器持有关系 ---------------- */

  function getWeapon(player, id) {
    for (var i = 0; i < player.weapons.length; i++) {
      if (player.weapons[i].id === id) return player.weapons[i];
    }
    return null;
  }

  /* ---------------- 伤害计算（含暴击） ---------------- */

  function rollDamage(game, base) {
    var p = game.player;
    var dmg = base * p.damageMul;
    var crit = false;
    if (p.critChance > 0 && Math.random() < p.critChance) {
      dmg *= C.CRIT_MULT;
      crit = true;
    }
    return { dmg: dmg, crit: crit };
  }

  /* ---------------- 目标检索 ---------------- */

  /**
   * 找离 (x,y) 最近的 n 个敌人。
   * 用固定容量的插入排序而不是"全部收集后 sort"：
   * 后者每次开火都要为场上每只怪分配一个对象再排序，
   * 几百只怪 + 高攻速时会产生大量垃圾并拖慢帧。
   * 这里最多只做 n 次比较移动，零分配（复用模块级数组）。
   * @param {number} [maxD2] 超出该平方距离的目标直接忽略
   */
  var _nearOut = [];
  var _nearD = [];

  function nearestEnemies(game, x, y, n, maxD2) {
    _nearOut.length = 0;
    _nearD.length = 0;

    var list = game.enemies.list;
    var count = 0;
    var hasRange = (maxD2 !== undefined && maxD2 !== null);
    var worstD = hasRange ? maxD2 : Infinity;

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;

      var d = U.dist2(x, y, e.x, e.y);
      if (hasRange && d > maxD2) continue;
      if (count === n && d >= worstD) continue;

      // 插入到按距离升序的位置（n 最大只有个位数）
      var pos = count;
      while (pos > 0 && _nearD[pos - 1] > d) pos--;

      if (count < n) {
        for (var k = count; k > pos; k--) {
          _nearD[k] = _nearD[k - 1];
          _nearOut[k] = _nearOut[k - 1];
        }
        count++;
      } else {
        // 已满：丢掉最远的那个（下标 n-1），再插入
        for (var k2 = n - 1; k2 > pos; k2--) {
          _nearD[k2] = _nearD[k2 - 1];
          _nearOut[k2] = _nearOut[k2 - 1];
        }
      }

      _nearD[pos] = d;
      _nearOut[pos] = e;

      worstD = (count === n) ? _nearD[n - 1] : (hasRange ? maxD2 : Infinity);
    }

    return _nearOut;
  }

  /* ---------------- 魔法飞弹 ---------------- */

  var BOLT_LIFE = 1.8;        // 飞弹存活时间（秒），与射程换算挂钩
  var BOLT_TURN = 5.0;        // 追踪转向速率（弧度/秒）

  /**
   * 核心发射：从 (sx,sy) 按 st 的数值打一轮，锁最近的 count 个目标。
   * @returns {number} 实际发射了几颗（0 = 射程内没目标，调用方不该消耗冷却）
   */
  function fireVolleyFrom(game, sx, sy, st) {
    var p = game.player;
    var state = game.weapons;

    // noProjBonus：宠物不吃"多重射击"增益，保持"每秒 4 颗"的语义
    var count = st.count + (st.noProjBonus ? 0 : p.projBonus);
    var maxRange = st.speed * BOLT_LIFE;

    // 只锁定射程内的目标：射程外的敌人根本打不到，锁定它只是白白浪费冷却
    var targets = nearestEnemies(game, sx, sy, count, maxRange * maxRange);
    if (targets.length === 0) return 0;

    var spread = 0.17;

    for (var i = 0; i < count; i++) {
      var tgt = targets[i % targets.length];

      // 按目标当前速度做提前量，减少需要追踪的幅度
      var flight = Math.sqrt(U.dist2(sx, sy, tgt.x, tgt.y)) / st.speed;
      var aimX = tgt.x + (tgt.vx || 0) * flight;
      var aimY = tgt.y + (tgt.vy || 0) * flight;

      var ang = Math.atan2(aimY - sy, aimX - sx);
      if (count > 1) ang += (i - (count - 1) / 2) * spread * 0.55;

      var d = rollDamage(game, st.damage);
      var muzzle = (st.muzzle !== undefined ? st.muzzle : p.radius) + 5;

      state.projectiles.push({
        x: sx + Math.cos(ang) * muzzle,
        y: sy + Math.sin(ang) * muzzle,
        vx: Math.cos(ang) * st.speed,
        vy: Math.sin(ang) * st.speed,
        speed: st.speed,
        angle: ang,
        target: tgt,          // 追踪目标（对象引用；目标死亡后自动停止追踪）
        r: st.radius,
        damage: d.dmg,
        crit: d.crit,
        pierce: st.pierce,
        life: BOLT_LIFE,
        hitIds: [],
        color: st.color || C.WEAPONS.bolt.color
      });
    }

    return count;
  }

  function fireBolt(game, w, st) {
    if (fireVolleyFrom(game, game.player.x, game.player.y, st) > 0) {
      VS.Audio.play('shoot');
    }
  }

  function updateProjectiles(state, dt, game) {
    var list = state.projectiles;
    if (list.length === 0) return;

    var world = game.world;
    var grid = world.grid;
    var scratch = world.scratch;

    for (var i = list.length - 1; i >= 0; i--) {
      var pr = list[i];

      pr.life -= dt;

      /* 轻微追踪。直线弹道会被横向移动的目标轻易躲开，
         实测会让绝大部分射击落空，玩家因此完全打不出伤害。 */
      if (pr.target && !pr.target.dead) {
        var want = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
        var diff = want - pr.angle;
        while (diff > Math.PI) diff -= U.TAU;
        while (diff < -Math.PI) diff += U.TAU;

        var turn = BOLT_TURN * dt;
        if (diff > turn) diff = turn;
        else if (diff < -turn) diff = -turn;

        pr.angle += diff;
        pr.vx = Math.cos(pr.angle) * pr.speed;
        pr.vy = Math.sin(pr.angle) * pr.speed;
      }

      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      if (pr.life <= 0 || !VS.World.isInside(world, pr.x, pr.y, 0)) {
        U.swapRemove(list, i);
        continue;
      }

      grid.queryCircle(pr.x, pr.y, pr.r, scratch, 48);

      var consumed = false;
      for (var j = 0; j < scratch.length; j++) {
        var e = scratch[j];
        if (e.dead) continue;
        if (pr.hitIds.indexOf(e.uid) >= 0) continue;
        if (!U.circleHit(pr.x, pr.y, pr.r, e.x, e.y, e.radius)) continue;

        pr.hitIds.push(e.uid);
        VS.Enemies.hurt(game, e, pr.damage, pr.crit, pr.vx * 0.12, pr.vy * 0.12);

        pr.pierce--;
        if (pr.pierce <= 0) { consumed = true; break; }
      }

      if (consumed) U.swapRemove(list, i);
    }
  }

  /* ---------------- 腐化光环 ---------------- */

  function tickGarlic(game, w, st) {
    var p = game.player;
    var state = game.weapons;
    var radius = st.radius * p.areaMul;

    var grid = game.world.grid;
    var scratch = game.world.scratch;

    grid.queryCircle(p.x, p.y, radius, scratch);

    var hits = 0;
    for (var i = 0; i < scratch.length; i++) {
      var e = scratch[i];
      if (e.dead) continue;
      if (!U.circleHit(p.x, p.y, radius, e.x, e.y, e.radius)) continue;

      var d = rollDamage(game, st.damage);
      VS.Enemies.hurt(game, e, d.dmg, d.crit, 0, 0);
      hits++;
    }

    // 让渲染层画出一次脉冲
    state.auraPulse = { x: p.x, y: p.y, r: radius, life: 0.22, maxLife: 0.22 };

    if (hits > 0) VS.Audio.play('hit');
  }

  /* ---------------- 环绕骨刃 ---------------- */

  function updateOrbit(state, dt, game, w) {
    var p = game.player;
    var st = C.WEAPONS.orbit.stats(w.level);
    var count = st.count;
    var radius = st.radius * p.areaMul;
    var bladeR = st.bladeRadius;

    state.orbitAngle += st.spin * p.attackSpeedMul * dt;
    if (state.orbitAngle > U.TAU) state.orbitAngle -= U.TAU;

    state.orbitBlades.length = 0;

    var grid = game.world.grid;
    var scratch = world_scratch(game);

    for (var i = 0; i < count; i++) {
      var a = state.orbitAngle + (i / count) * U.TAU;
      var bx = p.x + Math.cos(a) * radius;
      var by = p.y + Math.sin(a) * radius;

      state.orbitBlades.push({ x: bx, y: by, angle: a + Math.PI / 2, r: bladeR, color: C.WEAPONS.orbit.color });

      grid.queryCircle(bx, by, bladeR, scratch, 32);

      for (var j = 0; j < scratch.length; j++) {
        var e = scratch[j];
        if (e.dead || e.orbitCd > 0) continue;
        if (!U.circleHit(bx, by, bladeR, e.x, e.y, e.radius)) continue;

        e.orbitCd = st.hitCooldown;
        var d = rollDamage(game, st.damage);
        VS.Enemies.hurt(game, e, d.dmg, d.crit, 0, 0);
      }
    }
  }

  /* scratch 数组在更新环绕刃时会被反复复用；
     这里包一层是为了语义清晰，同时防止未来误用同一个数组 */
  function world_scratch(game) {
    return game.world.scratch;
  }

  /* ---------------- 血爆新星 ---------------- */

  function spawnNova(game, st) {
    var p = game.player;
    var d = rollDamage(game, st.damage);

    game.weapons.novas.push({
      x: p.x,
      y: p.y,
      r: 10,
      maxR: st.maxRadius * p.areaMul,
      speed: st.expandSpeed,
      damage: d.dmg,
      crit: d.crit,
      life: 1.4,
      hitIds: [],
      color: C.WEAPONS.nova.color
    });

    VS.Audio.play('nova');
    VS.Effects.burst(game.fx, p.x, p.y, C.WEAPONS.nova.color, 16, { speed: 220, life: 0.35, size: 3 });
  }

  function updateNovas(state, dt, game) {
    var list = state.novas;
    if (list.length === 0) return;

    var grid = game.world.grid;
    var scratch = game.world.scratch;

    for (var i = list.length - 1; i >= 0; i--) {
      var nv = list[i];

      nv.r += nv.speed * dt;
      nv.life -= dt;

      grid.queryCircle(nv.x, nv.y, nv.r, scratch);

      for (var j = 0; j < scratch.length; j++) {
        var e = scratch[j];
        if (e.dead) continue;
        if (nv.hitIds.indexOf(e.uid) >= 0) continue;

        var dist = U.dist(nv.x, nv.y, e.x, e.y);
        if (dist <= nv.r + e.radius) {
          nv.hitIds.push(e.uid);
          var kx = (e.x - nv.x), ky = (e.y - nv.y);
          var kl = Math.sqrt(kx * kx + ky * ky) || 1;
          VS.Enemies.hurt(game, e, nv.damage, nv.crit, (kx / kl) * 90, (ky / kl) * 90);
        }
      }

      if (nv.r >= nv.maxR || nv.life <= 0) U.swapRemove(list, i);
    }
  }

  /* ---------------- 对外接口 ---------------- */

  var Weapons = {

    create: function () {
      return {
        projectiles: [],
        novas: [],
        orbitAngle: 0,
        orbitBlades: [],
        auraPulse: null
      };
    },

    reset: function (state) {
      state.projectiles.length = 0;
      state.novas.length = 0;
      state.orbitBlades.length = 0;
      state.orbitAngle = 0;
      state.auraPulse = null;
    },

    has: function (player, id) {
      return !!getWeapon(player, id);
    },

    get: function (player, id) {
      return getWeapon(player, id);
    },

    /** 获得一把新武器（已拥有 / 武器栏已满 都会返回 false） */
    add: function (player, id) {
      if (!C.WEAPONS[id]) return false;
      if (getWeapon(player, id)) return false;
      if (player.weapons.length >= C.MAX_WEAPONS) return false;
      player.weapons.push({ id: id, level: 1, cd: 0 });
      return true;
    },

    /** 武器升级（已满级返回 false） */
    upgrade: function (player, id) {
      var w = getWeapon(player, id);
      if (!w) return false;
      if (w.level >= C.WEAPONS[id].maxLevel) return false;
      w.level++;
      return true;
    },

    canUpgrade: function (player, id) {
      var w = getWeapon(player, id);
      if (!w) return false;
      return w.level < C.WEAPONS[id].maxLevel;
    },

    /** 每帧推进：开火节奏 + 各类实体 */
    update: function (state, dt, game) {
      var p = game.player;

      /* --- 开火节奏（玩家死后不再开火） --- */
      if (p.alive) {
        for (var i = 0; i < p.weapons.length; i++) {
          var w = p.weapons[i];
          var def = C.WEAPONS[w.id];
          if (!def) continue;

          var st = def.stats(w.level);

          if (w.id === 'bolt') {
            w.cd -= dt;
            if (w.cd <= 0) {
              w.cd = st.cooldown / p.attackSpeedMul;
              fireBolt(game, w, st);
            }
          } else if (w.id === 'nova') {
            w.cd -= dt;
            if (w.cd <= 0) {
              w.cd = st.cooldown / p.attackSpeedMul;
              spawnNova(game, st);
            }
          } else if (w.id === 'garlic') {
            w.cd -= dt;
            if (w.cd <= 0) {
              w.cd = st.tick / p.attackSpeedMul;
              tickGarlic(game, w, st);
            }
          } else if (w.id === 'orbit') {
            updateOrbit(state, dt, game, w);
          }
        }
      }

      /* --- 已存在的实体继续推进（玩家死后也让它们飞完） --- */
      updateProjectiles(state, dt, game);
      updateNovas(state, dt, game);

      if (state.auraPulse) {
        state.auraPulse.life -= dt;
        if (state.auraPulse.life <= 0) state.auraPulse = null;
      }
    },

    /**
     * 宠物「德国的狼」用：从宠物位置按"玩家初始飞弹"的数值打一发。
     * 走 fireVolleyFrom 而不是自己造弹丸，这样射程判定、提前量、追踪、
     * 伤害增益与暴击都跟玩家武器完全一致。
     */
    firePetBolt: function (game, sx, sy) {
      var base = C.WEAPONS.bolt.stats(1);
      var st = {
        count: 1,
        damage: base.damage,
        speed: base.speed,
        radius: base.radius,
        pierce: base.pierce,
        noProjBonus: true,
        muzzle: 4,
        color: '#d9f0ff'
      };
      if (fireVolleyFrom(game, sx, sy, st) > 0) VS.Audio.play('shoot');
      return true;
    },

    /** 供 UI 显示：当前武器与等级 */
    listForUI: function (player) {
      var out = [];
      for (var i = 0; i < player.weapons.length; i++) {
        var w = player.weapons[i];
        var def = C.WEAPONS[w.id];
        out.push({ id: w.id, name: def.name, icon: def.icon, color: def.color, level: w.level });
      }
      return out;
    }
  };

  VS.register('Weapons', Weapons);

})(window.VS = window.VS || {});
