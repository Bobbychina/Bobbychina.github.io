(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.InkStoryTimeline=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function duration(shots){
    if(!Array.isArray(shots)||!shots.length) throw new TypeError('A scene needs at least one shot');
    return shots.reduce((sum,shot)=>{
      if(!Number.isFinite(shot.duration)||shot.duration<=0) throw new TypeError('Invalid shot duration');
      return sum+shot.duration;
    },0);
  }
  function sample(shots,time){
    const total=duration(shots);
    if(!Number.isFinite(time)) throw new TypeError('Invalid scene time');
    const elapsed=Math.min(total,Math.max(0,time));
    let start=0,index=0;
    while(index<shots.length-1&&elapsed>=start+shots[index].duration){start+=shots[index].duration;index++;}
    return {shot:shots[index],index,start,local:elapsed-start,progress:Math.min(1,(elapsed-start)/shots[index].duration),elapsed,total,finished:elapsed>=total};
  }
  function next(shots,time){const frame=sample(shots,time);return Math.min(frame.total,frame.start+frame.shot.duration);}
  return {duration,sample,next};
});
