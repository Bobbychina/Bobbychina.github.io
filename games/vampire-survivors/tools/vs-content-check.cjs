/* 内容机制校验：初始武器继承 / 寒霜 / 陨星 / 四条进化 / 商店上架与购买 / 新效果上限。
   只加载游戏逻辑模块，用固定 dt、固定敌人位置和可控随机数走真实接口；
   不依赖浏览器、存档、网络或 npm 包。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: { innerWidth: 1280, innerHeight: 720 }, console };
vm.createContext(sandbox);
[
  'js/core/namespace.js', 'js/core/utils.js', 'js/game/config.js',
  'js/game/phases.js', 'js/game/levels.js', 'js/game/world.js',
  'js/game/effects.js', 'js/game/player.js', 'js/game/weapons.js',
  'js/game/enemies.js', 'js/game/pickups.js', 'js/game/pets.js',
  'js/game/shop.js', 'js/game/game.js'
].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file }));

const VS = sandbox.window.VS;
const C = VS.Config;
VS.Audio = { play() {}, unlock() {} };

/* 随机数只用于本文件需要的货架抽取/实体生成；测试主体不依赖随机结果。 */
vm.runInContext('globalThis.__contentOriginalRandom = Math.random;', sandbox);
function withRandom(value, fn) {
  vm.runInContext('Math.random = function () { return ' + Number(value) + '; };', sandbox);
  try {
    return fn();
  } finally {
    vm.runInContext('Math.random = globalThis.__contentOriginalRandom;', sandbox);
  }
}

function newGame(opt) {
  const game = VS.Game.create({
    data: {},
    input: { getAxis: () => ({ x: 0, y: 0 }) }
  });
  VS.Game.start(game, opt || {});
  return game;
}

function equip(game, id, level, extra) {
  const w = { id: id, level: level || 1, cd: 0 };
  if (extra) {
    Object.keys(extra).forEach(k => { w[k] = extra[k]; });
  }
  game.player.weapons = [w];
  game.weapons = VS.Weapons.create();
  return w;
}

function placeEnemy(game, typeId, x, y, hp) {
  const e = VS.Enemies.spawn(game.enemies, C.ENEMY_TYPES[typeId], game, { x: x, y: y });
  if (hp !== undefined) {
    e.hp = hp;
    e.maxHp = hp;
  }
  VS.Enemies.rebuildGrid(game.enemies, game);
  return e;
}

function advanceWeapons(game, seconds, dt) {
  const step = dt || 0.02;
  const count = Math.ceil(seconds / step);
  for (let i = 0; i < count; i++) VS.Weapons.update(game.weapons, step, game);
}

function upgradeDef(id) {
  return C.UPGRADES.find(item => item.id === id);
}

function test(name, fn) {
  fn();
  console.log('PASS: ' + name);
}

/* ------------------------------------------------------------------ */
/* 1. 初始武器与第二关继承                                             */
/* ------------------------------------------------------------------ */

test('初始武器 frost：start 只带所选武器，第二关保留构筑与金币', function () {
  const g = newGame({ startWeapon: 'frost' });
  assert.equal(g.player.weapons.map(w => w.id).join(','), 'frost', 'start(startWeapon=frost) 应只带寒霜');

  assert.equal(VS.Weapons.add(g.player, 'meteor'), true, '对照组应能临时拿到陨星');
  g.player.weapons[0].level = 5;
  g.player.upgrades.dmg = 3;
  g.player.level = 11;
  g.pets.id = 'faerie';
  g.shop.coins = 157;

  const p = g.player;
  const weapon = p.weapons[0];
  VS.Game.startLevel(g, 1);

  assert.equal(VS.Levels.isFresh(1), false, '第二关应标记 fresh:false，不再重新开局');
  assert.equal(g.player, p, '第二关应沿用同一个玩家对象');
  assert.equal(g.player.weapons.map(w => w.id).join(','), 'frost,meteor',
    '第二关应保留已购买的武器');
  assert.equal(weapon.level, 5, '第二关应保留武器等级');
  assert.equal(p.level, 11, '第二关应保留等级');
  assert.equal(p.upgrades.dmg, 3, '第二关应保留被动层数');
  assert.equal(g.pets.id, 'faerie', '第二关应保留宠物');
  assert.equal(g.shop.coins, 157, '第二关应保留金币');
});

