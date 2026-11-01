const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chapters}=require('../games/alan/src/story-content.js');
const timeline=require('../games/alan/src/story-timeline.js');
const director=require('../games/alan/src/story-director.js');
const {InkGame}=require('../games/alan/game.js');
director.install(InkGame);
test('all nine chapters have valid, distinct opening and closing shots',()=>{
  assert.equal(chapters.length,9);
  for(const [id,chapter] of chapters.entries()){
    assert.equal(chapter.id,id);assert.ok(chapter.objective);
    for(const phase of ['intro','outro']){
      assert.ok(chapter[phase].length>=3);
      for(const shot of chapter[phase]){
        assert.ok(shot.speaker&&shot.text.trim());assert.ok(shot.text.length<=65);
        assert.ok(['wide','medium','close'].includes(shot.camera));
        assert.ok(['landscape','jade','cord','hero','companion','boss','mirror','bell'].includes(shot.focus));
        assert.ok(['approach','seize','resist','listen','reveal','release','depart','join'].includes(shot.action));
        assert.ok(shot.duration>=5&&shot.duration<=7.5);
      }
    }
    assert.notEqual(chapter.intro.map(s=>s.text).join(''),chapter.outro.map(s=>s.text).join(''));
  }
});
test('timeline handles cuts and exact ending without losing or extending a shot',()=>{
  const shots=chapters[0].intro,total=timeline.duration(shots);
  assert.equal(timeline.sample(shots,-1).index,0);
  assert.equal(timeline.sample(shots,shots[0].duration).index,1);
  assert.equal(timeline.next(shots,0),shots[0].duration);
  assert.equal(timeline.sample(shots,total+100).index,shots.length-1);
  assert.equal(timeline.sample(shots,total).finished,true);
  assert.throws(()=>timeline.sample(shots,NaN),/scene time/);
});
test('integration uses each full scene duration and preserves combat values',()=>{
  const game=new InkGame();
  for(let id=0;id<9;id++){
    game.loadLevel(id);assert.equal(game.storyDuration,timeline.duration(chapters[id].intro));
    const {x,hp}=game.player;
    for(let frame=0;frame<125;frame++)game.update(.04,{move:1,attack:true,heavy:true});
    assert.equal(game.state,'intro');assert.equal(game.time,0);assert.equal(game.player.hp,hp);assert.equal(game.player.x,x);
    game.skipStory();assert.equal(game.state,'playing');
  }
});
test('natural playback hands control back exactly once',()=>{
  const events=[];const game=new InkGame({onEvent:type=>events.push(type)});game.loadLevel(0);
  for(let frame=0;frame<Math.ceil(game.storyDuration/.04)+1;frame++)game.update(.04,{});
  assert.equal(game.state,'playing');assert.equal(events.filter(type=>type==='fightStart').length,1);
  game.skipStory();assert.equal(events.filter(type=>type==='fightStart').length,1);
});
test('outro retains settlement prerequisites and skip cannot duplicate completion',()=>{
  const events=[];const game=new InkGame({onEvent:type=>events.push(type)});game.loadLevel(8);game.skipStory();
  game.beginOutro();assert.equal(game.state,'playing');
  game.bossDefeated=true;game.waveCleared=game.waveCleared.map(()=>true);game.checkpoints.forEach(flag=>flag.visited=true);
  game.beginOutro();assert.equal(game.state,'outro');assert.equal(game.storyDuration,timeline.duration(chapters[8].outro));
  for(let frame=0;frame<100;frame++)game.update(.04,{});
  assert.equal(game.state,'outro');assert.equal(game.runSettled,false);
  game.skipStory();game.skipStory();game.complete();
  assert.equal(game.state,'won');assert.equal(events.filter(type=>type==='complete').length,1);
});
