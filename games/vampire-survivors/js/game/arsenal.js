/* 八种扩展武器的实体与判定。分支只读 stats；所有持久实体均有容量和寿命上限。 */
(function (VS) {
  'use strict';
  var C = VS.Config, U = VS.Utils, L = C.ARSENAL_LIMITS;
  var pad = 0;
  Object.keys(C.ENEMY_TYPES).forEach(function (id) { pad = Math.max(pad, C.ENEMY_TYPES[id].radius); });
  var hits = [], targetHits = [], spreadHits = [];

  function insert(list, item, limit) {
    if (list.length >= limit) return false;
    list.push(item);
    return true;
  }
  function segmentDistance2(x, y, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? U.clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1) : 0;
    return U.dist2(x, y, ax + dx * t, ay + dy * t);
  }
  function query(game, x, y, radius, out) {
    game.world.grid.queryCircle(x, y, radius + pad, out);
    return out;
  }
  function targets(game, x, y, radius, count, focus) {
    query(game, x, y, radius, targetHits);
    var out = [], scores = [];
    for (var i = 0; i < targetHits.length; i++) {
      var e = targetHits[i], d = U.dist2(x, y, e.x, e.y);
      if (e.dead || d > radius * radius) continue;
      var score = d + (focus && !e.elite && !e.boss ? radius * radius + 1 : 0);
      var pos = out.length;
      while (pos > 0 && scores[pos - 1] > score) pos--;
      if (pos >= count) continue;
      out.splice(pos, 0, e); scores.splice(pos, 0, score);
      if (out.length > count) { out.pop(); scores.pop(); }
    }
    return out;
  }
  function aim(game, radius, focus) {
    var p = game.player, found = targets(game, p.x, p.y, radius, 1, focus);
    return found.length ? Math.atan2(found[0].y - p.y, found[0].x - p.x) : Math.atan2(p.facing.y, p.facing.x);
  }
  function hurt(game, e, damage, crit, kx, ky) {
    var before = e.hp;
    VS.Enemies.hurt(game, e, damage, crit, kx || 0, ky || 0);
    return Math.max(0, before - Math.max(0, e.hp));
  }
  function pull(e, x, y, distance) {
    if (e.dead || e.boss) return;
    var dx = x - e.x, dy = y - e.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.1) return;
    var step = distance >= 0 ? Math.min(distance, Math.max(0, len - 4)) : distance;
    e.x += dx / len * step; e.y += dy / len * step;
  }
  function blast(game, x, y, radius, damage, crit, st) {
    query(game, x, y, radius, hits);
    for (var i = 0; i < hits.length; i++) {
      var e = hits[i];
      if (e.dead || !U.circleHit(x, y, radius, e.x, e.y, e.radius)) continue;
      if (hurt(game, e, damage, crit) > 0 && st && st.slowMul) VS.Enemies.slow(e, st.slowMul, st.slowTime);
    }
  }
  function flash(state, x, y, radius, color) {
    insert(state.flashes, { x: x, y: y, r: radius, color: color, life: 0.3 }, 40);
  }
  function lineHit(game, x, y, angle, length, width, damage, crit, st) {
    var bx = x + Math.cos(angle) * length, by = y + Math.sin(angle) * length;
    query(game, (x + bx) / 2, (y + by) / 2, length / 2 + width, hits);
    for (var i = 0; i < hits.length; i++) {
      var e = hits[i];
      if (e.dead || segmentDistance2(e.x, e.y, x, y, bx, by) > Math.pow(width + e.radius, 2)) continue;
      var mul = st && st.executeBelow && e.hp <= e.maxHp * st.executeBelow ? 1 + st.executeBonus : 1;
      if (hurt(game, e, damage * mul, crit) > 0 && st && st.knockback && !e.boss) {
        pull(e, x, y, -st.knockback * (e.elite ? 0.3 : 1));
      }
    }
  }
  function shot(state, x, y, angle, st, damage, crit) {
    insert(state.projectiles, { x: x, y: y, vx: Math.cos(angle) * st.speed, vy: Math.sin(angle) * st.speed,
      r: st.radius, life: st.life, damage: damage, crit: crit, pierce: st.pierce || 1, hitIds: [],
      eliteBonus: st.eliteBonus || 0, color: st.color || '#8edbd4' }, L.projectiles);
  }
  function burn(state, e, damage, st, depth) {
    if (e.dead) return;
    for (var i = 0; i < state.burns.length; i++) {
      if (state.burns[i].enemy !== e) continue;
      var old = state.burns[i];
      old.life = Math.max(old.life, st.burnTime); old.damage = Math.max(old.damage, damage);
      if (st.spreadRadius && depth < (old.depth || 0)) { old.st = st; old.depth = depth; }
      return;
    }
    insert(state.burns, { enemy: e, damage: damage, st: st, depth: depth || 0, life: st.burnTime, cd: st.tick }, L.burns);
  }

  function cast(state, game, w, st) {
    var p = game.player, angle = aim(game, st.range || st.length || 450, st.focusElite);
    var roll = VS.Weapons.rollDamage(game, st.damage), i, a, count;
    if (w.id === 'sickle') {
      count = Math.min(12, st.count + p.projBonus);
      for (i = 0; i < count; i++) {
        a = angle + (i - (count - 1) / 2) * 0.22;
        insert(state.sickles, { x: p.x, y: p.y, angle: a, distance: 0, returning: false,
          life: st.life, hitOut: [], hitBack: [], healed: 0, st: st, damage: roll.dmg, crit: roll.crit }, L.sickles);
      }
    } else if (w.id === 'lance') {
      for (i = 0; i <= (st.echoes || 0); i++) {
        insert(state.slashes, { x: p.x, y: p.y, angle: angle, st: st, damage: roll.dmg, crit: roll.crit,
          delay: i * (st.echoDelay || 0), life: st.life, done: false }, L.slashes);
      }
      if (st.guardTime) p.invuln = Math.max(p.invuln, st.guardTime);
    } else if (w.id === 'mine') {
      for (i = 0; i < st.count; i++) {
        insert(state.mines, { x: p.x - p.facing.x * 25 + Math.cos(i * 2.4) * i * 14,
          y: p.y - p.facing.y * 25 + Math.sin(i * 2.4) * i * 14, arm: st.armTime, life: st.life,
          triggered: false, st: st, damage: roll.dmg, crit: roll.crit }, L.mines);
      }
    } else if (w.id === 'totem') {
      var found = targets(game, p.x, p.y, 330, 1);
      insert(state.totems, { x: found.length ? (p.x + found[0].x) / 2 : p.x,
        y: found.length ? (p.y + found[0].y) / 2 : p.y, life: st.life, cd: 0, st: st, staticHits: [] }, L.totems);
    } else if (w.id === 'drone') {
      count = Math.min(12, st.count + p.projBonus);
      for (i = 0; i < count; i++) {
        a = state.droneAngle + i * Math.PI * 2 / count;
        var dx = p.x + Math.cos(a) * st.orbitRadius, dy = p.y + Math.sin(a) * st.orbitRadius;
        var tgt = targets(game, dx, dy, st.range, 1, st.focusElite);
        if (!tgt.length) continue;
        a = Math.atan2(tgt[0].y - dy, tgt[0].x - dx);
        var shots = st.crossfire || 1;
        for (var j = 0; j < shots; j++) shot(state, dx, dy, a + (j - (shots - 1) / 2) * 0.12, st, roll.dmg, roll.crit);
      }
    } else if (w.id === 'gravity') {
      insert(state.orbs, { x: p.x, y: p.y, angle: angle, age: 0, cd: 0,
        life: st.life + (st.linger || 0), st: st, damage: roll.dmg, crit: roll.crit }, L.orbs);
    } else if (w.id === 'flame') {
      query(game, p.x, p.y, st.range, hits);
      var burnRoll = VS.Weapons.rollDamage(game, st.burnDamage);
      for (i = 0; i < hits.length; i++) {
        var e = hits[i], dist = Math.sqrt(U.dist2(p.x, p.y, e.x, e.y));
        var diff = Math.atan2(Math.sin(Math.atan2(e.y - p.y, e.x - p.x) - angle), Math.cos(Math.atan2(e.y - p.y, e.x - p.x) - angle));
        if (e.dead || dist > st.range + e.radius || Math.abs(diff) > st.angle / 2 + Math.asin(Math.min(1, e.radius / Math.max(1, dist)))) continue;
        if (hurt(game, e, roll.dmg, roll.crit) > 0) burn(state, e, burnRoll.dmg, st, 0);
      }
      insert(state.slashes, { x: p.x, y: p.y, angle: angle, st: st, cone: true, done: true, delay: 0, life: st.life }, L.slashes);
      if (st.scorchLife) insert(state.scorches, { x: p.x + Math.cos(angle) * st.range * 0.65,
        y: p.y + Math.sin(angle) * st.range * 0.65, r: st.scorchRadius * p.areaMul,
        life: st.scorchLife, cd: 0, tick: st.tick, damage: burnRoll.dmg * st.scorchDamageMul }, L.scorches);
    } else if (w.id === 'prism') {
      for (i = 0; i < st.beams + (st.backBeam ? 1 : 0); i++) {
        a = i === st.beams ? angle + Math.PI : angle + (i - (st.beams - 1) / 2) * 0.32;
        insert(state.beams, { angle: a, age: 0, life: st.duration, cd: 0, st: st }, L.beams);
      }
    }
  }

  function updateShots(state, dt, game) {
    for (var i = state.projectiles.length - 1; i >= 0; i--) {
      var pr = state.projectiles[i], ox = pr.x, oy = pr.y;
      pr.life -= dt; pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      var distance = Math.sqrt(U.dist2(ox, oy, pr.x, pr.y));
      query(game, (ox + pr.x) / 2, (oy + pr.y) / 2, distance / 2 + pr.r, hits);
      for (var j = 0; j < hits.length && pr.pierce > 0; j++) {
        var e = hits[j];
        if (e.dead || pr.hitIds.indexOf(e.uid) >= 0 || segmentDistance2(e.x, e.y, ox, oy, pr.x, pr.y) > Math.pow(pr.r + e.radius, 2)) continue;
        pr.hitIds.push(e.uid); pr.pierce--;
        hurt(game, e, pr.damage * (e.elite || e.boss ? 1 + pr.eliteBonus : 1), pr.crit);
      }
      if (pr.life <= 0 || pr.pierce <= 0) U.swapRemove(state.projectiles, i);
    }
  }
  function updateSickles(state, dt, game) {
    var p = game.player;
    for (var i = state.sickles.length - 1; i >= 0; i--) {
      var s = state.sickles[i], st = s.st, ox = s.x, oy = s.y;
      s.life -= dt;
      if (s.distance >= st.range) s.returning = true;
      if (s.returning) s.angle = Math.atan2(p.y - s.y, p.x - s.x);
      s.x += Math.cos(s.angle) * st.speed * dt; s.y += Math.sin(s.angle) * st.speed * dt;
      s.distance += st.speed * dt;
      var ids = s.returning ? s.hitBack : s.hitOut;
      query(game, (s.x + ox) / 2, (s.y + oy) / 2, st.radius * p.areaMul + st.speed * dt / 2, hits);
      for (var j = 0; j < hits.length && ids.length < 256; j++) {
        var e = hits[j];
        if (e.dead || ids.indexOf(e.uid) >= 0 || segmentDistance2(e.x, e.y, ox, oy, s.x, s.y) > Math.pow(st.radius * p.areaMul + e.radius, 2)) continue;
        ids.push(e.uid);
        if (hurt(game, e, s.damage, s.crit) <= 0) continue;
        if (st.pull) pull(e, s.x, s.y, st.pull);
        if (s.returning && st.healOnReturn && s.healed < st.healCap) {
          var heal = Math.min(st.healOnReturn, st.healCap - s.healed);
          VS.Player.heal(p, heal, game); s.healed += heal;
        }
      }
      if (s.life <= 0 || (s.returning && U.dist2(s.x, s.y, p.x, p.y) <= Math.pow(st.speed * dt + p.radius, 2))) U.swapRemove(state.sickles, i);
    }
  }
  function updateMines(state, dt, game) {
    for (var i = state.mines.length - 1; i >= 0; i--) {
      var m = state.mines[i], st = m.st;
      m.life -= dt; m.arm -= dt;
      if (m.arm <= 0 && !m.triggered) m.triggered = targets(game, m.x, m.y, st.triggerRadius, 1).length > 0;
      if (m.triggered && m.arm <= 0) {
        blast(game, m.x, m.y, st.radius * game.player.areaMul, m.damage, m.crit, st);
        flash(state, m.x, m.y, st.radius * game.player.areaMul, '#f6a37b');
        if (st.chainRadius) for (var j = 0; j < state.mines.length; j++) {
          var other = state.mines[j];
          if (other !== m && other.arm <= 0 && U.dist2(m.x, m.y, other.x, other.y) <= st.chainRadius * st.chainRadius) other.triggered = true;
        }
        for (var k = 0; k < (st.shards || 0); k++) shot(state, m.x, m.y, k * Math.PI * 2 / st.shards,
          { speed: 310, radius: 3, life: 0.85, pierce: 1, color: '#ffd0a5' }, m.damage * st.shardDamageMul, m.crit);
        VS.Audio.play('nova'); U.swapRemove(state.mines, i);
      } else if (m.life <= 0) U.swapRemove(state.mines, i);
    }
  }
  function updateTotems(state, dt, game) {
    for (var i = state.totems.length - 1; i >= 0; i--) {
      var t = state.totems[i], st = t.st, radius = st.radius * game.player.areaMul;
      t.life -= dt; t.cd -= dt;
      if (st.pullSpeed) {
        query(game, t.x, t.y, radius, hits);
        for (var k = 0; k < hits.length; k++) if (U.dist2(t.x, t.y, hits[k].x, hits[k].y) <= radius * radius) pull(hits[k], t.x, t.y, st.pullSpeed * dt);
      }
      if (t.cd <= 0) {
        t.cd = st.tick / game.player.attackSpeedMul;
        var found = targets(game, t.x, t.y, radius, st.targets);
        var roll = VS.Weapons.rollDamage(game, st.damage);
        for (var j = 0; j < found.length; j++) {
          var e = found[j], damage = roll.dmg;
          if (st.staticEvery) {
            var record = null;
            for (var h = 0; h < t.staticHits.length; h++) if (t.staticHits[h].uid === e.uid) record = t.staticHits[h];
            if (!record) {
              record = { uid: e.uid, count: 0 };
              if (t.staticHits.length >= 128) t.staticHits.shift();
              t.staticHits.push(record);
            }
            record.count++;
            if (record.count % st.staticEvery === 0) damage *= 1 + st.staticDamageMul;
          }
          hurt(game, e, damage, roll.crit);
          insert(state.arcs, { x: t.x, y: t.y - 15, bx: e.x, by: e.y, life: 0.14 }, 64);
        }
      }
      if (t.life <= 0) U.swapRemove(state.totems, i);
    }
  }
  function updateOrbs(state, dt, game) {
    for (var i = state.orbs.length - 1; i >= 0; i--) {
      var o = state.orbs[i], st = o.st, radius = st.radius * game.player.areaMul;
      o.age += dt; o.life -= dt; o.cd -= dt;
      if (o.age <= st.life) { o.x += Math.cos(o.angle) * st.speed * dt; o.y += Math.sin(o.angle) * st.speed * dt; }
      var direction = st.tidePeriod && Math.floor(o.age / st.tidePeriod) % 2 ? -1 : 1;
      query(game, o.x, o.y, radius, hits);
      for (var j = 0; j < hits.length; j++) {
        var e = hits[j];
        if (U.dist2(o.x, o.y, e.x, e.y) <= radius * radius) pull(e, o.x, o.y, st.pullSpeed * (st.tideStrength || 1) * direction * dt);
      }
      if (o.cd <= 0) {
        o.cd = st.tick / game.player.attackSpeedMul;
        blast(game, o.x, o.y, radius, o.damage, o.crit);
      }
      if (o.life <= 0) {
        if (st.collapseDamageMul) { blast(game, o.x, o.y, radius, o.damage * st.collapseDamageMul, o.crit); flash(state, o.x, o.y, radius, '#d7bdff'); }
        U.swapRemove(state.orbs, i);
      }
    }
  }
  function updateBurns(state, dt, game) {
    for (var i = state.burns.length - 1; i >= 0; i--) {
      var b = state.burns[i], e = b.enemy;
      b.life -= dt; b.cd -= dt;
      if (!e.dead && b.cd <= 0) { b.cd = b.st.tick; hurt(game, e, b.damage, false); }
      if (e.dead && b.st.spreadRadius && b.depth < b.st.spreadDepth) {
        query(game, e.x, e.y, b.st.spreadRadius, spreadHits);
        for (var j = 0; j < spreadHits.length; j++) {
          var other = spreadHits[j];
          if (!other.dead && U.dist2(e.x, e.y, other.x, other.y) <= b.st.spreadRadius * b.st.spreadRadius) burn(state, other, b.damage, b.st, b.depth + 1);
        }
      }
      if (e.dead || b.life <= 0) U.swapRemove(state.burns, i);
    }
  }
  function updateLines(state, dt, game) {
    for (var i = state.slashes.length - 1; i >= 0; i--) {
      var s = state.slashes[i];
      s.delay -= dt;
      if (s.delay > 0) continue;
      if (!s.done) {
        lineHit(game, s.x, s.y, s.angle, s.st.length * game.player.areaMul, s.st.width, s.damage, s.crit, s.st);
        s.done = true;
      }
      s.life -= dt;
      if (s.life <= 0) U.swapRemove(state.slashes, i);
    }
    for (var j = state.beams.length - 1; j >= 0; j--) {
      var b = state.beams[j]; b.age += dt; b.life -= dt; b.cd -= dt;
      if (b.cd <= 0) {
        var roll = VS.Weapons.rollDamage(game, b.st.damage);
        var a = b.angle + b.st.sweep * (b.age / b.st.duration - 0.5);
        lineHit(game, game.player.x, game.player.y, a, b.st.length * game.player.areaMul, b.st.width, roll.dmg, roll.crit);
        b.cd = b.st.tick / game.player.attackSpeedMul;
      }
      if (b.life <= 0) U.swapRemove(state.beams, j);
    }
    for (var k = state.scorches.length - 1; k >= 0; k--) {
      var sc = state.scorches[k]; sc.life -= dt; sc.cd -= dt;
      if (sc.cd <= 0) { blast(game, sc.x, sc.y, sc.r, sc.damage, false); sc.cd = sc.tick; }
      if (sc.life <= 0) U.swapRemove(state.scorches, k);
    }
  }

  function visible(v, x, y, r) { return VS.World.isVisible(v, x, y, r); }
  function circle(ctx, x, y, radius, color, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  }
  function beam(ctx, x, y, angle, length, width, color, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length); ctx.stroke();
  }
  var Arsenal = {
    create: function () { return { projectiles: [], sickles: [], mines: [], totems: [], orbs: [], beams: [],
      burns: [], scorches: [], slashes: [], flashes: [], arcs: [], droneAngle: 0, repairT: 5 }; },
    update: function (state, dt, game) {
      state.droneAngle += dt * 0.85;
      if (game.player.alive) for (var i = 0; i < game.player.weapons.length; i++) {
        var w = game.player.weapons[i], def = C.WEAPONS[w.id];
        if (!def || !def.arsenal) continue;
        var st = VS.Weapons.statsFor(game, w.id, w.level, w);
        w.cd -= dt;
        if (w.cd <= 0) { cast(state, game, w, st); w.cd = st.cooldown / game.player.attackSpeedMul; }
        if (w.id === 'drone' && st.repairEvery) {
          state.repairT -= dt;
          if (state.repairT <= 0) { VS.Player.heal(game.player, st.repairHp, game); state.repairT = st.repairEvery; }
        }
      }
      updateShots(state, dt, game); updateSickles(state, dt, game); updateMines(state, dt, game);
      updateTotems(state, dt, game); updateOrbs(state, dt, game); updateBurns(state, dt, game); updateLines(state, dt, game);
      ['flashes', 'arcs'].forEach(function (key) {
        for (var k = state[key].length - 1; k >= 0; k--) {
          state[key][k].life -= dt;
          if (state[key][k].life <= 0) U.swapRemove(state[key], k);
        }
      });
    },
    render: function (ctx, game, view, time, layer) {
      var state = game.weapons.extra;
      if (!state) return;
      var p = game.player, i, item;
      ctx.save(); ctx.lineWidth = 2;
      if (layer === 'ground') {
        for (i = 0; i < state.scorches.length; i++) {
          item = state.scorches[i];
          if (!visible(view, item.x, item.y, item.r)) continue;
          ctx.globalAlpha = 0.12; ctx.fillStyle = '#ff9672'; ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2); ctx.fill();
          circle(ctx, item.x, item.y, item.r * 0.9, '#ffb878', 0.6);
        }
        for (i = 0; i < state.mines.length; i++) {
          item = state.mines[i];
          if (!visible(view, item.x, item.y, 20)) continue;
          circle(ctx, item.x, item.y, 12, '#f6a37b', item.arm > 0 ? 0.3 : 0.9);
          ctx.strokeRect(item.x - 6, item.y - 6, 12, 12);
        }
        for (i = 0; i < state.totems.length; i++) {
          item = state.totems[i];
          if (!visible(view, item.x, item.y, item.st.radius * p.areaMul)) continue;
          circle(ctx, item.x, item.y, item.st.radius * p.areaMul, '#a9bfff', 0.12);
          ctx.globalAlpha = 1; ctx.fillStyle = '#a9bfff'; ctx.fillRect(item.x - 5, item.y - 24, 10, 24);
          circle(ctx, item.x, item.y - 24, 7, '#e0e7ff', 1);
        }
        for (i = 0; i < state.orbs.length; i++) {
          item = state.orbs[i];
          if (!visible(view, item.x, item.y, item.st.radius * p.areaMul)) continue;
          circle(ctx, item.x, item.y, item.st.radius * p.areaMul, '#bda3ee', 0.35);
          circle(ctx, item.x, item.y, 15 + Math.sin(time * 5) * 3, '#decaff', 0.95);
          ctx.globalAlpha = 0.8; ctx.fillStyle = '#483160'; ctx.beginPath(); ctx.arc(item.x, item.y, 10, 0, Math.PI * 2); ctx.fill();
        }
        for (i = 0; i < state.flashes.length; i++) { item = state.flashes[i]; circle(ctx, item.x, item.y, item.r * (1 - item.life), item.color, item.life * 2); }
      } else {
        for (i = 0; i < state.sickles.length; i++) {
          item = state.sickles[i];
          if (!visible(view, item.x, item.y, 25)) continue;
          ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(time * 12); ctx.strokeStyle = '#dac5ff'; ctx.globalAlpha = 0.95; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, item.st.radius * p.areaMul, 0, Math.PI * 1.35); ctx.stroke(); ctx.restore();
        }
        for (i = 0; i < state.projectiles.length; i++) {
          item = state.projectiles[i];
          if (!visible(view, item.x, item.y, item.r)) continue;
          ctx.globalAlpha = 1; ctx.fillStyle = item.color; ctx.fillRect(item.x - item.r, item.y - item.r, item.r * 2, item.r * 2);
        }
        for (i = 0; i < state.slashes.length; i++) {
          item = state.slashes[i];
          if (item.delay > 0) continue;
          if (item.cone) {
            ctx.globalAlpha = 0.28; ctx.fillStyle = '#ffa67b'; ctx.beginPath(); ctx.moveTo(item.x, item.y);
            ctx.arc(item.x, item.y, item.st.range, item.angle - item.st.angle / 2, item.angle + item.st.angle / 2); ctx.closePath(); ctx.fill();
          } else {
            beam(ctx, item.x, item.y, item.angle, item.st.length * p.areaMul, item.st.width, '#e6ba67', 0.4);
            beam(ctx, item.x, item.y, item.angle, item.st.length * p.areaMul, 3, '#fff3cb', 0.95);
          }
        }
        for (i = 0; i < state.beams.length; i++) {
          item = state.beams[i]; var angle = item.angle + item.st.sweep * (item.age / item.st.duration - 0.5);
          beam(ctx, p.x, p.y, angle, item.st.length * p.areaMul, item.st.width * 2, '#70d5df', 0.2);
          beam(ctx, p.x, p.y, angle, item.st.length * p.areaMul, 3, '#e2ffff', 0.85);
        }
        for (i = 0; i < state.arcs.length; i++) {
          item = state.arcs[i]; ctx.globalAlpha = item.life / 0.14; ctx.lineWidth = 2; ctx.strokeStyle = '#ccd8ff'; ctx.beginPath();
          ctx.moveTo(item.x, item.y); ctx.lineTo((item.x + item.bx) / 2 + 8, (item.y + item.by) / 2 - 6); ctx.lineTo(item.bx, item.by); ctx.stroke();
        }
        for (i = 0; i < state.burns.length; i++) {
          item = state.burns[i].enemy;
          if (!item.dead && visible(view, item.x, item.y, item.radius)) {
            ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffad67'; ctx.fillRect(item.x - 2, item.y - item.radius - 9 - Math.sin(time * 10) * 2, 4, 7);
          }
        }
        var drone = VS.Weapons.get(p, 'drone');
        if (drone) {
          var st = VS.Weapons.statsFor(game, 'drone', drone.level, drone), count = Math.min(12, st.count + p.projBonus);
          for (i = 0; i < count; i++) {
            var a = state.droneAngle + i * Math.PI * 2 / count, x = p.x + Math.cos(a) * st.orbitRadius, y = p.y + Math.sin(a) * st.orbitRadius;
            ctx.globalAlpha = 0.95; ctx.fillStyle = '#8edbd4'; ctx.fillRect(x - 5, y - 3, 10, 6); ctx.fillRect(x - 2, y - 6, 4, 12);
          }
        }
      }
      ctx.restore();
    },
    segmentDistance2: segmentDistance2
  };
  VS.register('Arsenal', Arsenal);
})(window.VS = window.VS || {});
