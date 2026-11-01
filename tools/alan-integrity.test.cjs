'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const Guard=require('../games/alan/integrity.js');
const SAVE='ink-fury-road-progress';
function fixture(){
  const records=new Map([[SAVE,'original-save'],[SAVE+'-backup','original-backup']]);
  const writes=[];let fail=false;
  const storage={getItem:key=>records.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');writes.push(key);records.set(key,value);}};
  const permit={};let stopped;
  const save={coins:10,gems:20,talent:1};
  const state={hp:240,energy:0};const rules={damage:20};
  const functions=[()=>{}];
  const guard=Guard.create({storage,permit,onStop:event=>{stopped=event;}});
  const config={save:()=>save,state:()=>state,rules:()=>rules,functions:()=>functions};
  guard.bind(permit,config);
  return {guard,permit,config,save,state,rules,functions,records,writes,setFailure:value=>{fail=value;},stop:()=>stopped};
}
test('baseline checks pass and authorized game changes can be accepted',()=>{
  const f=fixture();assert.equal(f.guard.check(),true);f.state.hp=220;
  assert.equal(f.guard.accept(f.permit),true);assert.equal(f.guard.check(),true);
});
test('outside-frame data edits stop the run without touching save or backups',()=>{
  const f=fixture();f.state.hp=9999;assert.equal(f.guard.check(),false);
  assert.equal(f.guard.reason,'state-written-outside-game');assert.equal(f.records.get(SAVE),'original-save');
  assert.equal(f.records.get(SAVE+'-backup'),'original-backup');assert.deepEqual(f.writes,[]);
  assert.equal(f.stop().cheat,false);assert.equal(f.stop().detected,true);
});
test('accept cannot rebase an injected modification without the private permit',()=>{
  const f=fixture();f.state.hp=9999;assert.equal(f.guard.accept(),false);assert.equal(f.guard.reason,'unauthorized-guard-call');
});
test('guard cannot be rebound even with an authorized caller',()=>{
  const f=fixture();assert.equal(f.guard.bind(f.permit,f.config),false);assert.equal(f.guard.reason,'guard-rebind');
});
test('frozen guard methods cannot be disabled or replaced',()=>{
  const f=fixture();assert.throws(()=>{f.guard.check=()=>true;},TypeError);assert.equal(f.guard.check(),true);
  assert.equal(Object.isFrozen(Guard),true);
});
test('accept checks function and rule integrity before changing the state baseline',()=>{
  for(const mutate of [f=>{f.functions[0]=()=>{};},f=>{f.rules.damage=9999;}]){
    const f=fixture();mutate(f);assert.equal(f.guard.accept(f.permit),false);
    assert.match(f.guard.reason,/combat-/);
  }
});
test('wallet writes require a matching resource receipt',()=>{
  const f=fixture();f.save.coins=99999;assert.equal(f.guard.write(f.permit,f.save),false);
  assert.equal(f.guard.reason,'resource-without-receipt');assert.equal(f.records.get(SAVE),'original-save');
});
test('genuine resource grants and purchases persist and remain playable',()=>{
  const f=fixture();let before={...f.save};f.save.coins+=30;
  assert.equal(f.guard.resources(f.permit,before,f.save,{coins:30}),true);
  assert.equal(f.guard.write(f.permit,f.save),true);f.guard.accept(f.permit);
  before={...f.save};f.save.gems-=5;
  assert.equal(f.guard.resources(f.permit,before,f.save,{gems:-5}),true);
  assert.equal(f.guard.write(f.permit,f.save),true);f.guard.accept(f.permit);
  assert.equal(f.guard.check(),true);assert.equal(JSON.parse(f.records.get(SAVE)).coins,40);
});
test('forged before values and malformed receipts are rejected',()=>{
  for(const delta of [{coins:NaN},{coins:Infinity},{coins:1.5},{coins:'1'}]){
    const f=fixture();assert.equal(f.guard.resources(f.permit,f.save,f.save,delta),false);
  }
  const f=fixture();assert.equal(f.guard.resources(f.permit,{coins:999,gems:20,talent:1},f.save,{coins:-989}),false);
});
test('failed saves can retry without clearing progress',()=>{
  const f=fixture();const before={...f.save};f.save.coins+=30;
  f.guard.resources(f.permit,before,f.save,{coins:30});f.setFailure(true);
  assert.equal(f.guard.write(f.permit,f.save),false);assert.equal(f.guard.stopped,false);
  f.setFailure(false);assert.equal(f.guard.write(f.permit,f.save),true);f.guard.accept(f.permit);assert.equal(f.guard.check(),true);
});
test('external saves cause a conflict without punishment or overwrite',()=>{
  const f=fixture();f.records.set(SAVE,'other-tab');assert.equal(f.guard.check(),false);
  assert.equal(f.guard.punished,false);assert.equal(f.records.get(SAVE),'other-tab');assert.deepEqual(f.writes,[]);
});

test('failed reward saves and rolled-back purchases both allow subsequent actions',()=>{
  for(const rollback of [false,true]){
    const f=fixture();const before={...f.save};f.save.coins+=30;
    f.guard.resources(f.permit,before,f.save,{coins:30});f.setFailure(true);
    assert.equal(f.guard.write(f.permit,f.save),false);
    if(rollback)Object.assign(f.save,before);
    f.guard.accept(f.permit);const nextBefore={...f.save};f.save.gems-=5;
    assert.equal(f.guard.resources(f.permit,nextBefore,f.save,{gems:-5}),true);
    f.setFailure(false);assert.equal(f.guard.write(f.permit,f.save),true);
    f.guard.accept(f.permit);assert.equal(f.guard.check(),true);
  }
});
test('legacy penalty markers never trigger a save reset',()=>{
  const f=fixture();f.records.set('ink-fury-anticheat-penalty','runtime-tamper');
  assert.equal(f.guard.resume(),true);assert.equal(f.records.get(SAVE),'original-save');assert.deepEqual(f.writes,[]);
});
test('cooldown and ultimate receipts still detect impossible casts',()=>{
  const f=fixture();assert.equal(f.guard.cast(f.permit,'run',1,'j',3.2,0),true);
  assert.equal(f.guard.cast(f.permit,'run',1.1,'j',3.2,0),false);assert.equal(f.guard.reason,'cast-during-cooldown');
  const g=fixture();assert.equal(g.guard.cast(g.permit,'run',1,'ult',1.62,100),false);
  assert.equal(g.guard.reason,'ultimate-without-energy-cost');
});
test('motion violations stop once and never write storage',()=>{
  const f=fixture();assert.equal(f.guard.enforce('horizontal-step-limit'),false);
  assert.equal(f.guard.enforce('another'),false);assert.equal(f.guard.reason,'motion-horizontal-step-limit');assert.deepEqual(f.writes,[]);
});
