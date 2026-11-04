/* 独立校验金币商店、升级奖励与跨关继承；不依赖浏览器或存档。
   覆盖：真实购买 / 金币不足不扣钱 / 重复购买 / 升级不中断且不免费强化 /
   四关继承 / 满构筑无货可买，以及 evasion、fieldDressing、lastStand 的真实增益。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sandbox = { window: { innerWidth: 1280, innerHeight: 720 }, console };
vm.createContext(sandbox);
[
  'js/core/namespace.js', 'js/core/utils.js', 'js/game/config.js',
  'js/game/chapters-config.js', 'js/game/arsenal-config.js',
  'js/game/phases.js', 'js/game/levels.js', 'js/game/world.js',
  'js/game/effects.js', 'js/game/player.js', 'js/game/weapons.js', 'js/game/arsenal.js',
  'js/game/enemies.js', 'js/game/bosskit.js', 'js/game/encounters.js', 'js/game/stages.js',
  'js/game/pickups.js', 'js/game/pets.js', 'js/game/shop.js', 'js/game/game.js'
].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file }));

const VS = sandbox.window.VS;
const C = VS.Config;
VS.Audio = { play() {}, unlock() {} };

/* 货架抽取使用 Math.random；测试里固定为 0，只用于让货架顺序可复现。 */
vm.runInContext('globalThis.__levelupOriginalRandom = Math.random;', sandbox);
function withRandom(value, fn) {
  vm.runInContext('Math.random = function () { return ' + Number(value) + '; };', sandbox);
  try {
    return fn();
  } finally {
    vm.runInContext('Math.random = globalThis.__levelupOriginalRandom;', sandbox);
  }
}

function newGame() {
  const game = VS.Game.create({ data: {}, input: { getAxis: () => ({ x: 0, y: 0 }) } });
  VS.Game.start(game);
  return game;
}

function findOffer(game, kind, id) {
  for (let i = 0; i < game.shop.offers.length; i++) {
    const offer = game.shop.offers[i];
    if (!offer || offer.sold) continue;
    if (offer.choice.kind === kind && (!id || offer.choice.id === id)) return { index: i, offer: offer };
  }
  return null;
}

function test(name, fn) {
  fn();
  console.log('PASS: ' + name);
}

/* ------------------------------------------------------------------ */
/* 1. 合法池与开局经济                                                 */
/* ------------------------------------------------------------------ */

test('upgradePool 返回全部合法候选，开局保留 30 金币且没有隐藏选卡队列', function () {
  const game = newGame();
  const pool = VS.Game.upgradePool(game);

  assert.ok(Array.isArray(pool), 'upgradePool 应返回数组');
  assert.ok(pool.length > 3, '合法池不应被截成三张卡');
  assert.ok(pool.every(c => c && c.kind && c.id !== undefined), '每个候选项都应带 kind/id');

  assert.equal(game.state, VS.Game.STATE.PLAYING);
  assert.equal(game.shop.coins, 30, '商店初始金币应为 30');
  assert.equal(game.choices, undefined, '不应再有待选卡数组');
  assert.equal(game.pendingLevels, undefined, '不应再有 pendingLevels');
  assert.equal(game.rerollsRemaining, undefined, '不应再有重选次数');
});

/* ------------------------------------------------------------------ */
/* 2. 真实购买、金币不足、重复购买                                     */
/* ------------------------------------------------------------------ */