test('未拥有 bolt 时可从商店货架购买，购买后才加入武器栏', function () {
  const g = newGame({ startWeapon: 'frost' });
  const p = g.player;

  /* 压缩卡池：寒霜满级且流派满层，所有增益满层，只剩新武器与进化候选。 */
  p.weapons[0].level = C.WEAPONS.frost.maxLevel;
  p.weapons[0].school = C.WEAPONS.frost.school.max;
  C.UPGRADES.forEach(up => { p.upgrades[up.id] = up.max; });

  assert.equal(VS.Weapons.has(p, 'bolt'), false, '前置条件：玩家尚未拥有 bolt');
  assert.ok(VS.Game.upgradePool(g).some(c => c.kind === 'weapon-new' && c.id === 'bolt'),
    '未拥有 bolt 时，合法池应提供 bolt');

  g.shop.offers = [];
  g.shop.coins = 100;
  VS.Game.openShop(g);
  withRandom(0, () => assert.equal(VS.Shop.refresh(g, false), true));

  const index = g.shop.offers.findIndex(offer =>
    offer && offer.choice.kind === 'weapon-new' && offer.choice.id === 'bolt');
  assert.ok(index >= 0, '货架应上架 bolt 新武器');
  const offer = g.shop.offers[index];
  assert.equal(VS.Game.buyShop(g, index, offer.token), true, '金币足够时应购买成功');
  assert.equal(g.shop.coins, 100 - offer.price, '购买后按货架价格扣钱');
  assert.equal(VS.Weapons.has(p, 'bolt'), true, '购买后玩家应真的拥有 bolt');
  assert.equal(p.weapons.map(w => w.id).join(','), 'frost,bolt', '新武器应追加在现有武器栏之后');
});

/* ------------------------------------------------------------------ */
/* 2. 寒霜：扇形、伤害、限时减速、恢复、Boss 免疫                       */
/* ------------------------------------------------------------------ */

test('寒霜扇形发射：三枚冰锥展开，命中造成伤害并限时减速', function () {
  const g = newGame({ startWeapon: 'frost' });
  const p = g.player;
  const target = placeEnemy(g, 'brute', p.x + 160, p.y, 100000);
  const baseSpeed = target.speed;
  const hpBefore = target.hp;

  VS.Weapons.update(g.weapons, 0.005, g);
  assert.equal(g.weapons.projectiles.length, 3, 'Lv1 寒霜应一次发射 3 枚冰锥');

  const angles = g.weapons.projectiles.map(pr => pr.angle).sort((a, b) => a - b);
  assert.ok(angles[2] - angles[0] > 0.2, '冰锥角度应呈扇形展开，而不是同一条直线');
  assert.ok(g.weapons.projectiles.every(pr => pr.kind === 'frost'), '冰锥应带 frost 类型');
  assert.ok(g.weapons.projectiles.every(pr => Math.abs(pr.angle) < 0.5),
    '扇形应朝向最近目标附近');

  let guard = 0;
  while (target.hp === hpBefore && guard++ < 100) {
    VS.Weapons.update(g.weapons, 0.02, g);
  }
  assert.ok(target.hp < hpBefore, '冰锥命中后应造成伤害');
  assert.ok(target.slowT > 0, '命中后应进入限时减速');
  assert.ok(target.slowT <= C.WEAPONS.frost.stats(1).slowTime + 1e-9,
    '减速持续时间不应超过武器配置');
  assert.equal(target.slowMul, C.WEAPONS.frost.stats(1).slowMul, '减速倍率应来自寒霜配置');
  assert.equal(target.speed, baseSpeed, '减速不应永久改写敌人的基础 speed');

  /* 离开玩家避免碰撞，只推进怪物时间轴，验证减速到期后恢复。 */
  target.x = p.x + 700;
  target.y = p.y;
  VS.Enemies.rebuildGrid(g.enemies, g);
  for (let i = 0; i < 40; i++) VS.Enemies.moveAndCollide(g.enemies, 0.05, g);

  assert.equal(target.slowT, 0, '减速时间结束后 slowT 应归零');
  assert.equal(target.slowMul, 1, '减速时间结束后 slowMul 应恢复 1');
  assert.equal(target.speed, baseSpeed, '减速结束后 speed 必须仍是原值');
  assert.ok(target.hp > 0, '测试目标应存活，避免误判死亡路径');
});

