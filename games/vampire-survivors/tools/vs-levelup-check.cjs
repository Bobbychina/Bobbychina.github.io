/* 独立校验升级卡、关卡重置和新增增益；不依赖浏览器或存档。 */
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
  'js/game/enemies.js', 'js/game/pickups.js', 'js/game/pets.js', 'js/game/game.js'
].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file }));

const VS = sandbox.window.VS;
VS.Audio = { play() {} };
const game = VS.Game.create({ data: {}, input: { getAxis: () => ({ x: 0, y: 0 }) } });
game.state = VS.Game.STATE.PLAYING;

VS.Player.grantLevel(game.player);
VS.Player.grantLevel(game.player);
game.pendingLevels = 2;
VS.Game.openLevelUp(game);
assert.equal(game.choices.length, 3);
assert.equal(new Set(game.choices.map(c => c.kind + ':' + c.id)).size, 3);
let previous = game.choices.map(c => c.kind + ':' + c.id);
assert.equal(VS.Game.reroll(game), true);
assert.equal(game.pendingLevels, 2);
assert.equal(game.rerollsRemaining, 1);
assert.ok(game.choices.some(c => !previous.includes(c.kind + ':' + c.id)));
previous = game.choices.map(c => c.kind + ':' + c.id);
assert.equal(VS.Game.reroll(game), true);
assert.ok(game.choices.some(c => !previous.includes(c.kind + ':' + c.id)));
assert.equal(game.rerollsRemaining, 0);
assert.equal(VS.Game.reroll(game), false);
assert.equal(VS.Game.choose(game, 0), true);
assert.equal(game.pendingLevels, 1);
assert.equal(game.state, VS.Game.STATE.LEVELUP);
assert.equal(VS.Game.choose(game, 0), true);
assert.equal(game.state, VS.Game.STATE.PLAYING);

const p = VS.Player.create(VS.World.create());
const upgrade = id => VS.Config.UPGRADES.find(item => item.id === id);
VS.Player.applyUpgrade(p, upgrade('evasion'));
assert.equal(VS.Player.dash(p, { x: 1, y: 0 }, null), true);
assert.ok(Math.abs(p.dashCd - 1.275) < 1e-9);
p.hp = 30;
VS.Player.applyUpgrade(p, upgrade('fieldDressing'));
assert.equal(p.hp, 60);
assert.equal(p.regen, 1.3);
VS.Player.applyUpgrade(p, upgrade('lastStand'));
const damageGame = { player: p, weapons: VS.Weapons.create(), enemies: { list: [{ x: p.x + 100, y: p.y, dead: false }] } };
p.hp = p.maxHp / 2 + 1;
VS.Weapons.firePetBolt(damageGame, p.x, p.y);
const normalDamage = damageGame.weapons.projectiles.pop().damage;
p.hp = p.maxHp / 2;
VS.Weapons.firePetBolt(damageGame, p.x, p.y);
const lowHealthDamage = damageGame.weapons.projectiles.pop().damage;
assert.ok(Math.abs(lowHealthDamage / normalDamage - 1.18) < 1e-9);

game.player.kills = 13;
VS.Game.startLevel(game, 1);
assert.equal(game.rerollsRemaining, 2);
assert.equal(game.player.kills, 13);
assert.equal(game.player.weapons.length, 1);
assert.equal(game.player.weapons[0].id, 'bolt');
game.player.weapons = ['bolt', 'garlic', 'orbit', 'nova'].map(id => ({
  id, level: VS.Config.WEAPONS[id].maxLevel, school: VS.Config.WEAPONS[id].school.max, evolved: true
}));
VS.Config.UPGRADES.forEach(item => { game.player.upgrades[item.id] = item.max; });
game.state = VS.Game.STATE.LEVELUP;
game.pendingLevels = 2;
game.player.upgrades.dmg--;
VS.Game.openLevelUp(game);
assert.equal(game.choices.length, 1);
assert.equal(VS.Game.reroll(game), false);
assert.equal(game.rerollsRemaining, 2);
assert.equal(VS.Game.choose(game, 0), true);
assert.equal(game.pendingLevels, 0);
assert.equal(game.state, VS.Game.STATE.PLAYING);
game.state = VS.Game.STATE.LEVELUP;
game.pendingLevels = 2;
VS.Game.openLevelUp(game);
assert.equal(game.pendingLevels, 0);
assert.equal(game.state, VS.Game.STATE.PLAYING);

console.log('PASS: 重选、连续升级、新增技能、关卡重置、空卡池恢复');
