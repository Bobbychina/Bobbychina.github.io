(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./story-content.js'),require('./story-timeline.js'));
  else Object.defineProperty(root,'InkStoryDirector',{value:factory(root.InkStoryContent,root.InkStoryTimeline),writable:false,configurable:false});
})(typeof globalThis!=='undefined'?globalThis:this,function(content,timeline){
  'use strict';
  const installed=new WeakSet();
  let view=null,currentGame=null,acceptChange=null,lastCaption='';
  function sceneFor(game){
    const chapter=content.chapters[game.levelIndex];
    return chapter&&(game.state==='intro'||game.state==='outro')?{chapter,shots:chapter[game.state]}:null;
  }
  function configure(game){const scene=sceneFor(game);if(scene)game.storyDuration=timeline.duration(scene.shots);}
  function install(Game){
    if(installed.has(Game))return;
    installed.add(Game);
    for(const name of ['loadLevel','beginOutro']){
      const original=Game.prototype[name];
      if(typeof original!=='function')throw new TypeError(`Story integration requires ${name}`);
      Game.prototype[name]=function(...args){const result=original.apply(this,args);configure(this);return result;};
    }
  }
  function advance(){
    const scene=currentGame&&sceneFor(currentGame);if(!scene||!view||view.overlay.hidden)return;
    const next=timeline.next(scene.shots,currentGame.storyTime);
    if(next>=currentGame.storyDuration){view.skip.click();return;}
    const game=currentGame;
    if(typeof acceptChange==='function')acceptChange(()=>{game.storyTime=next;});
  }
  function createView(){
    const overlay=document.getElementById('storyOverlay');if(!overlay)return null;
    overlay.classList.add('cinematic');overlay.setAttribute('aria-label','剧情演出');overlay.removeAttribute('aria-live');
    const canvas=document.createElement('canvas');canvas.className='cinematic-stage';canvas.setAttribute('aria-hidden','true');overlay.prepend(canvas);
    const frame=overlay.querySelector('.story-frame');
    const meta=document.createElement('p');meta.className='cinematic-scene-label';frame.prepend(meta);
    const legacyCaption=document.getElementById('storyCaption');legacyCaption.hidden=true;legacyCaption.setAttribute('aria-hidden','true');
    const words=document.createElement('p');words.id='cinematicCaption';words.className='cinematic-caption';frame.insertBefore(words,legacyCaption);
    const speaker=document.createElement('p');speaker.className='cinematic-speaker';frame.insertBefore(speaker,words);
    const next=document.createElement('button');next.type='button';next.className='cinematic-next';next.textContent='下一镜 ↗';next.addEventListener('click',advance);overlay.append(next);
    const progress=document.createElement('div');progress.className='cinematic-progress';progress.setAttribute('aria-hidden','true');overlay.append(progress);
    const skip=document.getElementById('skipStoryButton');skip.textContent='跳过整段 · 空格';
    words.setAttribute('aria-live','polite');words.setAttribute('aria-atomic','true');
    window.addEventListener('keydown',event=>{
      if(event.code!=='Enter'||event.repeat||overlay.hidden||!sceneFor(currentGame||{}))return;
      event.preventDefault();event.stopImmediatePropagation();advance();
    },true);
    return {overlay,canvas,meta,speaker,words,next,skip,progress};
  }
  function render(game,onChange){
    if(typeof document==='undefined')return;
    if(!view)view=createView();if(!view)return;
    currentGame=game;acceptChange=onChange;
    const scene=sceneFor(game);if(!scene||view.overlay.hidden){lastCaption='';return;}
    const frame=timeline.sample(scene.shots,game.storyTime);
    const key=`${game.runId}:${game.state}:${frame.index}`;
    if(lastCaption!==key){
      view.meta.textContent=`追影山河 / ${String(game.levelIndex+1).padStart(2,'0')} · ${game.level.title} / ${game.state==='intro'?'入境':'余波'}`;
      view.speaker.textContent=frame.shot.speaker;
      view.words.textContent=frame.shot.text;lastCaption=key;
    }
    view.next.textContent=frame.index===scene.shots.length-1?(game.state==='intro'?'进入战斗 ↗':'继续行路 ↗'):'下一镜 · Enter ↗';
    view.overlay.dataset.shot=String(frame.index);view.overlay.dataset.chapter=String(game.levelIndex);view.overlay.dataset.phase=game.state;
    view.progress.style.width=`${frame.elapsed/frame.total*100}%`;
    globalThis.InkStoryRenderer.draw(view.canvas,scene.chapter,game.state,frame,{character:game.player.character,reducedMotion:window.matchMedia('(prefers-reduced-motion: reduce)').matches});
  }
  return Object.freeze({install,configure,sceneFor,render});
});