test('寒霜对 Boss 造成伤害但不施加任何减速', function () {
  const g = newGame({ startWeapon: 'frost' });
  const p = g.player;
  const boss = VS.Enemies.spawnBoss(g.enemies, g, { type: 'boss' });
  assert.ok(boss && boss.boss, '前置条件：Boss 应成功生成');
  boss.x = p.x + 160;
  boss.y = p.y;
  boss.hp = boss.maxHp = 100000;
  VS.Enemies.rebuildGrid(g.enemies, g);

  const hpBefore = boss.hp;
  let guard = 0;
  VS.Weapons.update(g.weapons, 0.005, g);
  while (boss.hp === hpBefore && guard++ < 100) {
    VS.Weapons.update(g.weapons, 0.02, g);
  }

  assert.ok(boss.hp < hpBefore, '冰锥仍应对 Boss 造成伤害');
  assert.equal(boss.slowT, 0, 'Boss 不应被寒霜减速');
  assert.equal(boss.slowMul, 1, 'Boss 的减速倍率应保持 1');
});

/* ------------------------------------------------------------------ */
/* 3. 陨星：预警 / 范围命中 / 移出落点 / 进化震爆 / 停火清空            */
/* ------------------------------------------------------------------ */

test('陨星预警期无伤害，落地只命中范围内的敌人', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  equip(g, 'meteor', 1);
  const target = placeEnemy(g, 'brute', p.x + 200, p.y, 100000);

  VS.Weapons.update(g.weapons, 0.005, g);
  assert.equal(g.weapons.meteors.length, 1, '一轮应产生一颗陨星');
  const m = g.weapons.meteors[0];
  assert.ok(m.delay > 0, '陨星应先进入预警');

  const inside = placeEnemy(g, 'brute', m.x + 20, m.y, 100000);
  const outside = placeEnemy(g, 'brute', m.x + m.r + 120, m.y, 100000);
  const targetHp = target.hp;
  const insideHp = inside.hp;
  const outsideHp = outside.hp;

  VS.Weapons.update(g.weapons, 0.5, g);
  assert.equal(target.hp, targetHp, '预警期间落点敌人不应受伤');
  assert.equal(inside.hp, insideHp, '预警期间范围内敌人不应受伤');
  assert.equal(outside.hp, outsideHp, '预警期间范围外敌人也不应受伤');

  VS.Weapons.update(g.weapons, 0.35, g);
  assert.ok(target.hp < targetHp, '落地应命中落点上的敌人');
  assert.ok(inside.hp < insideHp, '落地应命中爆炸范围内的敌人');
  assert.equal(outside.hp, outsideHp, '落地不应命中爆炸范围外的敌人');
});

test('陨星落地时已移出落点的敌人不会受伤', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  equip(g, 'meteor', 1);
  const target = placeEnemy(g, 'brute', p.x + 200, p.y, 100000);

  VS.Weapons.update(g.weapons, 0.005, g);
  const m = g.weapons.meteors[0];
  const hpBefore = target.hp;

  target.x = m.x + m.r + target.radius + 80;
  target.y = m.y;
  VS.Enemies.rebuildGrid(g.enemies, g);

  VS.Weapons.update(g.weapons, 0.9, g);
  assert.equal(target.hp, hpBefore, '敌人已移出落点，落地伤害不应命中');
});

test('陨星范围边缘跨网格的敌人按身体碰撞判定命中', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  const center = placeEnemy(g, 'brute', p.x + 157, p.y, 100000);
  VS.Weapons.update(g.weapons, 0.005, g);
  const m = g.weapons.meteors[0];
  const edge = placeEnemy(g, 'brute', m.x + m.r + center.radius - 1, m.y, 100000);
  assert.ok(Math.floor(edge.x / 64) > Math.floor((m.x + m.r) / 64), '测试目标需要跨过查询网格边界');
  advanceWeapons(g, 0.9, 0.02);
  assert.ok(edge.hp < edge.maxHp, '身体与爆炸相交的敌人不能因网格边界漏伤害');
});

