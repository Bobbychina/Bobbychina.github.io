/* 本局装备占四个独立栏位。加成在行动时读取，卸装不会改写永久属性。 */
(function (VS) {
  'use strict';

  var capacity = 4;
  var families = {
    stride: { id: 'stride', name: '疾行', icon: '➤', color: '#81d9ec', bonuses: {
      2: '连续移动 1.5 秒后，移动期间的暴击率增加 18 个百分点。',
      3: '闪避起步时释放半径 130 的冲击波，造成 32 基础伤害，享受武器伤害和暴击加成。' } },
    bastion: { id: 'bastion', name: '壁垒', icon: '⬡', color: '#d8c58a', bonuses: {
      2: '站定 3 秒获得护盾，可带着它移动并抵挡一次伤害。破盾后须等 8 秒才能再次蓄盾。',
      3: '破盾时对半径 150 内的敌人造成 80 基础伤害，享受武器伤害和暴击加成。' } },
    blood: { id: 'blood', name: '血誓', icon: '♦', color: '#f29fa4', bonuses: {
      2: '实际受伤后的 3 秒内，武器伤害提高 25%。',
      3: '受到致命伤时保留 1 点生命，获得 2 秒无敌。冷却 45 秒。' } },
    salvage: { id: 'salvage', name: '拾荒', icon: '⚙', color: '#a8d3a4', bonuses: {
      2: '装备期间每击杀 12 个敌人领取 5 金币赏金。',
      3: '受伤时自动支付 8 金币，使本次伤害减半。余额不足时照常承受伤害。' } }
  };

  var items = {};
  function item(id, family, name, icon, desc) {
    items[id] = { id: id, family: family, name: name, icon: icon, desc: desc };
  }
  item('spikes', 'stride', '钉纹快靴', '➤', '普通移速提高 18%。站定时武器伤害降低 12%。');
  item('coil', 'stride', '惯性线圈', 'ϟ', '闪避后的 1.1 秒内，武器伤害提高 32%。其余时间降低 6%。');
  item('windClasp', 'stride', '逆风搭扣', '↗', '闪避冷却缩短 25%。受到的伤害提高 12%。');
  item('plate', 'bastion', '铆钉胸甲', '⬡', '站定时受到的伤害降低 24%。普通移速降低 8%。');
  item('scope', 'bastion', '折脚瞄准架', '⊹', '站定 1.2 秒后，魔法飞弹、寒霜飞锥、机械蜂群和棱镜的伤害提高 38%。移动时这四把武器的伤害降低 8%。');
  item('kit', 'bastion', '发条药匣', '✚', '站定时每秒额外回复 3 点生命。闪避冷却延长 12%。');
  item('fang', 'blood', '赤牙指环', '♦', '生命不高于一半时，武器伤害提高 40%。高于一半时降低 8%。');
  item('mirror', 'blood', '裂心镜', '◈', '暴击率增加 14 个百分点。受到的伤害提高 20%。');
  item('suture', 'blood', '缝皮绷带', '✣', '生命不高于一半时，每秒额外回复 4 点生命。高于一半时，基础与被动提供的自然回复减半。');
  item('weight', 'salvage', '铜秤砣', '◆', '每持有 10 金币，武器伤害提高 2%，最多提高 24%。少于 10 金币时伤害降低 8%。');
  item('magnet', 'salvage', '捡漏磁钩', '⊙', '每次闪避时吸引起点周围 330 像素内的全部经验球。');
  item('sieve', 'salvage', '分拣筛', '▦', '拾取的经验值提高 25%。武器伤害降低 8%。');

  function create() {
    return { collection: {}, worn: {}, counts: { stride: 0, bastion: 0, blood: 0, salvage: 0 }, size: 0,
      moving: false, travel: 0, stand: 0, surge: 0, rage: 0, ward: false, wardCharge: 0,
      wardCd: 0, rescueCd: 0, nextBounty: 0 };
  }

  function owned(p) { return p && p.gear ? Object.keys(p.gear.collection) : []; }
  function equipped(p) { return p && p.gear ? Object.keys(p.gear.worn) : []; }
  function count(p, family) { return p && p.gear ? p.gear.counts[family] || 0 : 0; }

  function choices(game) {
    var p = game.player, g = p.gear;
    var full = g && g.size >= capacity;
    return Object.keys(items).filter(function (id) { return !g || !g.collection[id]; }).map(function (id) {
      var def = items[id], family = families[def.family], after = count(p, def.family) + 1;
      var next = after === 1 ? 2 : after;
      return { kind: 'gear', id: id, name: def.name, icon: def.icon, color: family.color,
        tag: family.name + (full ? ' · 购入装备箱' : ' · 穿上后 ' + after + '/3 件'),
        desc: def.desc + '<br>' + family.name + ' ' + next + ' 件：' + family.bonuses[next],
        weight: after > 1 ? 12 : 6 };
    });
  }

  function buy(game, id) {
    if (game.state !== 'shop' || !Object.prototype.hasOwnProperty.call(items, id)) return false;
    var p = game.player, g = p.gear || (p.gear = create());
    if (g.collection[id]) return false;
    g.collection[id] = true;
    if (g.size < capacity) equip(game, id);
    return true;
  }
  function equip(game, id) {
    var p = game.player, g = p.gear;
    if (game.state !== 'shop' || !g || !Object.prototype.hasOwnProperty.call(g.collection, id) ||
        g.worn[id] || g.size >= capacity) return false;
    var family = items[id].family;
    g.worn[id] = true;
    g.size++;
    g.counts[family]++;
    if (family === 'salvage' && g.counts.salvage === 2) g.nextBounty = p.kills + 12;
    return true;
  }

  function remove(game, id) {
    var g = game.player.gear;
    if (game.state !== 'shop' || !g || !Object.prototype.hasOwnProperty.call(g.worn, id)) return false;
    var family = items[id].family;
    delete g.worn[id];
    g.size--;
    g.counts[family]--;
    if (g.counts.bastion < 2) { g.ward = false; g.wardCharge = 0; }
    if (g.counts.blood < 2) g.rage = 0;
    if (id === 'coil') g.surge = 0;
    return true;
  }

  function moveMul(p) {
    var owns = p.gear.worn;
    return (owns.spikes ? 1.18 : 1) * (owns.plate ? 0.92 : 1);
  }
  function dashMul(p) {
    var owns = p.gear.worn;
    return (owns.windClasp ? 0.75 : 1) * (owns.kit ? 1.12 : 1);
  }
  function regen(p) {
    var g = p.gear, low = p.hp <= p.maxHp * 0.5;
    var rate = p.regen;
    if (g.worn.suture) rate = low ? rate + 4 : rate * 0.5;
    if (g.worn.kit && !g.moving) rate += 3;
    return rate;
  }

  function step(p, dt, moving) {
    var g = p.gear;
    g.moving = moving;
    g.travel = moving ? Math.min(1.5, g.travel + dt) : 0;
    g.stand = moving ? 0 : Math.min(1.2, g.stand + dt);
    g.surge = Math.max(0, g.surge - dt);
    g.rage = Math.max(0, g.rage - dt);
    g.rescueCd = Math.max(0, g.rescueCd - dt);
    var wait = g.wardCd;
    g.wardCd = Math.max(0, wait - dt);
    if (g.counts.bastion >= 2 && !g.ward) {
      g.wardCharge = moving ? 0 : g.wardCharge + Math.max(0, dt - wait);
      if (g.wardCharge >= 3) g.ward = true;
    }
  }

  function damageMul(game) {
    var p = game.player, g = p.gear, owns = g.worn, mul = 1;
    if (owns.spikes && !g.moving) mul *= 0.88;
    if (owns.coil) mul *= g.surge > 0 ? 1.32 : 0.94;
    if (owns.fang) mul *= p.hp <= p.maxHp * 0.5 ? 1.40 : 0.92;
    if (owns.weight) {
      var tens = Math.floor(game.shop.coins / 10);
      mul *= tens ? 1 + 0.02 * Math.min(tens, 12) : 0.92;
    }
    if (owns.sieve) mul *= 0.92;
    if (g.rage > 0) mul *= 1.25;
    return mul;
  }

  function critBonus(p) {
    var g = p.gear;
    return (g.worn.mirror ? 0.14 : 0) + (g.counts.stride >= 2 && g.travel >= 1.5 ? 0.18 : 0);
  }
  function scopeMul(p, weaponId) {
    var g = p.gear;
    if (!g.worn.scope || !scopeWeapons[weaponId]) return 1;
    return g.stand >= 1.2 ? 1.38 : g.moving ? 0.92 : 1;
  }
  function signal(game, msg, color) {
    if (game && game.fx) VS.Effects.text(game.fx, game.player.x, game.player.y - 22, msg, color);
  }

  function onDash(p, game) {
    var g = p.gear;
    g.moving = true;
    g.stand = 0;
    g.wardCharge = 0;
    if (g.worn.coil) g.surge = 1.1;
    if (!game) return;
    if (g.worn.magnet) {
      var gems = game.pickups.gems;
      for (var i = 0; i < gems.length; i++) {
        if (VS.Utils.dist2(p.x, p.y, gems[i].x, gems[i].y) <= 330 * 330) gems[i].magnet = true;
      }
    }
    if (g.counts.stride >= 3) VS.Weapons.gearPulse(game, 130, 32, families.stride.color);
  }

  function resolveHit(p, damage, game) {
    var g = p.gear;
    if (g.ward) {
      g.ward = false;
      g.wardCharge = 0;
      g.wardCd = 8;
      p.invuln = 0.45;
      signal(game, '壁垒抵挡', families.bastion.color);
      if (game && g.counts.bastion >= 3) VS.Weapons.gearPulse(game, 150, 80, families.bastion.color);
      return 0;
    }
    if (g.worn.windClasp) damage *= 1.12;
    if (g.worn.mirror) damage *= 1.20;
    if (g.worn.plate && !g.moving) damage *= 0.76;
    if (g.counts.salvage >= 3 && game && game.shop.coins >= 8) {
      game.shop.coins -= 8;
      game.shop.spent += 8;
      damage *= 0.5;
      signal(game, '抵伤 −8 金', families.salvage.color);
    }
    return damage;
  }
  function onWound(p, game) {
    var g = p.gear;
    if (g.counts.blood >= 2) g.rage = 3;
    if (p.hp <= 0 && g.counts.blood >= 3 && g.rescueCd <= 0) {
      p.hp = 1;
      p.invuln = 2;
      g.rescueCd = 45;
      signal(game, '血誓续命', families.blood.color);
    }
  }
  function settleBounty(game) {
    var p = game.player, g = p.gear;
    if (g.counts.salvage < 2 || p.kills < g.nextBounty) return;
    var batches = 1 + Math.floor((p.kills - g.nextBounty) / 12);
    g.nextBounty += batches * 12;
    var coins = VS.Shop.earn(game, batches * 5);
    if (coins) signal(game, '赏金 +' + coins, families.salvage.color);
  }

  var scopeWeapons = { bolt: true, frost: true, drone: true, prism: true };
  VS.register('Gear', { capacity: capacity, items: items, families: families, owned: owned, equipped: equipped, count: count,
    choices: choices, buy: buy, equip: equip, remove: remove, step: step, moveMul: moveMul, dashMul: dashMul,
    regen: regen, damageMul: damageMul, critBonus: critBonus, scopeMul: scopeMul,
    onDash: onDash, resolveHit: resolveHit, onWound: onWound, settleBounty: settleBounty });
})(window.VS = window.VS || {});
