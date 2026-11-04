/* 章节环境与额外遗物选择。只在新章节生效，跨关构筑由 Game 管理。 */
(function (VS) {
  'use strict';
  var C = VS.Config, U = VS.Utils;
  function points(game, radius, count) {
    var out = [], cx = game.world.w / 2, cy = game.world.h / 2;
    for (var i = 0; i < count; i++) out.push({ x: cx + Math.cos(i * U.TAU / count) * radius,
      y: cy + Math.sin(i * U.TAU / count) * radius });
    return out;
  }
  function unowned(game) { return C.RELICS.filter(function (r) { return game.relics.indexOf(r.id) < 0; }); }
  function nearest(list, p, radius) {
    for (var i = 0; i < list.length; i++) if (U.dist2(p.x, p.y, list[i].x, list[i].y) <= radius * radius) return i;
    return -1;
  }
  function clearStageAttacks(game) {
    if (!game.encounters) return;
    ['zones', 'beams'].forEach(function (key) {
      var list = game.encounters[key];
      for (var i = list.length - 1; i >= 0; i--) if (list[i].owner === 'stage') U.swapRemove(list, i);
    });
  }
  function frost(state, dt, game, elapsed, rule) {
    var p = game.player;
    state.active = elapsed >= rule.coldStart && (elapsed - rule.coldStart) % rule.period < rule.active;
    state.nearLamp = nearest(state.lamps, p, rule.warmRadius);
    state.cold = U.clamp(state.cold + (state.nearLamp >= 0 ? -rule.warmRate : state.active ? rule.gain : -5) * dt, 0, rule.maxCold);
    p.stageSpeedMul = state.cold >= rule.slowAt ? rule.speedMul : 1;
    state.damageCd = Math.max(0, state.damageCd - dt);
    if (state.cold >= rule.maxCold && state.damageCd <= 0) {
      VS.Player.takeDamage(p, rule.damage, game); state.damageCd = rule.damageEvery;
    }
  }
  function forge(state, dt, game, elapsed, rule) {
    var p = game.player;
    state.nearVent = nearest(state.vents, p, rule.ventRadius);
    if (!state.ventSpent && state.nearVent >= 0) {
      state.ventCharge = Math.min(rule.ventCharge, state.ventCharge + dt);
      if (state.ventCharge >= rule.ventCharge) {
        state.ventSpent = true; state.cancelNext = true; clearStageAttacks(game);
        VS.Encounters.staggerBoss(game, 2);
        VS.Effects.burst(game.fx, p.x, p.y, '#9bede0', 12, { speed: 100, life: 0.45, size: 3 });
      }
    } else if (state.nearVent < 0) state.ventCharge = 0;
    if (elapsed >= state.nextForge - rule.warning) {
      if (!state.cancelNext) {
        var vertical = state.forgeWave % 2 === 1;
        for (var i = -1; i <= 1; i++) VS.Encounters.beam(game,
          vertical ? p.x + i * 160 : p.x - rule.length / 2,
          vertical ? p.y - rule.length / 2 : p.y + i * 160,
          vertical ? Math.PI / 2 : 0, rule.length, rule.width, rule.damage,
          rule.warning, rule.active, 0, '#ff9d62', 'stage');
      }
      state.nextForge += rule.period; state.forgeWave++; state.cancelNext = false;
      state.ventSpent = false; state.ventCharge = 0;
    }
  }
  function shrines(state, game, elapsed, rule) {
    if (state.nextShrine < rule.shrines.length && elapsed >= rule.shrines[state.nextShrine]) {
      state.nextShrine++;
      if (unowned(game).length) state.shrines.push({
        x: U.clamp(game.player.x + Math.cos(state.nextShrine * 2.1) * 170, 100, game.world.w - 100),
        y: U.clamp(game.player.y + Math.sin(state.nextShrine * 2.1) * 170, 100, game.world.h - 100), used: false });
    }
    for (var i = 0; i < state.shrines.length; i++) {
      var shrine = state.shrines[i];
      if (!shrine.used && U.dist2(game.player.x, game.player.y, shrine.x, shrine.y) < 43 * 43) {
        if (!unowned(game).length) shrine.used = true;
        else state.pendingShrine = shrine;
        break;
      }
    }
  }
  var Stages = {
    create: function (game) {
      var def = VS.Levels.def(game.level), name = def.mechanic || '';
      var rule = C.CHAPTER_RULES[name];
      var lamps = points(game, 430, 4); lamps.unshift({ x: game.world.w / 2, y: game.world.h / 2 });
      return { mechanic: name, startedAt: game.time, cold: 0, damageCd: 0, active: false, nearLamp: -1,
        lamps: lamps, vents: points(game, 250, 3), nearVent: -1, ventCharge: 0, ventSpent: false,
        cancelNext: false, forgeWave: 0, nextForge: rule ? rule.period : 18, nextShrine: 0, shrines: [], pendingShrine: null,
        endlessBossQueue: name === 'frost' ? ['bellkeeper', 'rimeQueen'] : name === 'forge' ? ['emberColossus'] : [] };
    },
    enter: function (game) {
      clearStageAttacks(game); game.player.stageSpeedMul = 1; game.stage = Stages.create(game);
    },
    endlessIndex: function (time) {
      var index = time < 600 ? 0 : time < 1200 ? 1 : time < 1800 ? 2 : 3 - Math.floor((time - 1800) / 600) % 2;
      return Math.min(index, VS.Levels.count() - 1);
    },
    nextEndlessBoss: function (game, fallback) {
      return game.stage && game.stage.endlessBossQueue.length ? game.stage.endlessBossQueue.shift() : fallback;
    },
    update: function (game, dt) {
      var state = game.stage, rule = state && C.CHAPTER_RULES[state.mechanic];
      game.player.stageSpeedMul = 1;
      if (!rule) return;
      var elapsed = game.time - state.startedAt;
      if (state.mechanic === 'frost') frost(state, dt, game, elapsed, rule);
      else if (state.mechanic === 'forge') forge(state, dt, game, elapsed, rule);
      shrines(state, game, elapsed, rule);
    },
    applyRelic: function (game, id) {
      var def = C.RELICS.filter(function (r) { return r.id === id; })[0];
      if (!def || game.relics.indexOf(id) >= 0) return false;
      var p = game.player;
      if (id === 'lantern') { p.areaMul *= 1.18; p.speed *= 0.95; }
      else if (id === 'emberHeart') { p.damageMul *= 1.2; p.maxHp = Math.max(1, p.maxHp * 0.88); p.hp = Math.min(p.hp, p.maxHp); }
      else if (id === 'pilgrim') { p.speed *= 1.12; p.pickupRadius *= 1.18; }
      else if (id === 'hourglass') { p.attackSpeedMul *= 1.15; p.dashCooldownMul *= 0.9; }
      else if (id === 'mercy') { p.regen += 1; p.maxHp += 15; p.hp = Math.min(p.maxHp, p.hp + 15); }
      else if (id === 'mirror') { p.critChance = Math.min(1, p.critChance + 0.08); p.projBonus++; p.armor--; }
      else return false;
      game.relics.push(id); return true;
    },
    openRelic: function (game) {
      var shrine = game.stage && game.stage.pendingShrine;
      if (!shrine || shrine.used || game.state !== VS.Game.STATE.PLAYING) return false;
      var pool = unowned(game), out = [];
      while (pool.length && out.length < 3) {
        var def = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        out.push({ kind: 'relic', id: def.id, name: def.name, icon: def.icon, color: def.color,
          desc: def.desc, tag: '遗物 · 本局唯一', isNew: true });
      }
      if (!out.length) { shrine.used = true; game.stage.pendingShrine = null; return false; }
      game.relicChoices = out; game.state = VS.Game.STATE.RELICSELECT;
      if (game.deps.panels) game.deps.panels.showRelic(out, game);
      return true;
    },
    chooseRelic: function (game, index) {
      if (game.state !== VS.Game.STATE.RELICSELECT) return false;
      var choice = game.relicChoices[index];
      if (!choice || !Stages.applyRelic(game, choice.id)) return false;
      game.stage.pendingShrine.used = true; game.stage.pendingShrine = null; game.relicChoices = [];
      if (game.deps.panels) game.deps.panels.hideRelic();
      game.state = VS.Game.STATE.PLAYING;
      return true;
    },
    status: function (game) {
      var state = game.stage;
      if (!state || !state.mechanic) return '';
      var elapsed = game.time - state.startedAt, text;
      if (state.mechanic === 'frost') text = '寒意 ' + Math.round(state.cold) + '/100 · ' +
        (state.nearLamp >= 0 ? '暖灯回温' : state.active ? '寒潮 · 寻找暖灯' : '寒潮间歇');
      else text = '地火 ' + Math.max(0, Math.ceil(state.nextForge - elapsed)) + ' 秒 · ' +
        (state.cancelNext ? '下轮已卸压' : state.ventSpent ? '阀门冷却' : state.ventCharge > 0 ? '卸压 ' + Math.floor(state.ventCharge / C.CHAPTER_RULES.forge.ventCharge * 100) + '%' : '靠近青色阀门卸压');
      var boss = game.enemies.boss;
      if (boss && boss.encounterAI) text += boss.encounterAI.stun > 0 ? ' · 核心破绽 ×1.35' : boss.encounterAI.windup > 0 ? ' · 首领蓄力' : boss.encounterAI.phase > 1 ? ' · 首领第二阶段' : '';
      return text;
    }
  };
  VS.register('Stages', Stages);
})(window.VS = window.VS || {});
