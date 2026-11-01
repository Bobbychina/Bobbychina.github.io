(function(){
  'use strict';
  const content=window.InkStoryContent,timeline=window.InkStoryTimeline;
  const byId=id=>document.getElementById(id);
  const chapterSelect=byId('previewChapter'),phaseSelect=byId('previewPhase'),play=byId('previewPlay'),slider=byId('previewTime');
  for(const chapter of content.chapters){const option=document.createElement('option');option.value=String(chapter.id);option.textContent=`${chapter.id+1} · ${chapter.title}`;chapterSelect.append(option);}
  const params=new URLSearchParams(location.search);
  const requested=Number(params.get('chapter')||1)-1;
  if(Number.isInteger(requested)&&requested>=0&&requested<content.chapters.length)chapterSelect.value=String(requested);
  if(params.get('phase')==='outro')phaseSelect.value='outro';
  let time=0,playing=true,last=performance.now(),lastKey='';
  const current=()=>({chapter:content.chapters[Number(chapterSelect.value)],phase:phaseSelect.value});
  const setPlaying=value=>{playing=value;play.textContent=playing?'暂停':'播放';};
  const restart=()=>{time=0;setPlaying(true);lastKey='';};
  chapterSelect.addEventListener('change',restart);phaseSelect.addEventListener('change',restart);
  byId('previewRestart').addEventListener('click',restart);play.addEventListener('click',()=>setPlaying(!playing));
  byId('previewNext').addEventListener('click',()=>{const {chapter,phase}=current();time=timeline.next(chapter[phase],time);});
  slider.addEventListener('input',()=>{const {chapter,phase}=current();time=timeline.duration(chapter[phase])*Number(slider.value)/1000;setPlaying(false);});
  window.addEventListener('keydown',event=>{if(event.target instanceof HTMLSelectElement||event.target instanceof HTMLInputElement)return;if(event.code==='Space'){event.preventDefault();setPlaying(!playing);}if(event.code==='Enter'&&!event.repeat)byId('previewNext').click();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setPlaying(false);last=performance.now();});
  function frame(now){
    const {chapter,phase}=current(),shots=chapter[phase],total=timeline.duration(shots);
    if(playing&&!document.hidden)time=Math.min(total,time+Math.min(.1,Math.max(0,(now-last)/1000)));
    last=now;
    if(time>=total)setPlaying(false);
    const state=timeline.sample(shots,time),key=`${chapter.id}:${phase}:${state.index}`;
    if(lastKey!==key){byId('previewMeta').textContent=`追影山河 / ${String(chapter.id+1).padStart(2,'0')} · ${chapter.title} / ${phase==='intro'?'入境':'余波'}`;byId('previewSpeaker').textContent=state.shot.speaker;byId('storyText').textContent=state.shot.text;lastKey=key;}
    slider.value=String(Math.round(time/total*1000));
    byId('previewStatus').textContent=`${state.index+1} / ${shots.length} 镜 · ${time.toFixed(1)} / ${total.toFixed(1)} s`;
    byId('storyOverlay').dataset.chapter=String(chapter.id);byId('storyOverlay').dataset.phase=phase;byId('storyOverlay').dataset.shot=String(state.index);
    window.InkStoryRenderer.draw(byId('previewCanvas'),chapter,phase,state,{reducedMotion:window.matchMedia('(prefers-reduced-motion: reduce)').matches});
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
