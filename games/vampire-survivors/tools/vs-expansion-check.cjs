/* 扩展战斗与无尽回归；真实模块、固定位置与 dt，无浏览器或网络依赖。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const storage = new Map();
const sandbox = { window: { innerWidth: 1280, innerHeight: 720, localStorage: {
  getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value)
} }, console };
vm.createContext(sandbox);
[
  'core/namespace', 'core/utils', 'game/config', 'game/arsenal-config', 'core/save', 'core/scores',
  'game/phases', 'game/levels', 'game/world', 'game/effects', 'game/player', 'game/weapons', 'game/arsenal',
  'game/enemies', 'game/pickups', 'game/pets', 'game/game'
].forEach(file => vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), sandbox, { filename: file }));
const VS = sandbox.window.VS, C = VS.Config;
VS.Audio = { play() {}, unlock() {} };
let passes = 0;
function test(name, fn) { fn(); passes++; console.log('PASS: ' + name); }
function game(id, school, mode) {
  const g = VS.Game.create({ data: VS.Save.load(), input: { getAxis: () => ({ x: 0, y: 0 }) } });
  VS.Game.current = g;
  VS.Game.start(g, { startWeapon: id || 'sickle', mode: mode || 'campaign' });
  g.textBudget = 0; g.sparkBudget = 0;
  if (school) assert.equal(VS.Weapons.chooseSchool(g.player, id, id + '_' + school), true);
  return g;
}
function enemy(g, dx, dy, hp = 10000, type = 'zombie') {
  const e = VS.Enemies.spawn(g.enemies, C.ENEMY_TYPES[type], g, { x: g.player.x + dx, y: g.player.y + dy });
  e.hp = e.maxHp = hp; VS.Enemies.rebuildGrid(g.enemies, g); return e;
}
function advance(g, seconds, dt = 0.02) {
  for (let t = 0; t < seconds - 1e-8; t += dt) {
    VS.Enemies.rebuildGrid(g.enemies, g); VS.Weapons.update(g.weapons, dt, g);
  }
}
function once(g, seconds) { VS.Weapons.update(g.weapons, 0, g); g.player.weapons[0].cd = 10000; advance(g, seconds); }
function extra(g) { return g.weapons.extra; }
function rank3(g) { const w = g.player.weapons[0]; w.schoolRank = 3; return w; }

test('16 把基础武器、24 个独立分支、11 个可直接开局的武器', () => {
  assert.equal(Object.keys(C.WEAPONS).length, 16); assert.equal(Object.keys(C.SCHOOLS).length, 24);
  assert.equal(new Set(C.NEW_WEAPON_POOL).size, 16); assert.equal(new Set(C.START_WEAPONS).size, 11);
  for (const [id, s] of Object.entries(C.SCHOOLS)) {
    assert.equal(C.WEAPONS[s.weapon].schools.includes(id), true);
    const g = game(s.weapon); assert.equal(VS.Weapons.chooseSchool(g.player, s.weapon, id), true);
    assert.equal(VS.Weapons.chooseSchool(g.player, s.weapon, C.WEAPONS[s.weapon].schools.find(x => x !== id)), false);
    assert.equal(VS.Weapons.chooseSchool(g.player, s.weapon, id), true);
    assert.equal(VS.Weapons.chooseSchool(g.player, s.weapon, id), true);
    assert.equal(VS.Weapons.chooseSchool(g.player, s.weapon, id), false);
    const w = g.player.weapons[0], a = VS.Weapons.statsFor(g, s.weapon, 8, w), b = VS.Weapons.statsFor(g, s.weapon, 8, w);
    assert.deepEqual(a, b, id + ' 重复计算不累积属性');
    for (const value of Object.values(a)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
});
test('选定分支后，抽卡池只产生该分支的后续等级', () => {
  const g = game('sickle', 'hook'), w = g.player.weapons[0];
  g.player.weapons = [w, { id: 'bolt', level: 8, evolved: true, school: 3 }, { id: 'garlic', level: 8, evolved: true, school: 3 }, { id: 'orbit', level: 8, school: 3 }];
  w.level = 8; C.UPGRADES.forEach(up => { g.player.upgrades[up.id] = up.max; });
  const cards = VS.Game._buildChoices(g).choices;
  assert.equal(cards.length, 1); assert.equal(cards[0].schoolId, 'sickle_hook');
  assert.equal(VS.Game._applyChoice(g, cards[0]), true); assert.equal(w.schoolRank, 2);
});
test('回魂镰去程与回程各命中一次，收割回血只来自真实回程命中', () => {
  const g = game('sickle', 'harvest'); g.player.hp = 40;
  const e = enemy(g, 120, 0); once(g, 2.8);
  assert.equal(e.maxHp - e.hp, 36); assert.ok(g.player.hp > 40 && g.player.hp <= 42);
  assert.equal(extra(g).sickles.length, 0);
});
test('双月增加实际镰刃数量，引魂真的移动普通敌人且不移动首领', () => {
  const twins = game('sickle', 'twins'); VS.Weapons.update(twins.weapons, 0, twins); assert.equal(extra(twins).sickles.length, 2);
  const hook = game('sickle', 'hook'), e = enemy(hook, 75, 10), boss = enemy(hook, 75, -10, 10000, 'boss');
  const ex = e.x, ey = e.y, bx = boss.x, by = boss.y; once(hook, 0.4);
  assert.ok(e.x !== ex || e.y !== ey); assert.equal(boss.x, bx); assert.equal(boss.y, by);
});
test('圣枪贯穿多个目标；处刑仅对低血目标增伤', () => {
  const g = game('lance', 'execution'); const a = enemy(g, 70, 0), b = enemy(g, 160, 0), off = enemy(g, 110, 90);
  a.hp = 3000; once(g, 0.1);
  assert.ok(Math.abs(3000 - a.hp - 36.4) < 1e-6); assert.equal(10000 - b.hp, 28); assert.equal(off.hp, 10000);
});
test('回声有延迟且追加真实突刺；壁垒有无敌与普通敌人击退', () => {
  const g = game('lance', 'echo'), e = enemy(g, 100, 0); VS.Weapons.update(g.weapons, 0, g); g.player.weapons[0].cd = 100;
  assert.equal(10000 - e.hp, 28); advance(g, 0.26); assert.equal(10000 - e.hp, 56);
  const guard = game('lance', 'bastion'), target = enemy(guard, 100, 0), x = target.x;
  VS.Weapons.update(guard.weapons, 0, guard); assert.equal(guard.player.invuln, 0.08); assert.ok(target.x > x);
});
test('地雷布防前不爆炸，霜纹命中减速，首领免疫控制', () => {
  const g = game('mine', 'frost'), e = enemy(g, -25, 0), boss = enemy(g, -25, 10, 10000, 'boss');
  VS.Weapons.update(g.weapons, 0, g); g.player.weapons[0].cd = 100;
  advance(g, 0.2); assert.equal(e.hp, 10000);
  advance(g, 0.3); assert.equal(10000 - e.hp, 32); assert.equal(e.slowMul, 0.85); assert.equal(boss.slowT, 0);
});
test('连锁爆破能引爆未接触敌人的相邻地雷，破片产生真实弹丸', () => {
  const g = game('mine', 'chain'); enemy(g, -25, 0); VS.Weapons.update(g.weapons, 0, g); g.player.weapons[0].cd = 100;
  const m = extra(g).mines[0]; extra(g).mines.push({ ...m, x: m.x + 100, arm: 0 }); once(g, 0.6);
  assert.equal(extra(g).mines.length, 0); assert.equal(extra(g).flashes.length, 2);
  const shards = game('mine', 'shrapnel'); enemy(shards, -25, 0); once(shards, 0.46); assert.equal(extra(shards).projectiles.length, 8);
});
test('图腾分岔增加命中数，静电第三跳追加伤害', () => {
  const fork = game('totem', 'fork'); const es = [enemy(fork, 80, 0), enemy(fork, 85, 10), enemy(fork, 85, -10)];
  once(fork, 0.02); assert.ok(es.every(e => e.hp === 9992));
  const g = game('totem', 'static'), e = enemy(g, 100, 0); once(g, 1.42);
  assert.ok(Math.abs(10000 - e.hp - 28.8) < 1e-6);
});
test('风眼持续牵引普通敌人且不移动首领', () => {
  const g = game('totem', 'eye'), e = enemy(g, 130, 0), b = enemy(g, 135, 0, 10000, 'boss'); const x = e.x, bx = b.x;
  once(g, 0.3); assert.ok(e.x < x); assert.equal(b.x, bx);
});
test('蜂群锁敌优先首领并造成增伤，交叉火力实际双发', () => {
  const g = game('drone', 'focus'), normal = enemy(g, 100, 80), boss = enemy(g, 210, 0, 10000, 'boss');
  once(g, 0.5); assert.ok(boss.hp < 10000); assert.ok((10000 - boss.hp) % 7.5 === 0);
  assert.ok(normal.hp <= 10000);
  const cross = game('drone', 'crossfire'); enemy(cross, 320, 0); VS.Weapons.update(cross.weapons, 0, cross);
  assert.equal(extra(cross).projectiles.length, 4); assert.ok(extra(cross).projectiles.every(p => p.pierce === 2));
});
test('修复按整群每五秒结算，不按无人机数量重复回血', () => {
  const g = game('drone', 'repair'); rank3(g); g.player.hp = 20; g.player.projBonus = 8;
  advance(g, 5.1); assert.equal(g.player.hp, 24.5);
});
test('引力球坍缩额外爆炸，深井飞行结束后静止并继续造成伤害', () => {
  const g = game('gravity', 'collapse'), e = enemy(g, 320, 0); once(g, 3.22);
  assert.ok(10000 - e.hp >= 21); assert.equal(extra(g).orbs.length, 0); assert.ok(extra(g).flashes.length > 0);
  const well = game('gravity', 'well'); once(well, 3.3); assert.equal(extra(well).orbs.length, 1);
  const orb = extra(well).orbs[0], x = orb.x; const target = enemy(well, x - well.player.x + 20, 0);
  advance(well, 0.5); assert.equal(orb.x, x); assert.ok(target.hp < 10000);
});
test('潮汐交替吸入与推出，首领不受引力控制', () => {
  const g = game('gravity', 'tide'); VS.Weapons.update(g.weapons, 0, g); g.player.weapons[0].cd = 100;
  const orb = extra(g).orbs[0]; orb.st = { ...orb.st, speed: 0 };
  const e = enemy(g, 50, 0), boss = enemy(g, 45, 0, 10000, 'boss'); const bx = boss.x, x = e.x;
  advance(g, 0.3); assert.ok(e.x < x); const inX = e.x; orb.age = 0.9;
  advance(g, 0.2); assert.ok(e.x > inX); assert.equal(boss.x, bx);
});
test('焰舌有扇形边界与持续燃烧；熔炉伤害增强但角度缩窄', () => {
  const g = game('flame'), e = enemy(g, 90, 0), outside = enemy(g, 0, 100); once(g, 1.3);
  assert.equal(10000 - e.hp, 16); assert.equal(outside.hp, 10000);
  const furnace = game('flame', 'furnace'), target = enemy(furnace, 90, 0); once(furnace, 1.3);
  assert.ok(Math.abs(10000 - target.hp - 20.8) < 1e-6);
});
test('野火死亡传播最多一代，余烬留地并独立跳伤', () => {
  const g = game('flame', 'wildfire'), first = enemy(g, 100, 0, 12), second = enemy(g, 175, 0), third = enemy(g, 250, 0);
  once(g, 0.7); assert.equal(first.dead, true); assert.ok(extra(g).burns.some(b => b.enemy === second && b.depth === 1));
  VS.Enemies.kill(g, second); advance(g, 0.1); assert.equal(extra(g).burns.some(b => b.enemy === third), false);
  const ash = game('flame', 'ash'), e = enemy(ash, 90, 0); once(ash, 0.7);
  assert.ok(extra(ash).scorches.length === 1); assert.ok(10000 - e.hp > 13);
});
test('棱镜真实线段碰撞：沿线重复伤害，远离光束者无伤', () => {
  const g = game('prism', 'overload'), e = enemy(g, 150, 0), off = enemy(g, 120, 100); once(g, 0.62);
  assert.ok(10000 - e.hp >= 36); assert.equal(off.hp, 10000);
});
test('折射三束各有判定，映照向背后发射且延长持续时间', () => {
  const g = game('prism', 'refraction'); enemy(g, 120, 0); VS.Weapons.update(g.weapons, 0, g); assert.equal(extra(g).beams.length, 3);
  const reflect = game('prism', 'reflection'), front = enemy(reflect, 120, 0), back = enemy(reflect, -120, 0);
  once(reflect, 0.78); assert.ok(front.hp < 10000 && back.hp < 10000); assert.equal(extra(reflect).beams.length, 0);
});
test('无敌首领不触发收割治疗；所有扩展实体停火后消散', () => {
  const g = game('sickle', 'harvest'), boss = enemy(g, 120, 0, 10000, 'boss'); boss.ai = { invuln: 10 }; g.player.hp = 20;
  once(g, 2.8); assert.equal(g.player.hp, 20); assert.equal(boss.hp, 10000);
  for (const id of Object.keys(C.WEAPONS).filter(id => C.WEAPONS[id].arsenal)) {
    const local = game(id); enemy(local, 120, 0); VS.Weapons.update(local.weapons, 0, local); local.player.weapons = [];
    advance(local, 18);
    for (const key of Object.keys(Limits())) assert.equal(extra(local)[key].length, 0, id + ':' + key);
  }
});
function Limits() { return C.ARSENAL_LIMITS; }
test('高攻速四武器持续作战不突破实体容量；重开清空实体与分支', () => {
  const g = game('mine', 'shrapnel'); g.player.attackSpeedMul = 100; g.player.projBonus = 20;
  ['sickle', 'drone', 'prism'].forEach(id => VS.Weapons.add(g.player, id));
  g.player.weapons.forEach(w => { w.level = 8; if (!w.schoolId) VS.Weapons.chooseSchool(g.player, w.id, C.WEAPONS[w.id].schools[1]); });
  for (let i = 0; i < 80; i++) enemy(g, Math.cos(i) * 180, Math.sin(i) * 180, 1e9);
  advance(g, 12);
  for (const [key, limit] of Object.entries(Limits())) assert.ok(extra(g)[key].length <= limit, key);
  VS.Game.start(g); assert.ok(g.player.weapons.every(w => !w.schoolId));
  for (const key of Object.keys(Limits())) assert.equal(extra(g)[key].length, 0);
});
test('无尽跨过 10 与 15 分钟保持构筑和等级、刷新重选且不进入过关面板', () => {
  const g = game('gravity', 'well', 'endless'), w = g.player.weapons[0]; w.level = 7; g.player.level = 105;
  g.player.invuln = 9999; g.onXp = () => {}; g.time = 599.99; g.rerollsRemaining = 0;
  VS.Game.step(g, 0.02); assert.equal(g.level, 1); assert.equal(g.player.weapons[0], w); assert.equal(g.player.level, 105);
  g.time = 899.99; VS.Game.step(g, 0.02); assert.equal(g.state, VS.Game.STATE.PLAYING); assert.equal(g.endlessWave, 6);
  assert.equal(g.rerollsRemaining, C.LEVELUP_REROLLS); assert.equal(VS.Game.clearLevel(g), false);
  assert.equal(VS.Player.grantLevel(g.player), true); assert.equal(g.player.level, 106); assert.ok(Number.isFinite(g.player.xpNeeded));
});
test('无尽首领持续轮换，单只存活时不重复生成，击败后仍可刷新', () => {
  const g = game('bolt', null, 'endless'); g.player.invuln = 9999; g.onXp = () => {};
  g.time = 300; VS.Enemies.update(g.enemies, 0, g); const first = g.enemies.boss;
  assert.ok(first); g.time = 601; VS.Enemies.update(g.enemies, 0, g); assert.equal(g.enemies.boss, first);
  VS.Enemies.kill(g, first); g.pendingLevels = 0; g.pendingPetSelect = false; VS.Enemies.update(g.enemies, 0, g);
  assert.equal(g.enemies.boss.type, 'lemonPig'); const second = g.enemies.boss;
  VS.Enemies.kill(g, second); g.time = 902; VS.Enemies.update(g.enemies, 0, g); assert.equal(g.enemies.boss.type, 'boss');
  assert.equal(g.enemies.bossCount, 3);
});
test('无尽后期倍率有限，满构筑仍有补给卡，战役等级仍封顶', () => {
  const g = game('sickle', 'hook', 'endless');
  for (const t of [0, 1800, 360000000]) for (const v of Object.values(VS.Enemies.scaleFor(t, 1, 'endless'))) assert.ok(Number.isFinite(v) && v > 0);
  const w = g.player.weapons[0]; w.level = 8; w.schoolRank = 3;
  ['bolt', 'garlic', 'frost'].forEach(id => { VS.Weapons.add(g.player, id); const v = VS.Weapons.get(g.player, id); v.level = 8; v.school = 999; v.evolved = true; });
  C.UPGRADES.forEach(up => { g.player.upgrades[up.id] = up.max; });
  const choices = VS.Game._buildChoices(g).choices; assert.equal(choices.length, 3); assert.ok(choices.every(c => c.kind === 'supply'));
  const campaign = game('bolt'); campaign.player.level = 99; assert.equal(VS.Player.grantLevel(campaign.player), false);
});
test('战役与无尽分别记录，重复结算无副作用，无尽不提交战役排行榜', () => {
  storage.clear(); const g = game('sickle', null, 'endless'); let submits = 0;
  VS.Leaderboard = { canSubmit: () => true }; VS.LeaderboardUI = { submitRun: () => submits++ };
  g.time = 1801; g.player.kills = 123; VS.Game.endRun(g); VS.Game.endRun(g);
  let data = VS.Save.load(); assert.equal(data.runs, 0); assert.equal(data.endless.runs, 1); assert.equal(data.endless.bestTime, 1801);
  assert.equal(VS.Scores.list('endless').length, 1); assert.equal(VS.Scores.list('campaign').length, 0); assert.equal(submits, 0);
  VS.Game.start(g, { mode: 'campaign' }); g.time = 87; VS.Game.endRun(g); data = VS.Save.load();
  assert.equal(data.runs, 1); assert.equal(data.bestTime, 87); assert.equal(data.endless.bestTime, 1801); assert.equal(submits, 1);
  VS.Save.setSkin(g.data, 'witch'); assert.equal(VS.Save.load().endless.runs, 1);
});
console.log('PASS: 扩展武器 / 分支 / 无尽 / 本机存档，共 ' + passes + ' 组');
