/* ===========================================================
   武器：弹道 / 光环 / 骨刃 / 新星 / 酸液 / 连锁 / 寒霜 / 陨星
   负责开火节奏、弹道推进、命中判定（基于世界空间网格）与伤害结算。
   玩家身上只存 [{id, level, cd}]，运行时实体（弹丸/冲击波）挂在 weapons 状态里。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;
  var enemyRadiusPad = 0;
  Object.keys(C.ENEMY_TYPES).forEach(function (id) {
    enemyRadiusPad = Math.max(enemyRadiusPad, C.ENEMY_TYPES[id].radius);
  });

  /* ---------------- 武器持有关系 ---------------- */

  function getWeapon(player, id) {
    for (var i = 0; i < player.weapons.length; i++) {
      if (player.weapons[i].id === id) return player.weapons[i];
    }
    return null;
  }

  function evolutionStatus(player, id) {
    var def = C.EVOLUTIONS[id];
    if (!def) return null;
    var w = getWeapon(player, id);
    var passiveLevel = VS.Player.upgradeLevel(player, def.passive);
    return {
      def: def, weapon: w,
      passiveLevel: passiveLevel,
      levelReady: !!w && w.level >= C.WEAPONS[id].maxLevel,
      ready: !!w && !w.evolved && w.level >= C.WEAPONS[id].maxLevel && passiveLevel >= def.passiveLevel,
      evolved: !!(w && w.evolved)
    };
  }

  /* ---------------- 伤害计算（含暴击） ---------------- */

  function rollDamage(game, base) {
    var p = game.player;
    var dmg = base * p.damageMul;
    if (p.hp <= p.maxHp * 0.5) dmg *= 1 + p.lastStandBonus;
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
        kind: 'bolt',
        ricochet: !!st.ricochet,
        color: st.color || C.WEAPONS.bolt.color
      });
    }

    return count;
  }

  function ricochetTarget(state, game, pr) {
    var nearby = state._ricochetHits || (state._ricochetHits = []);
    game.world.grid.queryCircle(pr.x, pr.y, 260, nearby, 64);
    var closest = null, best = 260 * 260;
    for (var i = 0; i < nearby.length; i++) {
      var e = nearby[i];
      if (e.dead || pr.hitIds.indexOf(e.uid) >= 0) continue;
      var d = U.dist2(pr.x, pr.y, e.x, e.y);
      if (d < best) { best = d; closest = e; }
    }
    return closest;
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

      grid.queryCircle(pr.x, pr.y, pr.r + enemyRadiusPad, scratch, 48);

      var consumed = false;
      for (var j = 0; j < scratch.length; j++) {
        var e = scratch[j];
        if (e.dead) continue;
        if (pr.hitIds.indexOf(e.uid) >= 0) continue;
        if (!U.circleHit(pr.x, pr.y, pr.r, e.x, e.y, e.radius)) continue;

        pr.hitIds.push(e.uid);
        VS.Enemies.hurt(game, e, pr.damage, pr.crit, pr.vx * 0.12, pr.vy * 0.12);
        if (pr.slowMul) VS.Enemies.slow(e, pr.slowMul, pr.slowTime);
        if (pr.shatterRadius) {
          damageArea(game, pr.x, pr.y, pr.shatterRadius, pr.damage * pr.shatterDamageMul,
            pr.crit, pr.slowMul, pr.slowTime);
          addBlast(state, pr.x, pr.y, pr.shatterRadius, pr.color, true);
        }

        pr.pierce--;
        if (pr.pierce <= 0) { consumed = true; break; }
        if (pr.ricochet) {
          pr.target = ricochetTarget(state, game, pr);
          if (pr.target) {
            pr.angle = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
            pr.vx = Math.cos(pr.angle) * pr.speed;
            pr.vy = Math.sin(pr.angle) * pr.speed;
          }
        }
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

      var before = e.hp;
      var d = rollDamage(game, st.damage);
      VS.Enemies.hurt(game, e, d.dmg, d.crit, 0, 0);
      if (st.slowMul) VS.Enemies.slow(e, st.slowMul, st.slowTime);
      if (e.hp < before) hits++;
    }

    // 让渲染层画出一次脉冲
    state.auraPulse = { x: p.x, y: p.y, r: radius, life: 0.22, maxLife: 0.22, color: st.color };
    if (hits > 0 && st.healPerTarget) VS.Player.heal(p, Math.min(st.healCap, hits * st.healPerTarget), game);

    if (hits > 0) VS.Audio.play('hit');
  }

  /* ---------------- 环绕骨刃 ---------------- */

  function updateOrbit(state, dt, game, w, stIn) {
    var p = game.player;
    /* 等级数值由调用方算好传进来（要走 statsFor 才能吃到关卡加成与流派加成） */
    var st = stIn || statsFor(game, 'orbit', w.level, w);
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

  /* ---------------- 关卡加成 + 流派加成 ----------------
     三种加成**全部在这一个函数里施加**（所有武器、所有开火逻辑都从这里取数值）：
       · 玩家技能伤害倍率 C.LEVELS[i].playerDmgMul —— 第二关所有技能 ×1.25
       · 单件武器的关卡倍率 C.LEVELS[i].weaponMul —— 第二关 orbit / garlic ×1.5
       · 流派增益：层数记在武器对象上（w.school + w.schoolXxx）
     开火逻辑一律走 statsFor，不要再直接 def.stats()，否则任何一条加成一加就漏。 */

  function statsFor(game, id, level, weapon) {
    var def = C.WEAPONS[id];
    if (!def) return null;

    var src = def.stats(level);
    var w = weapon || null;
    var mul = (game && VS.Levels) ? VS.Levels.weaponMul(game.level, id) : 1;
    var dmgAll = (game && VS.Levels) ? VS.Levels.playerDmgMul(game.level) : 1;

    var out = src;
    if (mul !== 1 || dmgAll !== 1 || (w && (w.school || w.schoolId || w.evolved))) {
      out = {};
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }

    if (w && w.evolved && C.EVOLUTIONS[id]) C.EVOLUTIONS[id].apply(out);
    if (w && w.schoolId && C.SCHOOLS && C.SCHOOLS[w.schoolId] && C.SCHOOLS[w.schoolId].weapon === id) {
      C.SCHOOLS[w.schoolId].apply(out, Math.min(3, w.schoolRank || 1));
    }

    /* 关卡倍率：伤害（含"全技能加强"）与范围，数量不动 */
    if (mul !== 1 || dmgAll !== 1) {
      if (out.damage !== undefined) out.damage *= mul * dmgAll;
      if (out.burnDamage !== undefined) out.burnDamage *= mul * dmgAll;
      if (out.radius !== undefined) out.radius *= mul;
      if (out.maxRadius !== undefined) out.maxRadius *= mul;
    }

    /* 流派加成：每个字段独立判断，加新流派只要在 config 的 school.apply 里改一个字段 */
    if (w && w.school) {
      if (w.schoolPierce && out.pierce !== undefined) out.pierce += w.schoolPierce;
      if (w.schoolBlades && out.count !== undefined) out.count += w.schoolBlades;
      if (w.schoolChains && out.chains !== undefined) out.chains += w.schoolChains;
      if (w.schoolProjectiles && out.count !== undefined) out.count += w.schoolProjectiles;
      if (w.schoolSlowTime && out.slowTime !== undefined) out.slowTime += w.schoolSlowTime;
      if (w.schoolArea) {
        if (out.radius !== undefined) out.radius *= 1 + w.schoolArea;
        if (out.maxRadius !== undefined) out.maxRadius *= 1 + w.schoolArea;
      }
      if (w.schoolDmg && out.damage !== undefined) out.damage *= 1 + w.schoolDmg;
      if (w.schoolCd && out.cooldown !== undefined) out.cooldown *= Math.max(0.3, 1 - w.schoolCd);
      if (w.schoolLife && out.life !== undefined) out.life += w.schoolLife;
      if (w.schoolSpeed && out.spin !== undefined) out.spin *= 1 + w.schoolSpeed;
      if (w.schoolRange && out.range !== undefined) out.range *= 1 + w.schoolRange;
    }

    /* 环绕骨刃的"范围形态"（E 键切换）：只动半径与转速，伤害不变 */
    if (id === 'orbit' && game && game.orbitMode !== undefined) {
      var om = orbitMode(game.orbitMode);
      if (out.radius !== undefined) out.radius *= om.radiusMul;
      if (out.spin !== undefined) out.spin *= om.spinMul;
    }

    return out;
  }

  /** 取环绕骨刃的形态定义（下标越界会被夹住） */
  function orbitMode(index) {
    var list = C.ORBIT_MODES || [{ id: 'close', radiusMul: 1, spinMul: 1 }];
    var i = Math.floor(index || 0);
    if (i < 0) i = 0;
    if (i >= list.length) i = list.length - 1;
    return list[i];
  }

  /* ---------------- 第二关专属：柠檬喷射器（往敌人脚下糊一滩酸） ---------------- */

  function fireAcidSpray(game, w, st) {
    var p = game.player;
    var targets = nearestEnemies(game, p.x, p.y, 1, st.range * st.range);
    if (targets.length === 0) return false;

    var t = targets[0];
    var roll = rollDamage(game, st.damage);

    VS.Enemies.spawnPool(game.enemies, game, {
      x: t.x, y: t.y,
      radius: st.radius * p.areaMul,
      life: st.life,
      tick: st.tick,
      damage: roll.dmg,
      side: 'player',
      warn: 0.25,                 // 很短的前摇：看得见"啪"一下落下来
      acc: 0
    });

    VS.Effects.burst(game.fx, t.x, t.y, '#c7f24a', 12, { speed: 170, life: 0.45, size: 3 });
    VS.Audio.play('shoot');
    return true;
  }

  /* ---------------- 第二关专属：雷击链 ---------------- */

  function fireChain(game, w, st) {
    var p = game.player;
    var hits = [];
    var first = nearestEnemies(game, p.x, p.y, 1, st.range * st.range);
    if (first.length === 0) return false;

    var current = first[0];
    var pts = [{ x: p.x, y: p.y }];

    for (var i = 0; i < st.chains && current; i++) {
      hits.push(current);
      pts.push({ x: current.x, y: current.y });

      var roll = rollDamage(game, st.damage);
      VS.Enemies.hurt(game, current, roll.dmg, roll.crit, (current.x - p.x) * 0.05, (current.y - p.y) * 0.05);
      VS.Effects.burst(game.fx, current.x, current.y, '#ffe066', 8, { speed: 150, life: 0.3, size: 2.8 });

      /* 找下一跳：离当前目标最近、且没打过的 */
      var next = null, bestD = st.jump * st.jump;
      var list = game.enemies.list;
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (e.dead || hits.indexOf(e) >= 0) continue;
        var d = U.dist2(current.x, current.y, e.x, e.y);
        if (d < bestD) { bestD = d; next = e; }
      }
      current = next;
    }

    /* 折线交给渲染层画（只存点 + 寿命，零额外开销） */
    game.weapons.bolts.push({ pts: pts, life: 0.16, maxLife: 0.16 });
    VS.Audio.play('nova');
    return true;
  }

  /* ---------------- 寒霜与陨星 ---------------- */

  function addBlast(state, x, y, radius, color, icy) {
    if (state.blasts.length >= C.WEAPON_EFFECTS.MAX_BLASTS) return;
    state.blasts.push({ x: x, y: y, r: radius, color: color, icy: icy, life: 0.4, maxLife: 0.4 });
  }

  function damageArea(game, x, y, radius, damage, crit, slowMul, slowTime) {
    // 独立于弹道查询的 scratch，冰锥碎裂不会覆盖外层命中列表。
    var found = game.weapons._areaHits || (game.weapons._areaHits = []);
    game.world.grid.queryCircle(x, y, radius + enemyRadiusPad, found);
    for (var i = 0; i < found.length; i++) {
      var e = found[i];
      if (e.dead || !U.circleHit(x, y, radius, e.x, e.y, e.radius)) continue;
      VS.Enemies.hurt(game, e, damage, crit, e.x - x, e.y - y);
      if (slowMul) VS.Enemies.slow(e, slowMul, slowTime);
    }
  }

  function fireFrost(game, st) {
    var p = game.player;
    var range = st.speed * st.life;
    var targets = nearestEnemies(game, p.x, p.y, 1, range * range);
    if (!targets.length) return false;
    var angle = Math.atan2(targets[0].y - p.y, targets[0].x - p.x);
    var count = st.count + p.projBonus;
    var spread = Math.min(0.95, (count - 1) * 0.16);
    for (var i = 0; i < count; i++) {
      var a = angle + (count > 1 ? (i / (count - 1) - 0.5) * spread : 0);
      var roll = rollDamage(game, st.damage);
      game.weapons.projectiles.push({
        x: p.x + Math.cos(a) * (p.radius + 8), y: p.y + Math.sin(a) * (p.radius + 8),
        vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, speed: st.speed,
        angle: a, r: st.radius, damage: roll.dmg, crit: roll.crit,
        pierce: st.pierce, life: st.life, hitIds: [], kind: 'frost',
        slowMul: st.slowMul, slowTime: st.slowTime,
        shatterRadius: (st.shatterRadius || 0) * p.areaMul,
        shatterDamageMul: st.shatterDamageMul,
        color: st.color || C.WEAPONS.frost.color
      });
    }
    VS.Audio.play('shoot');
    return true;
  }

  function fireMeteor(game, st) {
    var p = game.player;
    var count = st.count + p.projBonus;
    var targets = nearestEnemies(game, p.x, p.y, count, st.range * st.range);
    if (!targets.length) return false;
    for (var i = 0; i < count && game.weapons.meteors.length < C.WEAPON_EFFECTS.MAX_METEORS; i++) {
      var target = targets[i % targets.length];
      var roll = rollDamage(game, st.damage);
      var offset = i >= targets.length ? 20 : 0;
      var delay = st.warning + i * 0.12;
      game.weapons.meteors.push({
        x: target.x + Math.cos(i * 2.4) * offset,
        y: target.y + Math.sin(i * 2.4) * offset,
        r: st.radius * p.areaMul, damage: roll.dmg, crit: roll.crit,
        delay: delay, maxDelay: delay, landed: false,
        life: 0.38 + (st.aftershock || 0), maxLife: 0.38 + (st.aftershock || 0),
        aftershockT: st.aftershock || 0, aftershockMul: st.aftershockMul || 0,
        aftershockRadiusMul: st.aftershockRadiusMul || 1,
        color: st.color || C.WEAPONS.meteor.color
      });
    }
    return true;
  }

  function updateMeteors(state, dt, game) {
    for (var i = state.meteors.length - 1; i >= 0; i--) {
      var m = state.meteors[i];
      if (!m.landed) {
        m.delay -= dt;
        if (m.delay > 0) continue;
        m.landed = true;
        damageArea(game, m.x, m.y, m.r, m.damage, m.crit);
        addBlast(state, m.x, m.y, m.r, m.color, false);
        VS.Effects.burst(game.fx, m.x, m.y, m.color, 14, { speed: 180, life: 0.4, size: 3 });
        VS.Audio.play('nova');
      } else {
        m.life -= dt;
        if (m.aftershockT > 0) {
          m.aftershockT -= dt;
          if (m.aftershockT <= 0) {
            damageArea(game, m.x, m.y, m.r * m.aftershockRadiusMul, m.damage * m.aftershockMul, m.crit);
            addBlast(state, m.x, m.y, m.r * m.aftershockRadiusMul, '#fff1d4', false);
            VS.Audio.play('hit');
          }
        }
        if (m.life <= 0) U.swapRemove(state.meteors, i);
      }
    }
  }

  /* ---------------- 对外接口 ---------------- */

  var Weapons = {

    create: function () {
      return {
        projectiles: [],
        novas: [],
        bolts: [],            // 雷击链的折线（只存点，渲染层画）
        meteors: [],
        blasts: [],
        extra: VS.Arsenal ? VS.Arsenal.create() : null,
        orbitAngle: 0,
        orbitBlades: [],
        auraPulse: null
      };
    },

    reset: function (state) {
      state.projectiles.length = 0;
      state.novas.length = 0;
      state.bolts.length = 0;
      state.meteors.length = 0;
      state.blasts.length = 0;
      state.extra = VS.Arsenal ? VS.Arsenal.create() : null;
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

    evolutionStatus: evolutionStatus,

    chooseSchool: function (player, weaponId, schoolId) {
      var w = getWeapon(player, weaponId);
      var school = C.SCHOOLS && C.SCHOOLS[schoolId];
      if (!w || !school || school.weapon !== weaponId ||
          (w.schoolId && w.schoolId !== schoolId) || (w.schoolRank || 0) >= school.max) return false;
      w.schoolId = schoolId;
      w.schoolRank = (w.schoolRank || 0) + 1;
      w.cd = 0;
      return true;
    },

    rollDamage: rollDamage,

    evolve: function (player, id) {
      var status = evolutionStatus(player, id);
      if (!status || !status.ready) return false;
      status.weapon.evolved = true;
      status.weapon.cd = 0;
      return true;
    },

    /** 每帧推进：开火节奏 + 各类实体 */
    update: function (state, dt, game) {
      var p = game.player;

      /* --- 开火节奏（玩家死后不再开火） --- */
      if (p.alive) {
        for (var i = 0; i < p.weapons.length; i++) {
          var w = p.weapons[i];
          var def = C.WEAPONS[w.id];
          if (!def || def.arsenal) continue;

          var st = statsFor(game, w.id, w.level, w);
          if (!st) continue;

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
            updateOrbit(state, dt, game, w, st);
          } else if (w.id === 'acidSpray') {
            w.cd -= dt;
            if (w.cd <= 0) {
              w.cd = st.cooldown / p.attackSpeedMul;
              fireAcidSpray(game, w, st);
            }
          } else if (w.id === 'chain') {
            w.cd -= dt;
            if (w.cd <= 0) {
              w.cd = st.cooldown / p.attackSpeedMul;
              fireChain(game, w, st);
            }
          } else if (w.id === 'frost' || w.id === 'meteor') {
            w.cd -= dt;
            if (w.cd <= 0) {
              var fired = w.id === 'frost' ? fireFrost(game, st) : fireMeteor(game, st);
              if (fired) w.cd = st.cooldown / p.attackSpeedMul;
            }
          }
        }
      }

      /* --- 已存在的实体继续推进（玩家死后也让它们飞完） --- */
      updateProjectiles(state, dt, game);
      updateNovas(state, dt, game);
      updateMeteors(state, dt, game);
      if (VS.Arsenal) {
        if (!state.extra) state.extra = VS.Arsenal.create();
        VS.Arsenal.update(state.extra, dt, game);
      }
      for (var f = state.blasts.length - 1; f >= 0; f--) {
        state.blasts[f].life -= dt;
        if (state.blasts[f].life <= 0) U.swapRemove(state.blasts, f);
      }

      /* 雷击折线只是视觉，寿命到了就丢 */
      for (var b = state.bolts.length - 1; b >= 0; b--) {
        state.bolts[b].life -= dt;
        if (state.bolts[b].life <= 0) U.swapRemove(state.bolts, b);
      }

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
        var display = w.evolved && C.EVOLUTIONS[w.id] ? C.EVOLUTIONS[w.id] : def;
        var branch = C.SCHOOLS && C.SCHOOLS[w.schoolId];
        out.push({ id: w.id, name: display.name, icon: display.icon, color: display.color, level: w.level,
          evolved: !!w.evolved, school: branch ? branch.name : (def.school && w.school ? def.school.name : ''),
          schoolRank: branch ? w.schoolRank : (w.school || 0) });
      }
      return out;
    },

    /** 关卡加成后的等级数值（测试与调试用） */
    _statsFor: statsFor,
    statsFor: statsFor,

    /** 环绕骨刃当前的形态（UI 用） */
    orbitMode: orbitMode,
  };

  VS.register('Weapons', Weapons);

})(window.VS = window.VS || {});