test('商店真实购买扣钱并生效，金币不足与重复购买都不扣钱', function () {
  const game = newGame();
  game.shop.offers = [];
  game.shop.coins = 100;
  assert.equal(VS.Game.openShop(game), true);
  assert.equal(game.state, VS.Game.STATE.SHOP);

  withRandom(0, () => assert.equal(VS.Shop.refresh(game, false), true));
  const hit = findOffer(game, 'weapon-up', 'bolt');
  assert.ok(hit, '空货架刷新后应保证一件当前武器升级');

  const weapon = VS.Weapons.get(game.player, 'bolt');
  const levelBefore = weapon.level;
  const price = hit.offer.price;
  const token = hit.offer.token;
  assert.equal(price, 12 + levelBefore * 3, '武器升级价格应随当前等级计算');

  assert.equal(VS.Game.buyShop(game, hit.index, token), true);
  assert.equal(game.shop.coins, 100 - price, '购买成功才按货架价格扣钱');
  assert.equal(game.shop.purchases, 1);
  assert.equal(game.shop.spent, price);
  assert.equal(weapon.level, levelBefore + 1, '购买后强化应真的应用到武器');
  assert.equal(hit.offer.sold, true);

  const afterBuy = game.shop.coins;
  assert.equal(VS.Game.buyShop(game, hit.index, token), false, '同一 token 不能重复购买');
  assert.equal(game.shop.coins, afterBuy);

  const other = game.shop.offers.find(offer => offer && !offer.sold && !offer.unavailable);
  assert.ok(other, '应还有其它可购买商品用于验证金币不足');
  const otherIndex = game.shop.offers.indexOf(other);
  const snapshot = JSON.stringify(game.shop.offers.map(offer => offer
    ? { price: offer.price, sold: offer.sold, unavailable: !!offer.unavailable } : null));
  game.shop.coins = 0;
  assert.equal(VS.Game.buyShop(game, otherIndex, other.token), false, '金币不足时应拒绝购买');
  assert.equal(game.shop.coins, 0, '失败购买不能扣钱（也不能变成负数）');
  assert.equal(JSON.stringify(game.shop.offers.map(offer => offer
    ? { price: offer.price, sold: offer.sold, unavailable: !!offer.unavailable } : null)), snapshot,
  '失败购买不能改货架状态');
});

/* ------------------------------------------------------------------ */
/* 3. 升级与首领奖励只加金币，不送强化、不弹面板                       */
/* ------------------------------------------------------------------ */

test('经验升级、超级球和首领奖励只发金币，保持 PLAYING 且不免费强化', function () {
  const game = newGame();
  const p = game.player;
  const weaponsBefore = JSON.stringify(p.weapons);
  const levelBefore = p.level;

  game.onXp(100000);
  const gained = p.level - levelBefore;
  assert.ok(gained > 0, '大批经验应实际升级');
  assert.equal(game.shop.coins, 30 + gained * 12, '每级应只发 12 金币');
  assert.equal(game.state, VS.Game.STATE.PLAYING, '升级不应打断战斗');
  assert.equal(game.choices, undefined, '升级不应弹选卡面板');
  assert.equal(game.pendingLevels, undefined, '升级不应留下待选队列');
  assert.equal(JSON.stringify(p.weapons), weaponsBefore, '升级本身不能免费强化武器');

  const levelAfterXp = p.level;
  const coinsAfterXp = game.shop.coins;
  game.onInstantLevel();
  assert.equal(p.level, levelAfterXp + 1, '超级经验球应直接提升一级');
  assert.equal(game.shop.coins, coinsAfterXp + 12, '超级球升级同样只发 12 金币');
  assert.equal(game.state, VS.Game.STATE.PLAYING);
  assert.equal(JSON.stringify(p.weapons), weaponsBefore);

  const levelAfterInstant = p.level;
  const coinsAfterInstant = game.shop.coins;
  game.onBossReward();
  assert.equal(p.level, levelAfterInstant + 1, '首领奖励应提升一级');
  assert.equal(game.shop.coins,
    coinsAfterInstant + (100 + game.level * 50) + 12,
    '首领赏金按章节下标发放，并叠加升级金币');
  assert.equal(game.state, VS.Game.STATE.PLAYING);
  assert.equal(JSON.stringify(p.weapons), weaponsBefore);

  const levelAfterBoss = p.level;
  const coinsAfterBoss = game.shop.coins;
  game.onFirstBossReward();
  assert.equal(p.level, levelAfterBoss + 1);
  assert.equal(game.shop.coins, coinsAfterBoss + (100 + game.level * 50) + 12);
  assert.equal(game.state, VS.Game.STATE.PLAYING, '宠物面板只标记待选，不打断战斗');
  game.pendingPetSelect = false;
});

/* ------------------------------------------------------------------ */
/* 4. 四关继承                                                         */
/* ------------------------------------------------------------------ */