test('进化陨星每次落地只触发一次二次震爆，追加 50% 伤害', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  p.projBonus = 0;
  p.critChance = 0;
  equip(g, 'meteor', C.WEAPONS.meteor.maxLevel, { evolved: true });
  const target = placeEnemy(g, 'brute', p.x + 200, p.y, 10000000);
  const hpBefore = target.hp;

  VS.Weapons.update(g.weapons, 0.005, g);
  assert.equal(g.weapons.meteors.length, 3, '满级进化陨星一轮应落 3 颗：基础 2 + 进化 1');

  const meteorDamage = g.weapons.meteors.map(m => m.damage);
  const aftershockMul = g.weapons.meteors[0].aftershockMul;
  assert.equal(aftershockMul, 0.5, '进化应配置为追加 50% 伤害的震爆');

  /* 0.7 秒仍在预警内（首颗 0.8 秒），之后 0.5 秒内全部落地。 */
  VS.Weapons.update(g.weapons, 0.7, g);
  assert.equal(target.hp, hpBefore, '全部落地前不应结算伤害');

  VS.Weapons.update(g.weapons, 0.5, g);
  const expectedLand = meteorDamage.reduce((sum, dmg) => sum + dmg, 0);
  const landDamage = hpBefore - target.hp;
  assert.ok(Math.abs(landDamage - expectedLand) < 1e-6,
    '落地总伤害应等于各陨星一次命中的总和');
  const hpAfterLand = target.hp;

  const expectedShock = expectedLand * aftershockMul;
  VS.Weapons.update(g.weapons, 0.46, g);
  const shockDamage = hpAfterLand - target.hp;
  assert.ok(Math.abs(shockDamage - expectedShock) < 1e-6,
    '每颗陨星应各追加一次 50% 震爆');

  const hpAfterShock = target.hp;
  g.player.weapons = [];                 // 停掉后续齐射，单独验证震爆不会重复
  VS.Weapons.update(g.weapons, 1.0, g);
  assert.equal(target.hp, hpAfterShock, '二次震爆不能在同一颗陨星上重复触发');
});

test('陨星停火后实体全部清空', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  equip(g, 'meteor', 1);
  placeEnemy(g, 'brute', p.x + 200, p.y, 100000);

  VS.Weapons.update(g.weapons, 0.005, g);
  assert.equal(g.weapons.meteors.length, 1, '前置条件：应已生成陨星');
  g.player.weapons = [];                 // 停火
  advanceWeapons(g, 2.5, 0.05);

  assert.equal(g.weapons.meteors.length, 0, '停火并等待后陨星实体应清空');
  assert.equal(g.weapons.blasts.length, 0, '停火并等待后爆炸实体应清空');
  assert.equal(g.weapons.projectiles.length, 0, '停火后不应残留投射物');
  assert.equal(g.weapons.novas.length, 0, '停火后不应残留新星');
});

/* ------------------------------------------------------------------ */
/* 4. 四条进化：配方、重复进化、武器栏位与流派保留                      */
/* ------------------------------------------------------------------ */

const EVOLUTION_CASES = [
  { id: 'bolt', other: 'garlic' },
  { id: 'garlic', other: 'orbit' },
  { id: 'frost', other: 'nova' },
  { id: 'meteor', other: 'bolt' }
];

