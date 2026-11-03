/* 扩展武器与互斥分支。apply 只修改本次计算的 stats，不累积改写玩家属性。 */
(function (VS) {
  'use strict';
  var C = VS.Config;
  C.SCHOOLS = {};
  C.ARSENAL_LIMITS = { projectiles: 160, sickles: 32, mines: 28, totems: 8, orbs: 12,
    beams: 24, burns: 180, scorches: 24, slashes: 16 };

  function add(id, name, icon, color, desc, stats, detail) {
    C.WEAPONS[id] = { id: id, name: name, icon: icon, color: color, desc: desc,
      maxLevel: 8, arsenal: true, schools: [], stats: stats,
      describe: function (lv) { var s = stats(lv); return detail(s) + ' · 间隔 ' + s.cooldown.toFixed(2) + 's'; } };
    if (C.NEW_WEAPON_POOL.indexOf(id) < 0) C.NEW_WEAPON_POOL.push(id);
    if (C.START_WEAPONS.indexOf(id) < 0) C.START_WEAPONS.push(id);
  }
  function school(weapon, suffix, name, icon, short, apply) {
    var id = weapon + '_' + suffix;
    C.SCHOOLS[id] = { id: id, weapon: weapon, name: name, icon: icon,
      color: C.WEAPONS[weapon].color, max: 3, weight: 9, short: short, apply: apply };
    C.WEAPONS[weapon].schools.push(id);
  }
  function damage(s) { return '伤害 ' + VS.Utils.fixed(s.damage); }

  add('sickle', '回魂镰', '☾', '#c7adff', '旋转镰刃飞向敌人后返回。去程与回程各能命中一次，适合来回走位收割。',
    function (lv) { return { cooldown: 1.9 - 0.1 * (lv - 1), damage: 18 + 7 * (lv - 1), count: 1 + Math.floor(lv / 4),
      speed: 330, range: 260 + 12 * (lv - 1), radius: 17, life: 2.6 }; },
    function (s) { return damage(s) + ' · 镰刃 ' + s.count + ' · 飞行距离 ' + s.range; });
  add('lance', '圣枪', '⚜', '#ffe6ab', '朝最近敌人贯穿突刺，同一直线上的敌人都会受伤。',
    function (lv) { return { cooldown: 2.25 - 0.12 * (lv - 1), damage: 28 + 12 * (lv - 1),
      length: 220 + 20 * (lv - 1), width: 12 + lv, life: 0.2 }; },
    function (s) { return damage(s) + ' · 枪长 ' + s.length; });
  add('mine', '符文地雷', '✥', '#f6a37b', '在身后布置地雷，完成布防后被附近敌人触发。提前走位可以布置爆破路线。',
    function (lv) { return { cooldown: 2.7 - 0.14 * (lv - 1), damage: 32 + 14 * (lv - 1),
      radius: 70 + 7 * (lv - 1), armTime: 0.45, triggerRadius: 32, life: 9, count: 1 }; },
    function (s) { return damage(s) + ' · 爆炸半径 ' + s.radius; });
  add('totem', '风暴图腾', 'ϟ', '#a9bfff', '在敌人附近放置图腾，持续向周围目标释放雷击。图腾固定在地面。',
    function (lv) { return { cooldown: 5 - 0.2 * (lv - 1), damage: 8 + 3 * (lv - 1),
      radius: 140 + 10 * (lv - 1), tick: 0.7, life: 6, targets: 2 + Math.floor(lv / 3) }; },
    function (s) { return '每跳 ' + s.damage + ' · 目标 ' + s.targets + ' · 存续 ' + s.life + 's'; });
  add('drone', '机械蜂群', '⌘', '#8edbd4', '无人机绕身飞行，自动向射程内的敌人开火。多重射击会增加无人机数量。',
    function (lv) { return { cooldown: 0.95 - 0.05 * (lv - 1), damage: 6 + 2.5 * (lv - 1),
      count: 2 + Math.floor(lv / 3), orbitRadius: 95 + 5 * (lv - 1), range: 420,
      speed: 480, radius: 4, pierce: 1, life: 1.3 }; },
    function (s) { return damage(s) + ' · 无人机 ' + s.count; });
  add('gravity', '引力球', '◈', '#bda3ee', '缓慢飞行的引力球牵引普通敌人，并周期性伤害范围内目标。首领不受牵引。',
    function (lv) { return { cooldown: 4.4 - 0.2 * (lv - 1), damage: 7 + 3 * (lv - 1),
      radius: 75 + 6 * (lv - 1), tick: 0.4, speed: 100, life: 3.2, pullSpeed: 65 + 5 * (lv - 1) }; },
    function (s) { return '每跳 ' + s.damage + ' · 引力半径 ' + s.radius; });
  add('flame', '焰舌', '♨', '#ff9672', '向前喷出短距离扇形火焰，造成直接伤害并附加持续燃烧。',
    function (lv) { return { cooldown: 1.2 - 0.06 * (lv - 1), damage: 10 + 4 * (lv - 1),
      range: 130 + 10 * (lv - 1), angle: 1.15, burnDamage: 3 + 1.2 * (lv - 1),
      burnTime: 2.4, tick: 0.6, life: 0.22 }; },
    function (s) { return damage(s) + ' · 燃烧每跳 ' + VS.Utils.fixed(s.burnDamage) + ' · 距离 ' + s.range; });
  add('prism', '棱镜', '◇', '#baf0ef', '释放持续扫动的贯穿光束，沿线目标会多次受伤。',
    function (lv) { return { cooldown: 3 - 0.16 * (lv - 1), damage: 9 + 3 * (lv - 1),
      length: 320 + 18 * (lv - 1), width: 7, duration: 0.6, tick: 0.18, sweep: 0.8, beams: 1 }; },
    function (s) { return '每跳 ' + s.damage + ' · 光束长度 ' + s.length + ' · 持续 ' + s.duration.toFixed(2) + 's'; });

  school('sickle', 'harvest', '收割', '❦', '回程实际命中可治疗：每级每次 +0.7 生命，每把镰每级最多回复 2 点。',
    function (s, r) { s.healOnReturn = 0.7 * r; s.healCap = 2 * r; });
  school('sickle', 'twins', '双月', '☽', '每级额外投出一把镰刃，展开角度随镰刃数量增加。',
    function (s, r) { s.count += r; });
  school('sickle', 'hook', '引魂', '↜', '镰刃命中会把普通敌人拉向镰刃；每级牵引距离 +12。',
    function (s, r) { s.pull = 12 * r; });
  school('lance', 'execution', '处刑', '♜', '对生命不高于 35% 的目标，每级额外造成 30% 伤害。',
    function (s, r) { s.executeBelow = 0.35; s.executeBonus = 0.3 * r; });
  school('lance', 'echo', '回声', '⋙', '突刺后每级追加一次同方向回声枪，每次间隔 0.22 秒。',
    function (s, r) { s.echoes = r; s.echoDelay = 0.22; });
  school('lance', 'bastion', '壁垒', '⛨', '每次突刺每级提供 0.08 秒无敌，并加强对普通敌人的击退。',
    function (s, r) { s.guardTime = 0.08 * r; s.knockback = 50 * r; });
  school('mine', 'chain', '连锁爆破', '✹', '地雷爆炸会引爆附近已布防的地雷，连锁搜索半径每级 +25。',
    function (s, r) { s.chainRadius = 90 + 25 * r; });
  school('mine', 'frost', '霜纹', '❄', '爆炸使普通敌人减速：每级 15%，持续时间每级 +0.5 秒。',
    function (s, r) { s.slowMul = 1 - 0.15 * r; s.slowTime = 1 + 0.5 * r; });
  school('mine', 'shrapnel', '破片', '✶', '爆炸额外放出放射破片，数量为 6 + 每级 2 枚，各造成地雷 25% 伤害。',
    function (s, r) { s.shards = 6 + 2 * r; s.shardDamageMul = 0.25; });
  school('totem', 'fork', '分岔', '⋔', '每跳雷击每级额外命中一个目标。',
    function (s, r) { s.targets += r; });
  school('totem', 'static', '静电', '⚡', '同一目标每被图腾命中三次，追加每级 60% 的单跳伤害。',
    function (s, r) { s.staticEvery = 3; s.staticDamageMul = 0.6 * r; });
  school('totem', 'eye', '风眼', '◎', '图腾持续把普通敌人拉向中心，每级牵引速度 +30。',
    function (s, r) { s.pullSpeed = 30 * r; });
  school('drone', 'focus', '锁敌', '⌖', '无人机优先瞄准精英与首领，对它们每级额外造成 25% 伤害。',
    function (s, r) { s.focusElite = true; s.eliteBonus = 0.25 * r; });
  school('drone', 'repair', '修复', '✚', '蜂群每五秒修复一次玩家，每级回复 1.5 生命；按整群计算。',
    function (s, r) { s.repairEvery = 5; s.repairHp = 1.5 * r; });
  school('drone', 'crossfire', '交叉火力', '⌘', '每架无人机同时发射两枚交叉弹，每级额外穿透一个目标。',
    function (s, r) { s.crossfire = 2; s.pierce += r; });
  school('gravity', 'collapse', '坍缩', '✷', '引力球消失时造成一次范围坍缩，伤害为单跳伤害的 2 + 每级 1 倍。',
    function (s, r) { s.collapseDamageMul = 2 + r; });
  school('gravity', 'well', '深井', '◉', '引力球飞行结束后留下静止引力井，每级额外持续 2 秒。',
    function (s, r) { s.linger = 2 * r; });
  school('gravity', 'tide', '潮汐', '≈', '引力场每 0.8 秒在吸入和推出之间交替，每级牵引强度 +30%。',
    function (s, r) { s.tidePeriod = 0.8; s.tideStrength = 1 + 0.3 * r; });
  school('flame', 'wildfire', '野火', '♨', '燃烧目标死亡时向附近敌人传播一次火种；传播半径每级 +20。',
    function (s, r) { s.spreadRadius = 80 + 20 * r; s.spreadDepth = 1; });
  school('flame', 'furnace', '熔炉', '▲', '火焰扇面缩窄 40%，直接伤害与燃烧伤害每级 +30%。',
    function (s, r) { s.angle *= 0.6; s.damage *= 1 + 0.3 * r; s.burnDamage *= 1 + 0.3 * r; });
  school('flame', 'ash', '余烬', '▱', '喷火在前方留下余烬区域，持续 2 + 每级 1 秒，造成每跳燃烧 70% 的伤害。',
    function (s, r) { s.scorchLife = 2 + r; s.scorchRadius = 50 + 8 * r; s.scorchDamageMul = 0.7; });
  school('prism', 'refraction', '折射', '◇', '棱镜分出三道扫射光束，每级光束长度 +8%。',
    function (s, r) { s.beams = 3; s.length *= 1 + 0.08 * r; });
  school('prism', 'overload', '过载', '◆', '光束固定瞄准方向，每级单跳伤害 +35%，适合持续照射单个目标。',
    function (s, r) { s.overload = true; s.sweep = 0; s.damage *= 1 + 0.35 * r; });
  school('prism', 'reflection', '映照', '⋈', '向身后额外释放一道光束，每级持续时间 +0.15 秒。',
    function (s, r) { s.backBeam = true; s.duration += 0.15 * r; });
})(window.VS = window.VS || {});