test('四关全程继承玩家、等级、武器、被动、宠物、遗物与金币', function () {
  const game = newGame();
  const p = game.player;

  p.level = 28;
  p.upgrades.dmg = 3;
  p.weapons[0].level = 5;
  assert.equal(VS.Weapons.add(p, 'garlic'), true);
  game.pets.id = 'faerie';
  game.relics.push('pilgrim');
  game.shop.coins = 457;

  const weapon = p.weapons[0];
  assert.equal(VS.Levels.isFresh(1), false, '第二关 config 应标记 fresh:false');

  for (const index of [1, 2, 3]) {
    VS.Game.startLevel(game, index);
    assert.equal(game.level, index);
    assert.equal(VS.Levels.isFresh(index), false, '第 ' + (index + 1) + ' 关不应重置构筑');
    assert.equal(game.player, p, '跨关应沿用同一个玩家对象');
    assert.equal(p.level, 28, '跨关应保留等级');
    assert.equal(p.weapons[0], weapon, '跨关应保留武器对象');
    assert.equal(weapon.level, 5, '跨关应保留武器等级');
    assert.equal(p.upgrades.dmg, 3, '跨关应保留被动层数');
    assert.equal(game.pets.id, 'faerie', '跨关应保留宠物');
    assert.ok(game.relics.includes('pilgrim'), '跨关应保留遗物');
    assert.equal(game.shop.coins, 457, '跨关应保留金币');
  }
  assert.equal(VS.Levels.count(), 4);
});

/* ------------------------------------------------------------------ */
/* 5. 满构筑商店可以无货可买                                           */
/* ------------------------------------------------------------------ */

test('战役满构筑满血时货架允许为空，刷新和购买都失败且不扣钱', function () {
  const game = newGame();
  const p = game.player;

  ['garlic', 'orbit', 'nova'].forEach(id => assert.equal(VS.Weapons.add(p, id), true));
  p.weapons.forEach(w => {
    const def = C.WEAPONS[w.id];
    w.level = def.maxLevel;
    w.evolved = true;
    if (def.school) w.school = def.school.max;
  });
  C.UPGRADES.forEach(up => { p.upgrades[up.id] = up.max; });
  p.hp = p.maxHp;

  assert.equal(VS.Game.upgradePool(game).length, 0, '满构筑满血的战役没有合法强化');
  game.shop.offers = [];
  game.shop.coins = 500;
  VS.Game.openShop(game);

  assert.equal(VS.Shop.refresh(game, false), false, '没有候选时刷新应失败');
  assert.equal(game.shop.offers.length, 0, '失败刷新不能凭空造出商品');
  assert.equal(VS.Game.buyShop(game, 0, '0'), false, '空货架不能购买');
  assert.equal(game.shop.coins, 500, '失败操作不能扣钱');
});

/* ------------------------------------------------------------------ */
/* 6. 三项被动的真实数值                                               */
/* ------------------------------------------------------------------ */

const p = VS.Player.create(VS.World.create());
const upgrade = id => C.UPGRADES.find(item => item.id === id);

VS.Player.applyUpgrade(p, upgrade('evasion'));
assert.equal(VS.Player.dash(p, { x: 1, y: 0 }, null), true);
assert.ok(Math.abs(p.dashCd - 1.275) < 1e-9, '迅影步伐一层应把闪避冷却变为 1.275 秒');

p.hp = 30;
VS.Player.applyUpgrade(p, upgrade('fieldDressing'));
assert.equal(p.hp, 60, '战地包扎应回复最大生命的 25%');
assert.equal(p.regen, 1.3, '战地包扎应增加每秒 0.3 回复');

VS.Player.applyUpgrade(p, upgrade('lastStand'));
const damageGame = {
  player: p,
  weapons: VS.Weapons.create(),
  enemies: { list: [{ x: p.x + 100, y: p.y, dead: false }] }
};
p.hp = p.maxHp / 2 + 1;
VS.Weapons.firePetBolt(damageGame, p.x, p.y);
const normalDamage = damageGame.weapons.projectiles.pop().damage;
p.hp = p.maxHp / 2;
VS.Weapons.firePetBolt(damageGame, p.x, p.y);
const lowHealthDamage = damageGame.weapons.projectiles.pop().damage;
assert.ok(Math.abs(lowHealthDamage / normalDamage - 1.18) < 1e-9,
  '背水之力一层应在半血时提供 18% 武器伤害');

console.log('PASS: 商店购买、金币边界、升级奖励、四关继承、满构筑无货与三项被动');