EVOLUTION_CASES.forEach(spec => {
  test('进化配方 ' + spec.id + '：未满足不可进化、满足可进化、不可重复', function () {
    const p = VS.Player.create(VS.World.create());
    assert.equal(VS.Weapons.add(p, spec.id), true, '前置条件：加入目标武器');
    assert.equal(VS.Weapons.add(p, spec.other), true, '前置条件：加入相邻武器用于检查栏位');

    const w = VS.Weapons.get(p, spec.id);
    const neighbor = VS.Weapons.get(p, spec.other);
    const slotCount = p.weapons.length;
    const mainIndex = p.weapons.indexOf(w);
    const school = 2;
    w.school = school;
    const def = C.EVOLUTIONS[spec.id];
    w.level = C.WEAPONS[spec.id].maxLevel - 1;

    let status = VS.Weapons.evolutionStatus(p, spec.id);
    assert.equal(status.levelReady, false, spec.id + ' 未满级时 levelReady 应为 false');
    assert.equal(status.ready, false, spec.id + ' 未满级时不可进化');
    assert.equal(VS.Weapons.evolve(p, spec.id), false, spec.id + ' 未满级时 evolve 应拒绝');

    for (let i = 0; i < def.passiveLevel; i++) {
      VS.Player.applyUpgrade(p, upgradeDef(def.passive));
    }
    status = VS.Weapons.evolutionStatus(p, spec.id);
    assert.equal(status.passiveLevel, def.passiveLevel, spec.id + ' 被动层数应记录在玩家身上');
    assert.equal(status.levelReady, false, spec.id + ' 满被动但未满级仍不可进化');
    assert.equal(VS.Weapons.evolve(p, spec.id), false, spec.id + ' 未满级时仍应拒绝进化');

    w.level = C.WEAPONS[spec.id].maxLevel;
    p.upgrades[def.passive] = 0;          // 只清配方层数，模拟“满级但被动不够”
    status = VS.Weapons.evolutionStatus(p, spec.id);
    assert.equal(status.levelReady, true, spec.id + ' 满级后 levelReady 应为 true');
    assert.equal(status.ready, false, spec.id + ' 被动不足时不可进化');
    assert.equal(VS.Weapons.evolve(p, spec.id), false, spec.id + ' 被动不足时 evolve 应拒绝');
    assert.equal(w.evolved, undefined, spec.id + ' 失败进化不应留下 evolved 标记');

    for (let i = 0; i < def.passiveLevel; i++) {
      VS.Player.applyUpgrade(p, upgradeDef(def.passive));
    }
    status = VS.Weapons.evolutionStatus(p, spec.id);
    assert.equal(status.ready, true, spec.id + ' 满级且被动满足后应可进化');
    assert.equal(VS.Weapons.evolve(p, spec.id), true, spec.id + ' 满足配方后 evolve 应成功');
    assert.equal(w.evolved, true, spec.id + ' 进化后应标记 evolved');

    assert.equal(p.weapons.length, slotCount, spec.id + ' 进化不应改变武器栏位数量');
    assert.equal(p.weapons.indexOf(w), mainIndex, spec.id + ' 进化不应移动武器栏位');
    assert.equal(VS.Weapons.get(p, spec.other), neighbor, spec.id + ' 进化不应替换相邻武器');
    assert.equal(w.school, school, spec.id + ' 进化应保留流派层数');
    assert.equal(w.level, C.WEAPONS[spec.id].maxLevel, spec.id + ' 进化应保留武器等级');

    status = VS.Weapons.evolutionStatus(p, spec.id);
    assert.equal(status.evolved, true, spec.id + ' 进化状态应显示 evolved');
    assert.equal(VS.Weapons.evolve(p, spec.id), false, spec.id + ' 已进化后不能重复进化');
  });
});

/* ------------------------------------------------------------------ */
/* 5. 进化经商店上架并由购买生效                                       */
/* ------------------------------------------------------------------ */

