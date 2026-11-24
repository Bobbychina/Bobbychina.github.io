/* 无尽刻印与循环委托。状态跟随本局，换场景不重置。 */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var NEAR = 135, FAR = 235;
  var SEALS = [
    { id: 'duel', name: '贴身刻印', icon: '⚔', color: '#f59474',
      desc: '与目标相距 135 以内时，每层多造成 14% 伤害。' },
    { id: 'sight', name: '远狩刻印', icon: '◎', color: '#a4dada',
      desc: '与目标相距 235 以外时，每层多造成 18% 伤害。' },
    { id: 'echo', name: '叠响刻印', icon: '≋', color: '#caabfc',
      desc: '对同一敌人每命中 3 次，最后一击每层额外造成 35% 伤害。对精英和首领只需 2 次。' },
    { id: 'vigor', name: '余烬刻印', icon: '✚', color: '#edbd80',
      desc: '每层立即增加 12 点当前及最大生命，每完成一份委托再按每层回复 8 点生命。' }
  ];
  var QUARRIES = [
    { name: '铁壁血裔', hp: 2.4, speed: 1, damage: 1 },
    { name: '疾行血裔', hp: 1.4, speed: 1.55, damage: 1 },
    { name: '裂牙血裔', hp: 1.6, speed: 1.1, damage: 1.45 }
  ];
  var KINDS = ['cull', 'travel', 'hunt'];

  function active(game, poolEmpty) {
    if (game.mode !== 'endless') return null;
    if (!game.forge && (poolEmpty || game.time >= C.ENDLESS.BIOME_AT)) {
      game.forge = {
        ranks: { duel: 0, sight: 0, echo: 0, vigor: 0 },
        cores: 0, completed: 0, progress: 0, target: null,
        lastX: game.player.x, lastY: game.player.y
      };
    }
    return game.forge;
  }

  function choices(game, poolEmpty) {
    var f = active(game, poolEmpty);
    if (!f) return [];
    return SEALS.map(function (s) {
      var rank = f.ranks[s.id];
      return { kind: 'forge', id: s.id, name: s.name, icon: s.icon, color: s.color, weight: 6,
        desc: s.desc, tag: '刻印 ' + rank + ' → ' + (rank + 1) + ' 层' };
    });
  }

  function price(game, id, count = 1) {
    if ((count !== 1 && count !== 5) || !SEALS.some(function (seal) { return seal.id === id; })) return 0;
    var rank = game.forge ? game.forge.ranks[id] : 0, total = 0;
    for (var i = 0; i < count; i++) {
      var r = rank + i;
      total += Math.min(999999999, 60 + 15 * r + 12 * r * r);
    }
    return total;
  }

  function buy(game, id, count = 1) {
    if (count !== 1 && count !== 5) return false;
    var f = active(game);
    if (!f || !Object.prototype.hasOwnProperty.call(f.ranks, id)) return false;
    f.ranks[id] += count;
    if (id === 'vigor') {
      game.player.maxHp += 12 * count;
      game.player.hp += 12 * count;
    }
    return true;
  }

  function hitMultiplier(game, e) {
    var f = game.forge;
    var r = f.ranks, bonus = 0;
    if (r.duel || r.sight) {
      var d2 = VS.Utils.dist2(game.player.x, game.player.y, e.x, e.y);
      if (d2 <= NEAR * NEAR) bonus += r.duel * 0.14;
      if (d2 >= FAR * FAR) bonus += r.sight * 0.18;
    }
    if (r.echo) {
      e.forgeHits = (e.forgeHits || 0) + 1;
      if (e.forgeHits >= (e.boss || e.elite ? 2 : 3)) {
        e.forgeHits = 0;
        bonus += r.echo * 0.35;
      }
    }
    return 1 + bonus;
  }

  function kind(f) { return KINDS[f.completed % KINDS.length]; }
  function cycle(f) { return Math.floor(f.completed / KINDS.length); }
  function bounty(f) { return 120 + Math.min(80, cycle(f) * 8); }
  function goal(f) {
    // 提高工作量后维持可完成节奏；后续轮次继续改变猎物和目标强度。
    switch (kind(f)) {
      case 'cull': return 45 + Math.min(75, cycle(f) * 5);
      case 'travel': return 220 + Math.min(180, cycle(f) * 12);
      default: return 1;
    }
  }

  function finish(game) {
    var f = game.forge, p = game.player;
    var earned = VS.Shop.earn(game, bounty(f));
    var heal = VS.Player.heal(p, 8 * f.ranks.vigor);
    f.cores++;
    f.completed++;
    f.progress = 0;
    f.target = null;
    if (game.fx) VS.Effects.text(game.fx, p.x, p.y - 36,
      '委托完成 +' + earned + ' 金币 · +1 炉芯' + (heal > 0 ? '  +' + Math.ceil(heal) + ' 生命' : ''),
      '#ffd37e', { life: 1.6, size: 16 });
  }

  function onKill(game, e) {
    var f = game.forge;
    if (kind(f) === 'cull') {
      if (++f.progress >= goal(f)) finish(game);
    } else if (kind(f) === 'hunt' && e === f.target) {
      finish(game);
    }
  }

  function quarry(f) { return QUARRIES[cycle(f) % QUARRIES.length]; }

  function markQuarry(game, f) {
    var es = game.enemies;
    if (es.boss && !es.boss.dead) {
      f.target = es.boss;
    } else if (es.list.length < C.SPAWN.MAX_ENEMIES) {
      var q = quarry(f);
      var hunter = VS.Enemies.spawn(es, C.ENEMY_TYPES.elite, game, { hpMult: q.hp + 0.15 * cycle(f) });
      hunter.speed *= q.speed;
      hunter.damage *= q.damage;
      hunter.name = q.name;
      f.target = hunter;
    }
    if (f.target) f.target.bountyTarget = true;
  }

  function update(game) {
    var f = active(game), p = game.player;
    if (!f || !p.alive) return;
    var dx = p.x - f.lastX, dy = p.y - f.lastY;
    f.lastX = p.x;
    f.lastY = p.y;
    if (kind(f) === 'travel' && p.moving) {
      f.progress += Math.sqrt(dx * dx + dy * dy) / 10;
      if (f.progress >= goal(f)) finish(game);
    } else if (kind(f) === 'hunt' && !f.target) {
      markQuarry(game, f);
    }
  }

  function objective(game) {
    var f = game.mode === 'endless' && game.forge;
    if (!f) return '';
    var type = kind(f), text;
    if (type === 'cull') text = '清剿 ' + f.progress + '/' + goal(f);
    else if (type === 'travel') text = '行军 ' + Math.floor(f.progress) + '/' + goal(f) + ' 步';
    else text = '讨伐 ' + (f.target ? f.target.name : quarry(f).name) + '（赏）';
    return '委托 ' + (f.completed + 1) + ' · ' + text;
  }

  function summary(game) {
    var task = objective(game);
    if (!task) return '';
    var f = game.forge;
    return task + ' · 报酬 ' + bounty(f) + ' 金币和 1 枚炉芯。持有 ' + f.cores + ' 枚炉芯。刻印层数：' + SEALS.map(function (s) {
      return s.name.slice(0, 2) + ' ' + f.ranks[s.id];
    }).join(' / ');
  }

  VS.register('EndlessForge', { seals: SEALS, choices: choices, price: price, buy: buy,
    hitMultiplier: hitMultiplier, onKill: onKill, update: update, objective: objective, summary: summary });
})(window.VS = window.VS || {});
