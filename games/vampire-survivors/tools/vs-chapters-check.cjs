/* 章节内容回归：使用真实逻辑模块和可控时钟，检查机制而非只数定义。 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..'), stored = new Map();
const scope = { window: { innerWidth: 1280, innerHeight: 720, localStorage: {
  getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v)
} }, console };
vm.createContext(scope);
['core/namespace','core/utils','game/config','game/chapters-config','game/arsenal-config','core/save','core/scores',
  'game/phases','game/levels','game/world','game/effects','game/player','game/weapons','game/arsenal',
  'game/enemies','game/bosskit','game/encounters','game/stages','game/pickups','game/pets','game/shop','game/game','core/cheats']
  .forEach(p => vm.runInContext(fs.readFileSync(path.join(root, 'js', p + '.js'), 'utf8'), scope, { filename: p }));
const V = scope.window.VS, C = V.Config; V.Audio = { play() {}, unlock() {} }; let passes = 0;
function test(name, fn) { fn(); passes++; console.log('PASS: ' + name); }
function game(index = 2) {
  const g = V.Game.create({ data: V.Save.load(), input: { getAxis: () => ({ x: 0, y: 0 }) } }); V.Game.current = g;
  V.Game.start(g);
  if (index !== 0) V.Game.startLevel(g, index);
  g.textBudget = 0; g.sparkBudget = 0;
  g.player.invuln = 0; g.player.regen = 0; return g;
}
function spawn(g, id, dx, dy, hp = 100000) {
  const e = V.Enemies.spawn(g.enemies, C.ENEMY_TYPES[id], g, { x: g.player.x + dx, y: g.player.y + dy });
  e.hp = e.maxHp = hp; V.Enemies.rebuildGrid(g.enemies, g); return e;
}
function move(g, seconds) {
  for (let t = 0; t < seconds - 1e-8; t += 0.02) { V.Enemies.moveAndCollide(g.enemies, 0.02, g); V.Encounters.update(g.encounters, 0.02, g); }
}
function boss(g, id) {
  const e = V.Enemies.spawnBoss(g.enemies, g, { type: id, kit: false, reward: 'levelUp', requireKill: true });
  e.x = g.player.x + 200; e.y = g.player.y; V.Enemies.rebuildGrid(g.enemies, g); return e;
}
test('四关配置、八种新常规敌人、三位新首领与六件遗物完整', () => {
  assert.equal(V.Levels.count(), 4); assert.equal(C.RELICS.length, 6);
  const defs = Object.values(C.ENEMY_TYPES);
  assert.equal(defs.filter(e => e.behavior && !e.spawnOnly).length, 8);
  assert.equal(defs.filter(e => e.encounter).length, 3);
  for (const i of [2, 3]) { assert.equal(V.Levels.def(i).duration, 720); assert.equal(V.Levels.isFresh(i), false); assert.ok(V.Levels.requiredBosses(i).length); }
  assert.equal(V.Levels.isFresh(1), false); assert.equal(V.Levels.isLast(1), false); assert.equal(V.Levels.isLast(3), true);
  for (const r of C.RELICS) assert.equal(new Set(C.RELICS.map(e => e.id)).size, 6);
});
test('新敌人按章节解锁，裂变幼体和首领不进入常规抽取池', () => {
  for (let i = 0; i < 500; i++) {
    assert.ok(!V.Enemies.pickType(600, 1).behavior);
    const frost = V.Enemies.pickType(600, 2); assert.ok(frost.onlyFromLevel === undefined || frost.onlyFromLevel <= 2);
    const ember = V.Enemies.pickType(600, 3); assert.ok(!ember.boss && !ember.spawnOnly);
  }
});
test('第二关起保留等级、武器分支、宠物、遗物与金币，第三/四关同样继承且环境状态清空', () => {
  const first = game(0), fp = first.player;
  V.Stages.applyRelic(first, 'pilgrim');
  fp.level = 28; fp.stageSpeedMul = 0.76;
  V.Weapons.add(fp, 'sickle'); V.Weapons.chooseSchool(fp, 'sickle', 'sickle_hook');
  V.Pets.choose(first.pets, V.Pets.list(0)[0].id, first);
  first.shop.coins = 456;
  const pet = first.pets.id, fw = V.Weapons.get(fp, 'sickle');
  V.Game.startLevel(first, 1);
  assert.equal(first.player, fp); assert.equal(fp.level, 28); assert.equal(V.Weapons.get(fp, 'sickle'), fw);
  assert.equal(fw.schoolId, 'sickle_hook'); assert.equal(first.pets.id, pet); assert.ok(first.relics.includes('pilgrim'));
  assert.equal(first.shop.coins, 456, '第二关应继承金币');

  const g = game(), p = g.player; V.Stages.applyRelic(g, 'pilgrim'); p.level = 28; p.stageSpeedMul = 0.76;
  V.Weapons.add(p, 'sickle'); V.Weapons.chooseSchool(p, 'sickle', 'sickle_hook'); V.Pets.choose(g.pets, V.Pets.list(2)[0].id, g);
  const petId = g.pets.id, w = V.Weapons.get(p, 'sickle'); g.stage.cold = 100; g.shop.coins = 789;
  V.Game.startLevel(g, 3); assert.equal(g.player, p); assert.equal(p.level, 28); assert.equal(V.Weapons.get(p, 'sickle'), w);
  assert.equal(w.schoolId, 'sickle_hook'); assert.equal(g.pets.id, petId); assert.ok(g.relics.includes('pilgrim'));
  assert.equal(g.shop.coins, 789, '第三关应继承金币');
  assert.equal(p.stageSpeedMul, 1); assert.equal(g.stage.cold, 0); assert.equal(g.stage.mechanic, 'forge');
});
test('新关卡必须击杀章节首领，未击杀不能靠计时通关；第三关后能进入第四关', () => {
  const failed = game(); failed.time = 720; V.Game.clearLevel(failed); assert.equal(failed.failedClear, true);
  const g = game(); g.deps.panels = { showLevelClear() {}, hideLevelClear() {}, showBanner() {}, hideBanner() {}, showGameOver() {} };
  const e = boss(g, 'rimeQueen'); V.Enemies.kill(g, e); g.time = 720;
  V.Game.clearLevel(g); assert.equal(g.state, V.Game.STATE.LEVELCLEAR); assert.equal(g.victory, false);
  V.Game.nextLevel(g); assert.equal(g.level, 3); assert.equal(g.totalTime, 720);
  const last = boss(g, 'emberColossus'); V.Enemies.kill(g, last); g.time = 720; V.Game.clearLevel(g);
  assert.equal(g.state, V.Game.STATE.LEVELCLEAR); V.Game.nextLevel(g); assert.equal(g.victory, true);
});
test('寒潮累积寒意、产生实际减速和满寒伤害；暖灯能回温', () => {
  const g = game(), p = g.player; p.regen = 0; p.x += 210; p.y += 180; g.time = 90;
  for (let i = 0; i < 500; i++) { g.time += 0.02; V.Stages.update(g, 0.02); }
  assert.ok(g.stage.cold >= 89); assert.equal(p.stageSpeedMul, 0.76);
  const x = p.x; V.Player.update(p, 0.1, g.world, { x: 1, y: 0 }); assert.ok(Math.abs(p.x - x - p.speed * 0.76 * 0.1) < 1e-6);
  g.stage.cold = 100; g.time = 95; p.invuln = 0; const hp = p.hp; V.Stages.update(g, 0.02); assert.ok(p.hp < hp);
  p.x = g.stage.lamps[0].x; p.y = g.stage.lamps[0].y;
  for (let i = 0; i < 80; i++) V.Stages.update(g, 0.02);
  assert.ok(g.stage.cold < 70); assert.equal(p.stageSpeedMul, 1);
});
test('熔炉地火有预警期，横纵轮换，卸压阀能取消喷发', () => {
  const g = game(3); g.time = 16.8; V.Stages.update(g, 0.02); assert.equal(g.encounters.beams.length, 3);
  const hp = g.player.hp; V.Encounters.update(g.encounters, 0.5, g); assert.equal(g.player.hp, hp);
  V.Encounters.update(g.encounters, 0.9, g); assert.ok(g.player.hp < hp);
  g.encounters.beams = []; g.time = 34.8; V.Stages.update(g, 0.02); assert.ok(g.encounters.beams.every(e => e.angle === Math.PI / 2));
  const valve = g.stage.vents[0]; g.player.x = valve.x; g.player.y = valve.y;
  for (let i = 0; i < 61; i++) V.Stages.update(g, 0.02);
  assert.equal(g.stage.cancelNext, true); assert.equal(g.encounters.beams.length, 0);
});
test('卸压阀打断熔心巨像攻击，清除其残留弹幕并产生真实增伤窗口', () => {
  const g = game(3), e = boss(g, 'emberColossus'); e.encounterAI.windup = 0.5;
  V.Encounters.shot(g, e, 0, 100, 10); V.Encounters.area(g, g.player.x, g.player.y, 50, 10, 1, 1, '#fff', e.uid);
  const valve = g.stage.vents[0]; g.player.x = valve.x; g.player.y = valve.y;
  for (let i = 0; i < 61; i++) V.Stages.update(g, 0.02);
  assert.equal(e.encounterAI.stun, 2); assert.equal(e.encounterAI.windup, 0); assert.equal(g.encounters.shots.length, 0); assert.equal(g.encounters.zones.length, 0);
  const hp = e.hp; V.Enemies.hurt(g, e, 100, false); assert.ok(Math.abs(hp - e.hp - 135) < 1e-6);
});
test('铸霜卫士举盾减伤，闪避贴近能破盾', () => {
  const g = game(), e = spawn(g, 'frostguard', 80, 0); const hp = e.hp;
  V.Enemies.hurt(g, e, 100, false); assert.equal(hp - e.hp, 30);
  g.player.dashT = 0.15; V.Enemies.moveAndCollide(g.enemies, 0.02, g);
  assert.ok(e.traits.broken > 0); assert.equal(e.traits.guard, false);
  const before = e.hp; V.Enemies.hurt(g, e, 100, false); assert.equal(before - e.hp, 100);
});
test('霜咬猎犬有前摇，黑曜重骑连续冲锋，两者不瞬移到玩家', () => {
  for (const id of ['rimehound', 'obsidianknight']) {
    const g = game(3), e = spawn(g, id, 240, 0); e.traits.cd = 0;
    const x = e.x; V.Enemies.moveAndCollide(g.enemies, 0.1, g); assert.equal(e.x, x); assert.equal(e.traits.mode, 'windup');
    move(g, C.ENEMY_TYPES[id].behaviorConfig.windup + 0.25); assert.ok(Math.abs(e.x - x) > 20);
    if (id === 'obsidianknight') { move(g, 0.3); assert.equal(e.traits.mode, 'windup'); assert.equal(e.traits.left, 1); }
  }
});
test('冰棱猎手先瞄准再发射，余烬术士提供延迟落点', () => {
  const g = game(), archer = spawn(g, 'icearcher', 300, 0); archer.traits.cd = 0;
  V.Enemies.moveAndCollide(g.enemies, 0.1, g); assert.equal(g.encounters.shots.length, 0); assert.equal(archer.traits.mode, 'windup');
  move(g, 0.7); assert.equal(g.encounters.shots.length, 3);
  const forge = game(3), caster = spawn(forge, 'ashcaster', 300, 0); caster.traits.cd = 0;
  V.Enemies.moveAndCollide(forge.enemies, 0.02, forge); assert.equal(forge.encounters.zones.length, 1);
  const hp = forge.player.hp; V.Encounters.update(forge.encounters, 0.5, forge); assert.equal(forge.player.hp, hp);
  V.Encounters.update(forge.encounters, 0.6, forge); assert.ok(forge.player.hp < hp);
});
test('鸣钟幽灵能治疗普通敌人，不能治疗首领', () => {
  const g = game(), healer = spawn(g, 'bellwisp', 150, 0), ally = spawn(g, 'frostguard', 180, 0), b = spawn(g, 'rimeQueen', 170, 10);
  ally.hp = 100; b.hp = 100; healer.traits.cd = 0; V.Enemies.moveAndCollide(g.enemies, 0.02, g);
  assert.ok(ally.hp > 100); assert.equal(b.hp, 100);
});
test('爆燃虫预警后才爆炸，提前击杀能阻止自爆；熔核黏团只裂变一代', () => {
  const g = game(3), bug = spawn(g, 'cinderbug', 60, 0); g.player.invuln = 999;
  move(g, 0.4); assert.equal(bug.dead, false); move(g, 0.6); assert.equal(bug.dead, true);
  const safe = game(3), early = spawn(safe, 'cinderbug', 60, 0); move(safe, 0.2); V.Enemies.kill(safe, early); move(safe, 1);
  assert.equal(safe.encounters.zones.length, 0);
  const slime = spawn(safe, 'emberslime', 100, 0); V.Enemies.kill(safe, slime);
  const children = safe.enemies.list.filter(e => e.type === 'cinderling'); assert.equal(children.length, 2);
  children.forEach(e => V.Enemies.kill(safe, e)); assert.equal(safe.enemies.list.filter(e => e.type === 'cinderling').length, 2);
});
test('三位首领拥有各自招式，半血进入二阶段，击败后回收所属攻击', () => {
  for (const id of ['bellkeeper','rimeQueen','emberColossus']) {
    const g = game(id === 'emberColossus' ? 3 : 2), e = boss(g, id); g.player.invuln = 999;
    const seen = new Set();
    for (let i = 0; i < 800; i++) { V.Enemies.moveAndCollide(g.enemies, 0.02, g); V.Encounters.update(g.encounters, 0.02, g);
      for (const key of Object.keys(C.ENCOUNTER_LIMITS)) if (g.encounters[key].length) seen.add(key); }
    assert.ok(seen.size >= 2, id + ' 不应只有一种攻击');
    e.hp = e.maxHp * 0.4; V.Enemies.moveAndCollide(g.enemies, 0.02, g); assert.equal(e.encounterAI.phase, 2);
    V.Enemies.kill(g, e); for (const key of Object.keys(C.ENCOUNTER_LIMITS)) assert.ok(g.encounters[key].every(a => a.owner !== e.uid));
  }
});
test('钟环缺口确实安全，实体一侧会受伤；闪避能挡住新射线', () => {
  const g = game(), e = spawn(g, 'bellkeeper', 0, 0); g.player.regen = 0;
  V.Encounters.ring(g, e, 0, 0, 1); const r = g.encounters.rings[0];
  g.player.x = e.x + 38; g.player.y = e.y; const hp = g.player.hp;
  V.Encounters.update(g.encounters, 0, g); assert.equal(g.player.hp, hp);
  g.player.x = e.x - 38; V.Encounters.update(g.encounters, 0, g); assert.ok(g.player.hp < hp);
  g.encounters.rings = []; g.player.invuln = 0; g.player.dashCd = 0;
  V.Player.dash(g.player, { x: 0, y: 1 }, g); const before = g.player.hp;
  V.Encounters.beam(g, g.player.x - 100, g.player.y, 0, 200, 30, 30, 0, 1, 0, '#fff', 'test');
  V.Encounters.update(g.encounters, 0.02, g); assert.equal(g.player.hp, before);
});
test('六件遗物逐一改变真实属性且不会重复获取', () => {
  for (const relic of C.RELICS) {
    const g = game(), p = g.player, before = JSON.stringify(p);
    assert.equal(V.Stages.applyRelic(g, relic.id), true); assert.notEqual(JSON.stringify(p), before); assert.equal(V.Stages.applyRelic(g, relic.id), false);
    assert.equal(g.relics.length, 1); for (const v of Object.values(p)) if (typeof v === 'number') assert.ok(Number.isFinite(v));
  }
});
test('遗物祭坛免费三选一、选择期间暂停，99 级练习码只发金币', () => {
  const g = game(); g.time = 91; V.Stages.update(g, 0.02); assert.equal(g.stage.shrines.length, 1);
  const altar = g.stage.shrines[0]; g.player.x = altar.x; g.player.y = altar.y; V.Stages.update(g, 0.02);
  assert.equal(V.Stages.openRelic(g), true); assert.equal(g.state, V.Game.STATE.RELICSELECT); assert.equal(g.relicChoices.length, 3);
  const time = g.time, coins = g.shop.coins; V.Game.step(g, 10); assert.equal(g.time, time);
  const granted = scope.window.bobbychina32747('314159265358979367679178');
  assert.equal(granted.ok, true); assert.equal(granted.granted, 98); assert.equal(granted.coins, 1176);
  assert.equal(g.state, V.Game.STATE.RELICSELECT, '练习码不应关闭遗物面板');
  assert.equal(g.player.level, 99); assert.equal(g.shop.coins, coins + 1176);
  assert.equal(g.pendingLevels, undefined, '练习码不再补选卡队列');
  assert.equal(V.Game.choose(g, 0), true); assert.equal(g.relics.length, 1);
  assert.equal(g.shop.coins, coins + 1176, '免费遗物不占金币'); assert.equal(g.state, V.Game.STATE.PLAYING);
  assert.equal(altar.used, true);
});
test('无尽在 20/30 分钟进入新场景，保留构筑；新首领优先加入轮换', () => {
  const g = game(0); V.Game.start(g, { mode: 'endless', startWeapon: 'gravity' }); const p = g.player, w = p.weapons[0];
  p.invuln = 9999; g.onXp = () => {}; V.Stages.applyRelic(g, 'hourglass');
  for (const [t, index, mechanic] of [[1200,2,'frost'],[1800,3,'forge'],[2400,2,'frost']]) {
    g.enemies.boss = null; g.enemies.endlessBossAt = t; g.time = t - 0.01;
    V.Game.step(g, 0.02); assert.equal(g.level, index); assert.equal(g.stage.mechanic, mechanic);
    assert.equal(g.player, p); assert.equal(p.weapons[0], w); assert.ok(g.relics.includes('hourglass'));
    assert.equal(g.enemies.boss.type, mechanic === 'frost' ? 'bellkeeper' : 'emberColossus');
  }
});
test('弹幕、区域、钟环、射线和裂变都受硬上限控制；停火后回收', () => {
  const g = game(3), e = spawn(g, 'bellkeeper', 200, 0); g.player.invuln = 999;
  for (let i = 0; i < 500; i++) {
    V.Encounters.shot(g,e,0,100,5); V.Encounters.area(g,10,10,30,5,0.5,1,'#fff','test');
    V.Encounters.ring(g,e,0,0,1); V.Encounters.beam(g,0,0,0,100,10,5,1,1,0,'#fff','test');
  }
  for (const [key, cap] of Object.entries(C.ENCOUNTER_LIMITS)) assert.equal(g.encounters[key].length, cap);
  for (let i = 0; i < 350; i++) V.Encounters.update(g.encounters, 0.02, g);
  for (const key of Object.keys(C.ENCOUNTER_LIMITS)) assert.equal(g.encounters[key].length, 0);
  while (g.enemies.list.length < C.SPAWN.MAX_ENEMIES) spawn(g,'emberslime',100,100);
  V.Enemies.kill(g,g.enemies.list[g.enemies.list.length-1]); assert.ok(g.enemies.list.length <= C.SPAWN.MAX_ENEMIES);
});
console.log('PASS: 新章节 / 新首领 / 敌人行为 / 遗物 / 环境机制，共 ' + passes + ' 组');