test('进化经商店上架、购买应用，已进化不再重复上架', function () {
  const g = newGame({ startWeapon: 'bolt' });
  const p = g.player;
  const w = p.weapons[0];
  const def = C.EVOLUTIONS.bolt;
  w.level = C.WEAPONS.bolt.maxLevel;
  for (let i = 0; i < def.passiveLevel; i++) {
    VS.Player.applyUpgrade(p, upgradeDef(def.passive));
  }

  assert.ok(VS.Game.upgradePool(g).some(c => c.kind === 'evolution' && c.id === 'bolt'),
    '满足配方时合法池应包含 bolt 进化');

  g.shop.offers = [];
  g.shop.coins = 200;
  VS.Game.openShop(g);
  withRandom(0, () => assert.equal(VS.Shop.refresh(g, false), true));

  const index = g.shop.offers.findIndex(offer =>
    offer && offer.choice.kind === 'evolution' && offer.choice.id === 'bolt');
  assert.ok(index >= 0, '满足配方时货架应上架进化');
  const offer = g.shop.offers[index];
  assert.equal(offer.choice.isEvolution, true, '进化商品应带 isEvolution 标记');
  assert.equal(offer.price, 75, '进化基础价应为 75 金币（未购买过时）');

  assert.equal(VS.Game.buyShop(g, index, offer.token), true, '购买进化应成功');
  assert.equal(w.evolved, true, '购买后武器应进入进化状态');
  assert.equal(g.shop.coins, 125, '进化应按货架价格扣钱');
  assert.equal(VS.Weapons.evolutionStatus(p, 'bolt').evolved, true, '进化状态应可查询');
  assert.equal(VS.Game.upgradePool(g).some(c => c.kind === 'evolution' && c.id === 'bolt'), false,
    '已经进化的武器不应再次出现在合法池中');

  const coins = g.shop.coins;
  assert.equal(VS.Game.buyShop(g, index, offer.token), false, '重复购买同一进化应失败');
  assert.equal(g.shop.coins, coins, '失败购买不能扣钱');
});

/* ------------------------------------------------------------------ */
/* 6. 新效果实体上限                                                   */
/* ------------------------------------------------------------------ */

test('陨星实体不超过 MAX_METEORS', function () {
  const g = newGame({ startWeapon: 'meteor' });
  const p = g.player;
  const w = equip(g, 'meteor', 1);
  placeEnemy(g, 'brute', p.x + 200, p.y, 100000);

  for (let i = 0; i < C.WEAPON_EFFECTS.MAX_METEORS + 8; i++) {
    w.cd = 0;
    VS.Weapons.update(g.weapons, 0, g);
    assert.ok(g.weapons.meteors.length <= C.WEAPON_EFFECTS.MAX_METEORS,
      '陨星实体数不能超过配置上限');
  }
  assert.equal(g.weapons.meteors.length, C.WEAPON_EFFECTS.MAX_METEORS,
    '持续开火应恰好填满陨星实体上限');
});

test('寒霜碎裂爆炸实体不超过 MAX_BLASTS', function () {
  const g = newGame({ startWeapon: 'frost' });
  const p = g.player;
  p.projBonus = 20;                       // 25 枚冰锥 × 3 穿透，制造大量碎裂
  p.critChance = 0;
  equip(g, 'frost', C.WEAPONS.frost.maxLevel, { evolved: true });

  /* 目标用于触发开火；密集竖排敌人让冰锥有足够的穿透命中来产生碎裂。 */
  placeEnemy(g, 'brute', p.x + 220, p.y, 10000000);
  for (let y = -100; y <= 100; y += 4) {
    placeEnemy(g, 'bat', p.x + 150, p.y + y, 10000000);
  }

  VS.Weapons.update(g.weapons, 0.005, g);
  let maxBlasts = 0;
  for (let i = 0; i < 80; i++) {
    VS.Weapons.update(g.weapons, 0.01, g);
    maxBlasts = Math.max(maxBlasts, g.weapons.blasts.length);
    assert.ok(g.weapons.blasts.length <= C.WEAPON_EFFECTS.MAX_BLASTS,
      '碎裂爆炸实体数不能超过配置上限');
  }
  assert.equal(maxBlasts, C.WEAPON_EFFECTS.MAX_BLASTS,
    '密集碎裂命中应把爆炸实体填到上限，且没有越过上限');
});

test('减速改变实际移动距离，结束后恢复普通追击', function () {
  const g = newGame();
  const p = g.player;
  const e = placeEnemy(g, 'zombie', p.x + 250, p.y, 100000);
  e.wobbleAmp = 0;
  const x0 = e.x;
  VS.Enemies.slow(e, 0.5, 1);
  VS.Enemies.moveAndCollide(g.enemies, 0.1, g);
  const slowed = x0 - e.x;
  e.x = x0;
  e.slowT = 0;
  VS.Enemies.moveAndCollide(g.enemies, 0.1, g);
  assert.ok(Math.abs((x0 - e.x) / slowed - 2) < 1e-6, '减速应使普通追击距离减半');
});

