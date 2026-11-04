/* 金币经济与购买边界：加载真实模块，不依赖浏览器或服务端。 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const scope = { window: { innerWidth: 1280, innerHeight: 720 }, console };
vm.createContext(scope);
['core/namespace','core/utils','game/config','game/chapters-config','game/arsenal-config',
  'game/phases','game/levels','game/world','game/effects','game/player','game/weapons','game/arsenal',
  'game/enemies','game/bosskit','game/encounters','game/stages','game/pickups','game/pets','game/shop','game/game','core/cheats']
  .forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/', file + '.js'), 'utf8'), scope, { filename: file }));
const V = scope.window.VS, C = V.Config;
V.Audio = { play() {}, unlock() {} }; let passed = 0, fixtureSerial = 0;
function test(name, fn) { fn(); passed++; console.log('PASS: ' + name); }
function game(mode = 'campaign', weapon = 'bolt') {
  const g = V.Game.create({ data: {}, input: { getAxis: () => ({x:0,y:0}) } });
  V.Game.current = g; V.Game.start(g, {mode, startWeapon:weapon}); g.player.invuln = 99999; return g;
}
function offer(g, kind, id, schoolId) {
  const choice = V.Game.upgradePool(g).find(c => c.kind === kind && c.id === id && (!schoolId || c.schoolId === schoolId));
  assert.ok(choice, `合法商品缺失 ${kind}/${id}/${schoolId}`);
  return {choice, price:V.Shop.price(g, choice), token:'fixture-' + ++fixtureSerial, locked:false, sold:false};
}
function buy(g, item) { g.shop.offers = [item]; V.Game.openShop(g); return V.Shop.buy(g, 0, item.token); }
test('开局从第一关开始，30 金币、四格不重复货架，包含当前武器升级', () => {
  const g = game(); assert.equal(g.level,0); assert.equal(g.shop.coins,30); assert.equal(g.shop.offers.length,4);
  const keys = g.shop.offers.map(o => o.choice.kind+o.choice.id+(o.choice.schoolId||''));
  assert.equal(new Set(keys).size,4); assert.ok(g.shop.offers.some(o=>o.choice.kind==='weapon-up'));
  assert.equal(V.Game.startAt,undefined); assert.equal(V.Game.openLevelUp,undefined);
});
test('金币只接受正有限奖励，取整入账，封顶后只记实际获得额', () => {
  const g=game(); for (const n of [-3,0,NaN,Infinity,'20']) assert.equal(V.Shop.earn(g,n),0);
  assert.equal(V.Shop.earn(g,2.9),2); assert.equal(g.shop.coins,32);
  g.shop.coins=999999998; const earned=g.shop.earned; assert.equal(V.Shop.earn(g,100),1);
  assert.equal(g.shop.coins,999999999); assert.equal(g.shop.earned,earned+1); assert.equal(V.Shop.earn(g,1),0);
});
test('普通、金色和超级经验球实际拾取获得各自金币与升级奖励', () => {
  for (const [kind,value,coins] of [['normal',3,3],['gold',200,6],['super',0,40]]) {
    const g=game(), before=g.player.level, start=g.shop.coins;
    if(kind==='normal') V.Pickups.spawnXp(g.pickups,g.player.x,g.player.y,value);
    if(kind==='gold') V.Pickups.spawnGold(g.pickups,g.player.x,g.player.y,value);
    if(kind==='super') V.Pickups.spawnSuper(g.pickups,g.player.x,g.player.y);
    V.Pickups.update(g.pickups,0,g);
    assert.equal(g.pickups.gems.length,0); assert.equal(g.shop.coins-start,coins+(g.player.level-before)*12);
    assert.equal(g.state,'playing'); assert.equal(g.player.weapons[0].level,1);
  }
});
test('经验升级不中断战斗、不发免费强化，首领另给赏金', () => {
  const g=game(); g.onXp(g.player.xpNeeded); assert.equal(g.player.level,2); assert.equal(g.shop.coins,42);
  assert.equal(g.state,'playing'); assert.equal(g.pendingLevels,undefined); assert.equal(g.player.weapons[0].level,1);
  const before=g.shop.coins; g.onBossReward(); assert.equal(g.shop.coins-before,112); assert.equal(g.state,'playing');
});
test('金币不足、非商店状态、非法索引和过时凭据都不能扣款或强化', () => {
  const g=game(), item=offer(g,'weapon-up','bolt'); g.shop.offers=[item];
  assert.equal(V.Shop.buy(g,0,item.token),false); V.Game.openShop(g); const balance=g.shop.coins;
  for(const i of [-1,4,0.5,'0']) assert.equal(V.Shop.buy(g,i,item.token),false);
  assert.equal(V.Shop.buy(g,0,'stale'),false); assert.equal(g.shop.coins,balance);
  g.shop.coins=item.price-1; assert.equal(V.Shop.buy(g,0,item.token),false); assert.equal(g.player.weapons[0].level,1);
});
test('购买立即生效，按标价扣一次，重复点击和重新进店不补货', () => {
  const g=game(), item=offer(g,'weapon-up','bolt'), balance=g.shop.coins;
  assert.equal(buy(g,item),true); assert.equal(g.player.weapons[0].level,2); assert.equal(g.shop.coins,balance-item.price);
  assert.equal(V.Shop.buy(g,0,item.token),false); assert.equal(g.shop.purchases,1); assert.equal(g.shop.spent,item.price);
  V.Game.closeShop(g); V.Game.openShop(g); assert.equal(g.shop.offers[0],item); assert.equal(item.sold,true);
});
test('购买互斥流派后，其他分支失效，不补货、不误扣金币', () => {
  const g=game('campaign','sickle'); g.shop.coins=500;
  const a=offer(g,'school','sickle','sickle_hook'), b=offer(g,'school','sickle',C.WEAPONS.sickle.schools.find(id=>id!=='sickle_hook'));
  g.shop.offers=[a,b]; V.Game.openShop(g); assert.equal(V.Shop.buy(g,0,a.token),true);
  const balance=g.shop.coins; assert.equal(b.unavailable,true); assert.equal(V.Shop.buy(g,1,b.token),false);
  assert.equal(g.shop.coins,balance); assert.equal(g.player.weapons[0].schoolId,'sickle_hook');
});
test('买满武器栏后，旧的新武器商品失效，满级武器不再售升级', () => {
  const g=game(); const item=offer(g,'weapon-new','frost'); g.shop.offers=[item];
  for (const id of ['garlic','orbit','nova']) V.Weapons.add(g.player,id);
  V.Game.openShop(g); const balance=g.shop.coins; assert.equal(item.unavailable,true);
  assert.equal(V.Shop.buy(g,0,item.token),false); assert.equal(g.shop.coins,balance);
  g.player.weapons[0].level=C.WEAPONS.bolt.maxLevel;
  assert.ok(!V.Game.upgradePool(g).some(c=>c.kind==='weapon-up'&&c.id==='bolt'));
});
test('进化必须满足配方，满足后保证上架，购买后保留原武器和流派', () => {
  const g=game(); g.player.weapons[0].level=8; g.player.weapons[0].school=1; g.shop.coins=500;
  assert.ok(!V.Game.upgradePool(g).some(c=>c.kind==='evolution'));
  const evo=C.EVOLUTIONS.bolt; g.player.upgrades[evo.passive]=evo.passiveLevel;
  V.Shop.refresh(g,false); const i=g.shop.offers.findIndex(o=>o&&o.choice.kind==='evolution'); assert.ok(i>=0);
  const w=g.player.weapons[0]; V.Game.openShop(g); assert.equal(V.Shop.buy(g,i,g.shop.offers[i].token),true);
  assert.equal(g.player.weapons[0],w); assert.equal(w.evolved,true); assert.equal(w.school,1);
});
test('主动刷新按本轮次数涨价，失败不收费，刷新后旧 token 不能购买', () => {
  const g=game(); V.Game.openShop(g); const old=g.shop.offers[0].token;
  assert.equal(V.Shop.refreshCost(g),5); assert.equal(V.Game.refreshShop(g),true); assert.equal(g.shop.coins,25);
  assert.equal(V.Shop.refreshCost(g),7); assert.equal(V.Shop.buy(g,0,old),false);
  g.shop.coins=0; const tokens=g.shop.offers.map(o=>o.token).join(); assert.equal(V.Game.refreshShop(g),false);
  assert.equal(g.shop.offers.map(o=>o.token).join(),tokens); assert.equal(g.shop.coins,0);
});
test('锁定保留原位、价格与凭据，四格全锁时不能收刷新费', () => {
  const g=game(); g.shop.coins=500; V.Game.openShop(g); const locked=g.shop.offers[0];
  assert.equal(V.Shop.toggleLock(g,0,locked.token),true); const price=locked.price; g.shop.purchases=20;
  assert.equal(V.Shop.refresh(g,true),true); assert.equal(g.shop.offers[0],locked); assert.equal(locked.price,price);
  for(let i=1;i<4;i++) assert.equal(V.Shop.toggleLock(g,i,g.shop.offers[i].token),true);
  const balance=g.shop.coins; assert.equal(V.Shop.refresh(g,true),false); assert.equal(g.shop.coins,balance);
});
test('免费补货只按战斗时间发生，开店冻结全部战斗，时间跳跃不累计刷新', () => {
  const g=game(); const tokens=g.shop.offers.map(o=>o.token).join();
  g.time=59.9; V.Shop.update(g); assert.equal(g.shop.offers.map(o=>o.token).join(),tokens);
  V.Game.openShop(g); V.Game.step(g,100); assert.equal(g.time,59.9); assert.equal(V.Shop.update(g),false);
  V.Game.closeShop(g); g.time=60; assert.equal(V.Shop.update(g),true); assert.equal(g.shop.nextRefreshAt,120);
  assert.notEqual(g.shop.offers.map(o=>o.token).join(),tokens); g.time=2000; V.Shop.update(g);
  assert.equal(g.shop.nextRefreshAt,2060); assert.equal(V.Shop.update(g),false); assert.equal(g.shop.refreshes,0);
});
test('四关继承玩家、金币、武器流派、宠物和遗物，正常继续按钮推进关卡', () => {
  const g=game(), p=g.player; g.shop.coins=123; p.level=12;
  V.Pets.choose(g.pets,V.Pets.list(0)[0].id,g); V.Stages.applyRelic(g,'pilgrim'); const pet=g.pets.id;
  for (const index of [1,2,3]) {
    g.state=V.Game.STATE.LEVELCLEAR; g.time=g.levelDef.duration; V.Game.nextLevel(g);
    assert.equal(g.level,index); assert.equal(g.player,p); assert.equal(p.level,12); assert.equal(g.shop.coins,123);
    assert.equal(g.pets.id,pet); assert.ok(g.relics.includes('pilgrim')); assert.equal(V.Levels.isFresh(index),false);
  }
});
test('暂停菜单进店，关闭后返回暂停；新一局金币和货架重新开始', () => {
  const g=game(); V.Game.pause(g); V.Game.openShop(g); assert.equal(g.state,'shop');
  V.Game.closeShop(g); assert.equal(g.state,'paused'); V.Game.resume(g); g.shop.coins=200; V.Game.start(g);
  assert.equal(g.shop.coins,30); assert.equal(g.shop.purchases,0); assert.equal(g.player.level,1);
});
test('99级练习码奖励金币，保留当前面板，重复不增发，超过99级不降级', () => {
  const g=game(); const result=V.Cheats.level99('314159265358979367679178');
  assert.equal(result.granted,98); assert.equal(result.coins,1176); assert.equal(g.player.level,99);
  assert.equal(g.state,'playing'); assert.equal(g.cheated,true); const balance=g.shop.coins;
  V.Game.openShop(g); V.Cheats.level99('314159265358979367679178'); assert.equal(g.state,'shop'); assert.equal(g.shop.coins,balance);
  g.player.level=103; V.Cheats.level99('314159265358979367679178'); assert.equal(g.player.level,103);
});
test('达到掉落物上限后合并普通和金色球，金币价值不会按外观重新折算', () => {
  for (const reverse of [false,true]) {
    const g=game(), n=V.Pickups.MAX_GEMS;
    for(let i=0;i<n;i++) (reverse?V.Pickups.spawnGold:V.Pickups.spawnXp)(g.pickups,0,0,reverse?100:1);
    (reverse?V.Pickups.spawnXp:V.Pickups.spawnGold)(g.pickups,0,0,reverse?5:100);
    assert.equal(g.pickups.gems.length,n);
    const before=g.player.level;
    for(const gem of g.pickups.gems) {gem.x=g.player.x;gem.y=g.player.y;gem.vx=0;gem.vy=0;}
    V.Pickups.update(g.pickups,0,g);
    assert.equal(g.shop.coins,30+(reverse?n*3+5:n+3)+(g.player.level-before)*12);
  }
});
test('普通经验不会合并进只升等级的超级球，首个首领可选三只宠物', () => {
  const g=game(), n=V.Pickups.MAX_GEMS;
  V.Pickups.spawnSuper(g.pickups,0,0);
  for(let i=1;i<n;i++) V.Pickups.spawnXp(g.pickups,0,0,1);
  V.Pickups.spawnXp(g.pickups,0,0,4);
  assert.equal(g.pickups.gems.find(o=>o.super).value,0);
  assert.equal(g.pickups.gems.reduce((sum,o)=>sum+o.coins,0),40+n-1+4);
  assert.equal(V.Pets.list(0).length,3);assert.ok(V.Pets.list(0).some(p=>p.id==='lemonPig'));
});
test('流派价格使用真实层数；无效选择不会被应用或扣钱', () => {
  const g=game(), c=offer(g,'school','bolt').choice;
  assert.equal(V.Shop.price(g,c),20); g.player.weapons[0].school=2; assert.equal(V.Shop.price(g,c),34);
  const balance=g.shop.coins; assert.equal(V.Game._applyChoice(g,{kind:'weapon-new',id:'missing'}),false);
  assert.equal(g.shop.coins,balance);
});
console.log('PASS: 金币商店，共 '+passed+' 组');
