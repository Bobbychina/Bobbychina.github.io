/* 新敌人与首领：有界弹幕、可躲避预警、冲锋与护盾行为。渲染由 chapter-art.js 负责。 */
(function (VS) {
  'use strict';
  var C = VS.Config, U = VS.Utils;
  var LIMIT = C.ENCOUNTER_LIMITS || { shots: 180, zones: 48, rings: 14, beams: 12 };
  var nearby = [];
  function put(state, key, item) {
    if (state[key].length >= LIMIT[key]) return false;
    state[key].push(item); return true;
  }
  function direction(e, p) { return Math.atan2(p.y - e.y, p.x - e.x); }
  function move(e, angle, speed, dt) {
    var slow = e.slowT > 0 ? e.slowMul : 1;
    e.vx = Math.cos(angle) * speed * slow; e.vy = Math.sin(angle) * speed * slow;
    e.x += e.vx * dt; e.y += e.vy * dt;
  }
  function shot(game, e, angle, speed, damage, color) {
    return put(game.encounters, 'shots', { x: e.x, y: e.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: 5, damage: damage, life: 5, color: color || e.edge, owner: e.uid });
  }
  function fan(game, e, angle, count, arc, speed, damage) {
    for (var i = 0; i < count; i++) shot(game, e, angle + (count === 1 ? 0 : (i / (count - 1) - 0.5) * arc), speed, damage);
  }
  function area(game, x, y, r, damage, delay, life, color, owner) {
    return put(game.encounters, 'zones', { x: U.clamp(x, 60, game.world.w - 60), y: U.clamp(y, 60, game.world.h - 60),
      r: r, damage: damage, delay: delay, warning: delay, life: life, maxLife: life, color: color, owner: owner, cd: 0 });
  }
  function beam(game, x, y, angle, length, width, damage, delay, life, sweep, color, owner) {
    return put(game.encounters, 'beams', { x: x, y: y, angle: angle, length: length, width: width,
      damage: damage, delay: delay, warning: delay, life: life, maxLife: life,
      sweep: sweep || 0, color: color, owner: owner });
  }
  function ring(game, e, delay, gap, phase) {
    return put(game.encounters, 'rings', { x: e.x, y: e.y, r: 38, speed: 135 + phase * 8, width: 10,
      damage: e.damage * 0.65, delay: delay, warning: delay, life: 4.2, gap: gap, gapSize: 0.95,
      owner: e.uid, color: e.edge });
  }
  function bossCast(e, game, ai) {
    var p = game.player, angle = ai.angle, phase = ai.phase, turn = ai.turn % 3, i;
    if (e.encounter === 'bell') {
      if (turn === 0) for (i = 0; i < 2 + (phase > 1 ? 1 : 0); i++) ring(game, e, i * 0.48, angle + 0.65 + i * 0.3, phase);
      if (turn === 1) fan(game, e, angle, 7 + phase * 2, 1.25, 190, e.damage * 0.65);
      if (turn === 2) {
        for (i = 0; i < 3 + phase; i++) {
          var a = i * U.TAU / (3 + phase);
          area(game, p.x + Math.cos(a) * 105, p.y + Math.sin(a) * 105, 46, e.damage * 0.6, 0.9, 0.4, '#9ae3ef', e.uid);
        }
      }
    } else if (e.encounter === 'queen') {
      if (turn === 0) for (i = 0; i < 4; i++) beam(game, e.x, e.y, angle + Math.PI / 4 + i * Math.PI / 2,
        620, 22, e.damage * 0.65, 1.0, 1.4, phase > 1 ? 0.18 : 0, '#a7eafa', e.uid);
      if (turn === 1) { ring(game, e, 0.3, angle - 0.6, phase); ring(game, e, 0.95, angle + 0.6, phase); }
      if (turn === 2) for (i = 0; i < 5 + phase; i++) area(game,
        p.x + Math.cos(i * 2.4) * (i ? 110 : 0), p.y + Math.sin(i * 2.4) * (i ? 110 : 0),
        48, e.damage * 0.6, 0.85 + i * 0.12, 0.45, '#b5efff', e.uid);
    } else if (e.encounter === 'colossus') {
      if (turn === 0) beam(game, e.x, e.y, angle - 0.75, 680, 27, e.damage * 0.7, 1.0, 1.8, 0.85, '#ffad66', e.uid);
      if (turn === 1) for (i = 0; i < 5 + phase; i++) area(game,
        p.x + Math.cos(i * 2.4) * (i ? 130 : 0), p.y + Math.sin(i * 2.4) * (i ? 130 : 0),
        62, e.damage * 0.65, 0.9 + i * 0.1, 1.8, '#ff9763', e.uid);
      if (turn === 2) {
        fan(game, e, angle - 0.32, 5 + phase, 0.6, 210, e.damage * 0.6);
        fan(game, e, angle + 0.32, 5 + phase, 0.6, 165, e.damage * 0.6);
      }
    }
    ai.turn++; ai.cd = phase > 1 ? 2.2 : 3.2;
  }
  function bossMove(e, dt, game) {
    var ai = e.encounterAI;
    ai.phase = e.hp <= e.maxHp * 0.5 ? 2 : 1;
    if (ai.stun > 0) { ai.stun = Math.max(0, ai.stun - dt); return true; }
    if (ai.windup > 0) {
      ai.windup -= dt;
      if (ai.windup <= 0) bossCast(e, game, ai);
    } else {
      ai.cd -= dt;
      if (ai.cd <= 0) { ai.angle = direction(e, game.player); ai.windup = ai.phase > 1 ? 0.7 : 1.0; }
      if (U.dist2(e.x, e.y, game.player.x, game.player.y) > 170 * 170) move(e, direction(e, game.player), e.speed, dt);
    }
    return true;
  }
  function ordinaryMove(e, dt, game) {
    var role = e.behavior, s = e.traits, p = game.player, def = C.ENEMY_TYPES[e.type];
    var d2 = U.dist2(e.x, e.y, p.x, p.y), a = direction(e, p);
    s.age += dt; s.cd -= dt; s.broken = Math.max(0, s.broken - dt);
    if (role === 'warder') {
      s.guard = s.broken <= 0 && s.age % 4.5 < 2;
      if (s.guard && p.dashT > 0 && d2 < 110 * 110) {
        s.broken = 3; s.guard = false; s.stun = 0.65;
        VS.Effects.burst(game.fx, e.x, e.y, '#c7f5ff', 8, { speed: 100, life: 0.3, size: 3 });
      }
      if (s.stun > 0) { s.stun -= dt; return true; }
    } else if (role === 'charger') {
      var opt = def.behaviorConfig || { cooldown: 3, windup: 0.6, speed: 330, dashes: 1 };
      if (s.mode === 'walk' && s.cd <= 0 && d2 < 430 * 430) {
        s.mode = 'windup'; s.t = opt.windup; s.angle = a; s.left = opt.dashes;
      }
      if (s.mode === 'windup') {
        s.t -= dt;
        if (s.t <= 0) { s.mode = 'dash'; s.t = 0.42; }
        return true;
      }
      if (s.mode === 'dash') {
        move(e, s.angle, opt.speed, dt); s.t -= dt;
        if (s.t <= 0) {
          s.left--;
          if (s.left > 0) { s.mode = 'windup'; s.angle = a; s.t = 0.3; }
          else { s.mode = 'walk'; s.cd = opt.cooldown; }
        }
        return true;
      }
    } else if (role === 'archer') {
      if (s.mode === 'windup') {
        s.t -= dt;
        if (s.t <= 0) { fan(game, e, s.angle, 3, 0.22, 225, e.damage * 0.65); s.mode = 'walk'; s.cd = 3.0; }
        return true;
      }
      if (s.cd <= 0 && d2 < 600 * 600) { s.mode = 'windup'; s.t = 0.65; s.angle = a; return true; }
      if (d2 < 210 * 210) move(e, a + Math.PI, e.speed * 0.8, dt);
      else if (d2 > 340 * 340) move(e, a, e.speed, dt);
      return true;
    } else if (role === 'caster') {
      if (s.cd <= 0 && d2 < 550 * 550) {
        area(game, p.x + (p.moving ? p.facing.x * 50 : 0), p.y + (p.moving ? p.facing.y * 50 : 0),
          52, e.damage * 0.7, 1.0, 0.6, '#ffa574', e.uid); s.cd = 3.8;
      }
    } else if (role === 'healer') {
      if (s.cd <= 0) {
        s.cd = 4; s.pulse = 0.35;
        game.world.grid.queryCircle(e.x, e.y, 155, nearby, 18);
        var healed = 0;
        for (var i = 0; i < nearby.length && healed < 6; i++) {
          var ally = nearby[i];
          if (ally === e || ally.dead || ally.boss || ally.hp >= ally.maxHp || U.dist2(e.x, e.y, ally.x, ally.y) > 155 * 155) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + Math.min(40, ally.maxHp * 0.08)); healed++;
        }
      }
      s.pulse = Math.max(0, (s.pulse || 0) - dt);
    } else if (role === 'bomber') {
      if (s.mode === 'windup') {
        s.t -= dt;
        if (s.t <= 0) { area(game, e.x, e.y, 65, e.damage * 1.3, 0, 0.25, '#ffb06e', e.uid); VS.Enemies.kill(game, e); }
        return true;
      }
      if (d2 < 90 * 90) { s.mode = 'windup'; s.t = 0.9; return true; }
    }
    return false;
  }
  function segmentD2(x, y, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    var t = len > 0 ? U.clamp(((x - ax) * dx + (y - ay) * dy) / len, 0, 1) : 0;
    return U.dist2(x, y, ax + t * dx, ay + t * dy);
  }
  function damage(game, amount, x, y) { VS.Player.takeDamage(game.player, amount, game, x, y); }
  function clearOwned(game, uid) {
    Object.keys(LIMIT).forEach(function (key) {
      var list = game.encounters[key];
      for (var i = list.length - 1; i >= 0; i--) if (list[i].owner === uid) U.swapRemove(list, i);
    });
  }
  var Encounters = {
    create: function () { return { shots: [], zones: [], rings: [], beams: [] }; },
    attach: function (e) {
      var def = C.ENEMY_TYPES[e.type];
      if (!def) return;
      if (def.behavior) { e.behavior = def.behavior; e.traits = { age: 0, cd: 1 + (e.uid % 7) * 0.17,
        mode: 'walk', t: 0, angle: 0, broken: 0, guard: def.behavior === 'warder', stun: 0 }; }
      if (def.encounter) { e.encounter = def.encounter; e.noKit = true;
        e.encounterAI = { cd: 2.0, windup: 0, turn: 0, angle: 0, phase: 1, stun: 0 }; }
    },
    move: function (e, dt, game) {
      if (e.encounter) return bossMove(e, dt, game);
      return e.behavior ? ordinaryMove(e, dt, game) : false;
    },
    damageMul: function (e) { return e.traits && e.traits.guard ? 0.3 : e.encounterAI && e.encounterAI.stun > 0 ? 1.35 : 1; },
    onKill: function (game, e) {
      if (e.behavior === 'splitter') for (var i = 0; i < 2; i++) {
        if (game.enemies.list.length >= C.SPAWN.MAX_ENEMIES) break;
        VS.Enemies.spawn(game.enemies, C.ENEMY_TYPES.cinderling, game, { x: e.x + (i ? 18 : -18), y: e.y + 8 });
      }
      if (e.encounter) clearOwned(game, e.uid);
    },
    staggerBoss: function (game, seconds) {
      var boss = game.enemies.boss;
      if (!boss || !boss.encounterAI || boss.encounter !== 'colossus') return false;
      clearOwned(game, boss.uid);
      boss.encounterAI.stun = seconds; boss.encounterAI.windup = 0; boss.encounterAI.cd = 2;
      return true;
    },
    area: area, beam: beam, ring: ring, shot: shot, segmentD2: segmentD2,
    update: function (state, dt, game) {
      var p = game.player, i, item;
      for (i = state.shots.length - 1; i >= 0; i--) {
        item = state.shots[i]; var ox = item.x, oy = item.y;
        item.x += item.vx * dt; item.y += item.vy * dt; item.life -= dt;
        if (segmentD2(p.x, p.y, ox, oy, item.x, item.y) <= Math.pow(item.r + p.radius, 2)) {
          damage(game, item.damage, item.x, item.y); U.swapRemove(state.shots, i);
        } else if (item.life <= 0) U.swapRemove(state.shots, i);
      }
      for (i = state.zones.length - 1; i >= 0; i--) {
        item = state.zones[i]; item.delay -= dt;
        if (item.delay > 0) continue;
        item.life -= dt; item.cd -= dt;
        if (item.cd <= 0) {
          item.cd = 0.6;
          if (U.circleHit(p.x, p.y, p.radius, item.x, item.y, item.r)) damage(game, item.damage, item.x, item.y);
        }
        if (item.life <= 0) U.swapRemove(state.zones, i);
      }
      for (i = state.rings.length - 1; i >= 0; i--) {
        item = state.rings[i]; item.delay -= dt;
        if (item.delay > 0) continue;
        item.r += item.speed * dt; item.life -= dt;
        var a = Math.atan2(p.y - item.y, p.x - item.x);
        var diff = Math.atan2(Math.sin(a - item.gap), Math.cos(a - item.gap));
        if (Math.abs(Math.sqrt(U.dist2(p.x, p.y, item.x, item.y)) - item.r) <= item.width + p.radius && Math.abs(diff) > item.gapSize / 2) damage(game, item.damage, item.x, item.y);
        if (item.life <= 0) U.swapRemove(state.rings, i);
      }
      for (i = state.beams.length - 1; i >= 0; i--) {
        item = state.beams[i]; item.delay -= dt;
        if (item.delay > 0) continue;
        item.angle += item.sweep * dt; item.life -= dt;
        if (segmentD2(p.x, p.y, item.x, item.y, item.x + Math.cos(item.angle) * item.length,
          item.y + Math.sin(item.angle) * item.length) <= Math.pow(item.width / 2 + p.radius, 2)) damage(game, item.damage, item.x, item.y);
        if (item.life <= 0) U.swapRemove(state.beams, i);
      }
    }
  };
  VS.register('Encounters', Encounters);
})(window.VS = window.VS || {});
