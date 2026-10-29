'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../games/alan/online');
function worker(){
  let now=1000,interval=null,receive;
  const packets=[];
  class Clock extends Date{static now(){return now;}}
  const sandbox={console,Uint8Array,Uint32Array,crypto:crypto.webcrypto,Date:Clock,performance:{now:()=>now},setInterval:fn=>{interval=fn;return 1;},clearInterval:()=>{interval=null;},postMessage:value=>packets.push(JSON.parse(JSON.stringify(value))),addEventListener:(type,fn)=>{if(type==='message')receive=fn;}};
  sandbox.self=sandbox;
  const context=vm.createContext(sandbox);
  sandbox.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context,{filename:file,timeout:10000});};
  vm.runInContext(fs.readFileSync(path.join(ROOT,'worker.js'),'utf8'),context,{filename:'worker.js'});
  const send=(id,message)=>receive({data:{op:'message',id,message}});
  const open=id=>receive({data:{op:'open',id}});
  const last=(type,id=1)=>packets.filter(packet=>packet.id===id&&packet.packet?.type===type).at(-1)?.packet;
  const tick=(count=1)=>{for(let index=0;index<count;index++){now+=1000/60;interval?.();}};
  const connect=()=>{open(1);send(1,{type:'create',name:'房主',character:'nameless'});const code=last('room').code;open(2);send(2,{type:'join',code,name:'来客',character:'panshan'});return code;};
  const play=()=>{connect();send(1,{type:'ready',ready:true});send(2,{type:'ready',ready:true});tick(185);assert.equal(last('room').state,'playing');};
  return{packets,send,open,last,tick,connect,play,visibility:hidden=>receive({data:{op:'visibility',hidden}})};
}
test('browser engine and worker create/join without Node dependencies',()=>{
  const app=worker();const code=app.connect();
  assert.match(code,/^[A-F0-9]{6}$/);assert.equal(app.last('room',2).slot,1);
  assert.equal(app.last('room').players[1].character,'panshan');
});
test('worker simulates real movement, ignores state writes and releases stale input',()=>{
  const app=worker();app.play();const before=app.last('snapshot').players[0];
  app.send(1,{type:'input',input:{move:1,hp:999999,x:999999}});app.tick(12);
  const moved=app.last('snapshot').players[0];assert.ok(moved.x>before.x);assert.equal(moved.hp,before.hp);
  app.tick(90);const still=app.last('snapshot').players[0].x;app.tick(30);assert.equal(app.last('snapshot').players[0].x,still);
});
test('background pause and lost-connection pause must both clear before resuming',()=>{
  const app=worker();app.play();app.visibility(true);assert.equal(app.last('room').pauseReason,'host-hidden');
  const time=app.last('snapshot').time;app.send(1,{type:'pause',paused:true});app.visibility(false);app.tick(60);assert.equal(app.last('snapshot').time,time);assert.equal(app.last('room').state,'paused');
  app.send(2,{type:'pause',paused:false});assert.equal(app.last('room').state,'paused');
  app.send(1,{type:'pause',paused:false});app.tick(4);assert.equal(app.last('room').state,'playing');assert.ok(app.last('snapshot').time>time);
});
test('worker can settle and rematch a real duel',()=>{
  const app=worker();app.play();app.send(2,{type:'surrender'});assert.equal(app.last('room').state,'result');assert.equal(app.last('snapshot').winner,0);
  app.send(1,{type:'rematch'});app.send(2,{type:'rematch'});app.tick(185);assert.equal(app.last('room').state,'playing');assert.equal(app.last('snapshot').players[1].hp,340);
});
test('leaving releases the guest seat for a different browser session',()=>{
  const app=worker();const code=app.connect();app.send(2,{type:'leave'});assert.equal(app.last('room').players[1],null);
  app.open(3);app.send(3,{type:'join',code,name:'新来客'});assert.equal(app.last('room',3).players[1].name,'新来客');
});
test('invalid room and third slot produce errors without replacing participants',()=>{
  const app=worker();const code=app.connect();app.open(3);app.send(3,{type:'join',code:'NOT-A-ROOM'});assert.match(app.last('error',3).text,/房间码/);
  app.send(3,{type:'join',code});assert.match(app.last('error',3).text,/满/);assert.equal(app.last('room').players[1].name,'来客');
});
test('online HTML uses relative assets and does not load local services',()=>{
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  assert.doesNotMatch(html,/(?:src|href)="\/(?:assets|vendor|game-data)/);
  assert.match(html,/local-authority\.js/);
  const transport=fs.readFileSync(path.join(ROOT,'transport.js'),'utf8');
  assert.doesNotMatch(transport,/new WebSocket\(/);assert.match(transport,/new window\.InkOnlineLocal\.Socket\(/);
});