test('弱减速不能刷新强减速的持续时间', function () {
  const g = newGame();
  const e = placeEnemy(g, 'zombie', g.player.x + 400, g.player.y, 100000);
  VS.Enemies.slow(e, 0.25, 1.5);
  VS.Enemies.moveAndCollide(g.enemies, 0.1, g);
  const strongRemaining = e.slowT;
  assert.equal(VS.Enemies.slow(e, 0.8, 5), false);
  assert.equal(e.slowMul, 0.25);
  assert.equal(e.slowT, strongRemaining, '光环不能无限延长冰锥的强减速');
  for (let i = 0; i < 40; i++) VS.Enemies.moveAndCollide(g.enemies, 0.05, g);
  assert.equal(e.slowT, 0);
  assert.equal(VS.Enemies.slow(e, 0.8, 0.8), true, '强减速结束后可重新施加弱减速');
  assert.equal(e.slowMul, 0.8);
});

test('追星弹幕命中后转向未命中的敌人，不重复命中原目标', function () {
  const g = newGame();
  const p = g.player;
  equip(g, 'bolt', 8, { evolved: true });
  const first = placeEnemy(g, 'brute', p.x + 120, p.y, 100000);
  const second = placeEnemy(g, 'brute', p.x + 120, p.y + 140, 100000);
  VS.Weapons.update(g.weapons, 0.005, g);
  const pr = g.weapons.projectiles.find(item => item.target === first);
  assert.ok(pr && pr.ricochet);
  g.weapons.projectiles = [pr];
  p.weapons = [];
  advanceWeapons(g, 0.25, 0.01);
  assert.ok(first.hp < first.maxHp, '首个目标应受伤');
  assert.equal(pr.target, second, '命中后应转向侧面的其他目标');
  const firstHp = first.hp;
  advanceWeapons(g, 0.6, 0.01);
  assert.ok(second.hp < second.maxHp, '弹道应实际命中转向后的目标');
  assert.equal(first.hp, firstHp, '同一颗弹不能重复命中原目标');
});

test('噬魂领域按实际命中回血并有每脉冲上限，护盾免疫不回血', function () {
  const g = newGame();
  const p = g.player;
  const w = equip(g, 'garlic', 8, { evolved: true });
  p.hp = 50;
  for (let i = 0; i < 8; i++) placeEnemy(g, 'brute', p.x + 40, p.y + i * 3, 100000);
  VS.Weapons.update(g.weapons, 0.01, g);
  assert.equal(p.hp, 52, '多目标命中回复最多 2 点');
  assert.ok(g.enemies.list.every(e => e.slowT > 0), '领域应减速普通敌人');
  g.enemies.list = [];
  const boss = placeEnemy(g, 'brute', p.x + 50, p.y, 100000);
  boss.boss = true;
  boss.ai = { invuln: 999 };
  const hp = p.hp;
  w.cd = 0;
  VS.Weapons.update(g.weapons, 0.01, g);
  assert.equal(p.hp, hp, '免疫命中不能用于回血');
});

test('极夜冰棺的命中碎裂伤害与减速覆盖弹道旁的敌人', function () {
  const g = newGame({ startWeapon: 'frost' });
  const p = g.player;
  equip(g, 'frost', 8, { evolved: true });
  const first = placeEnemy(g, 'brute', p.x + 150, p.y, 100000);
  const neighbor = placeEnemy(g, 'bat', p.x + 150, p.y + 50, 100000);
  VS.Weapons.update(g.weapons, 0.005, g);
  const pr = g.weapons.projectiles.reduce((best, item) => Math.abs(item.angle) < Math.abs(best.angle) ? item : best);
  g.weapons.projectiles = [pr];
  p.weapons = [];
  advanceWeapons(g, 0.4, 0.01);
  assert.ok(first.hp < first.maxHp);
  assert.ok(neighbor.hp < neighbor.maxHp, '不在弹道上的邻近敌人应受到碎裂范围伤害');
  assert.equal(neighbor.slowMul, 0.25, '进化碎裂应施加 75% 减速');
});

console.log('PASS: 内容机制（初始武器与第二关继承、寒霜、陨星、四条进化、商店进化、实体上限）');
