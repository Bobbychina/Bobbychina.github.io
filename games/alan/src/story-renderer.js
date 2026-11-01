(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.InkStoryRenderer=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PAPER='#e8e3d5',INK='#28332f',RED='#a34535',JADE='#589b91';
  const clamp=value=>Math.max(0,Math.min(1,value));
  const ease=value=>{const t=clamp(value);return t*t*(3-2*t);};
  const mix=(a,b,t)=>a+(b-a)*t;
  const backdrops=new Map();
  function backdrop(chapter){
    if(!globalThis.InkLandscape||typeof document==='undefined')return null;
    if(!backdrops.has(chapter)){
      const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
      globalThis.InkLandscape.paintMap(canvas.getContext('2d'),0,chapter,1280);
      backdrops.set(chapter,canvas);
    }
    return backdrops.get(chapter);
  }
  function path(ctx,points,color,width=2,fill=false){
    ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));
    ctx.lineWidth=width;ctx.strokeStyle=color;ctx.lineJoin='round';ctx.lineCap='round';
    if(fill){ctx.closePath();ctx.fillStyle=color;ctx.fill();}else ctx.stroke();
  }
  function ellipse(ctx,x,y,rx,ry,color){ctx.beginPath();ctx.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
  function cord(ctx,x1,y1,x2,y2,time,slack=30){
    ctx.strokeStyle=RED;ctx.lineWidth=2.4;ctx.beginPath();ctx.moveTo(x1,y1);
    ctx.bezierCurveTo(mix(x1,x2,.35),y1+slack+Math.sin(time)*3,mix(x1,x2,.7),y2+slack,x2,y2);ctx.stroke();
    ctx.strokeRect(x2-3,y2-3,6,6);
  }
  function jade(ctx,x,y,size=1,time=0){
    ctx.save();ctx.translate(x,y);ctx.rotate(Math.sin(time*.3)*.06);ctx.scale(size,size);
    path(ctx,[[-17,-27],[10,-25],[20,-12],[11,-4],[16,4],[3,27],[-16,22],[-24,1]],'#72a69a',1,true);
    path(ctx,[[-7,-21],[-8,-3],[3,-7],[-1,12],[7,9]],'#e4ecd9',1.7);
    ellipse(ctx,-6,-16,2.8,2.8,PAPER);cord(ctx,-6,-16,-45,-49,time,12);ctx.restore();
  }
  function figure(ctx,{x,y,scale=1,role='hero',pose='idle',time=0,alpha=1,facing=1,character='nameless'}){
    const walk=pose==='walk'?Math.sin(time*5):0;
    const reach=['reach','push'].includes(pose),kneel=pose==='kneel';
    ctx.save();ctx.globalAlpha*=alpha;ctx.translate(x,y);ctx.scale(scale*facing,scale);
    if(kneel)ctx.translate(0,18);
    const height=role==='boss'?1.15:1;ctx.scale(height,height);
    ellipse(ctx,0,2,33,6,'rgba(31,44,38,.14)');
    const cape=role==='hero'?RED:role==='companion'?'#8d7770':'#4b5248';
    path(ctx,[[-9,-81],[-31-3*Math.sin(time*2),-52],[-36-walk*5,-18],[-13,-30],[8,-70]],cape,1,true);
    path(ctx,[[0,-79],[-3,-48],[0,-31]],INK,9);
    path(ctx,[[0,-32],[-14-walk*13,-3]],INK,7);
    path(ctx,[[0,-32],[14+walk*13,-1]],INK,7);
    path(ctx,[[0,-70],[reach?24:15,reach?-68:-49],[reach?47:23,reach?-79:-30]],INK,6);
    path(ctx,[[-3,-70],[-16,-48],[-11,-29]],INK,5);
    ellipse(ctx,-1,-94,12,13,INK);
    if(role==='hero'){
      if(character==='mingxiao'){path(ctx,[[-19,-102],[12,-108],[24,-98]],'#d5dfdc',3);}
      else path(ctx,[[-28,-98],[-2,-117],[30,-98],[-28,-98]],'#6c6250',1,true);
      path(ctx,[[16,-36],[52,-87]],'#cbd1c3',3);
      path(ctx,[[12,-31],[21,-40]],INK,4);
    }else if(role==='companion'){
      path(ctx,[[5,-102],[15,-83],[12,-69]],INK,5);
      cord(ctx,reach?47:23,reach?-79:-30,reach?65:35,reach?-70:-24,time,8);
    }else{
      path(ctx,[[-18,-101],[0,-114],[22,-99]],INK,5);
      path(ctx,[[24,-31],[50,-112]],'#515b50',5);
    }
    ctx.restore();
  }
  function mist(ctx,seed,time){
    const wash=ctx.createLinearGradient(0,100,0,620);wash.addColorStop(0,'rgba(232,227,213,0)');wash.addColorStop(.65,'rgba(232,227,213,.7)');wash.addColorStop(1,'rgba(232,227,213,0)');
    ctx.fillStyle=wash;ctx.fillRect(-400,100,2100,550);
    for(let i=0;i<12;i++)path(ctx,[[-200+i*131+Math.sin(time*.08+i)*18,510+i%4*22],[700+i*90,506+i%4*22]],'rgba(214,211,195,.22)',9);
  }
  function mountains(ctx,chapter,time){
    for(let layer=0;layer<3;layer++){
      const points=[[-600,700]];
      for(let i=0;i<40;i++){const x=-600+i*75;const y=290+layer*79-Math.abs(Math.sin(i*.43+chapter*.77+layer*1.2))*170+Math.sin(i*1.8)*24;points.push([x,y]);}
      points.push([2400,700]);path(ctx,points,['#b9bdae','#9aa699','#748a7d'][layer],1,true);
    }
    mist(ctx,chapter,time);
  }
  function roof(ctx,x,y,width){
    ctx.beginPath();ctx.moveTo(x-width/2-30,y-14);ctx.quadraticCurveTo(x-width*.28,y-9,x-10,y-61);ctx.quadraticCurveTo(x+width*.28,y-10,x+width/2+28,y-14);ctx.lineTo(x+width/2-7,y+9);ctx.quadraticCurveTo(x,y+24,x-width/2+7,y+9);ctx.closePath();ctx.fillStyle=INK;ctx.fill();
    for(let i=0;i<11;i++){const px=x-width/2+i*width/10,arc=1-Math.abs(i-5)/5;path(ctx,[[px,y-8-arc*43],[px+(i-5)*2,y+5]],'#596250',1);}
    path(ctx,[[x-width/2-20,y-9],[x-width/2,y+8],[x,y+18],[x+width/2,y+8],[x+width/2+22,y-9]],'#61705a',2);
    ctx.fillStyle='#9a9983';ctx.fillRect(x-width/2+10,y+13,width-20,80);
    for(let i=0;i<7;i++)path(ctx,[[x-width/2+12+i*width/7,y+7],[x-width/2+14+i*width/7,y+90]],'rgba(43,52,43,.35)',2);
  }
  function bridge(ctx,broken,time){
    const spans=broken?[[40,390],[780,1280]]:[[20,1280]];
    for(const [left,right] of spans){
      path(ctx,[[left,510],[right,510]],'#716d58',9);
      for(let x=left;x<right;x+=72){path(ctx,[[x,511],[x-9,598]],'#525b4b',5);path(ctx,[[x,510],[x+50,512]],'#323f35',2);}
      cord(ctx,left,473,right,473,time,8);
    }
    if(broken){path(ctx,[[365,511],[431,541]],'#716d58',7);path(ctx,[[788,511],[742,550]],'#716d58',7);}
  }
  function bell(ctx,x,y,time,ringing=false){
    ctx.save();ctx.translate(x,y);ctx.rotate(ringing?Math.sin(time*2)*.055:0);
    path(ctx,[[-35,-44],[-44,18],[-58,33],[58,33],[44,18],[35,-44]],'#6b7866',1,true);
    path(ctx,[[-32,-25],[31,-25]],'#c3c5ad',2);path(ctx,[[-43,17],[44,17]],'#35493c',4);
    ellipse(ctx,0,-48,8,12,'#616c5c');path(ctx,[[0,31],[0,101]],'#655e4b',2);ctx.restore();
  }
  function scenery(ctx,chapter,time,outro,progress){
    const river=ctx.createLinearGradient(0,470,0,720);river.addColorStop(0,'#b8c4b4');river.addColorStop(1,'#dedcc9');ctx.fillStyle=river;ctx.fillRect(-600,470,3000,400);
    for(let i=0;i<25;i++){const x=(i*173+time*8)%1800-250;path(ctx,[[x,500+i*9],[x+35+i%4*20,500+i*9]],'rgba(69,94,78,.16)',1);}
    if(chapter===0){
      path(ctx,[[-200,530],[1020,501],[1490,565],[1500,645],[-200,649]],'#a2aa91',1,true);
      for(let i=0;i<9;i++)path(ctx,[[65+i*155,525],[70+i*155,470]],'#697661',3);
      cord(ctx,530,537,699,552,time,12);
    }else if(chapter===1){
      roof(ctx,190,459,400);roof(ctx,690,358,330);roof(ctx,1120,442,280);
      path(ctx,[[0,540],[350,540],[350,575],[1300,575]],'#777f69',12);
      path(ctx,[[950,40],[933,113],[954,109],[919,192]],'rgba(247,245,226,.65)',3);
    }else if(chapter===2){
      for(let i=0;i<16;i++){
        const x=30+i*85,y=555+(i%3)*20;path(ctx,[[x,y],[x-16,75-i%3*30]],i%2?'#667d60':'#899479',5+i%3);
        for(let j=0;j<5;j++){const py=110+j*64;path(ctx,[[x-12,py],[x-62,py-31],[x-32,py-24]],'#65795e',2);path(ctx,[[x-12,py],[x+44,py-36]],'#7b896c',2);}
      }bridge(ctx,false,time);
    }else if(chapter===3){
      bridge(ctx,true,time);path(ctx,[[520,570],[660,570],[633,598],[544,598]],'#586b58',1,true);path(ctx,[[579,571],[581,485]],'#536550',3);
      if(outro)cord(ctx,389,480,781,480,time,80*(1-progress));
    }else if(chapter===4){
      ctx.fillStyle='#87907a';ctx.fillRect(280,315,740,235);roof(ctx,650,303,800);roof(ctx,180,408,270);roof(ctx,1110,408,270);
      ctx.fillStyle='#3e5142';ctx.fillRect(425,337,450,213);
      path(ctx,[[476,330],[476,546],[814,546],[814,330]],'#a09a7c',10);
      bell(ctx,650,378,time,outro);path(ctx,[[100,555],[1190,555]],'#79816a',14);
    }else if(chapter===5){
      path(ctx,[[-100,180],[300,116],[443,197],[420,500],[1080,568],[-100,660]],'#697f71',1,true);
      path(ctx,[[800,-30],[1160,0],[1110,640],[850,612]],'#eef0df',1,true);
      for(let i=0;i<18;i++)path(ctx,[[815+i*17,20],[800+i*18,500]],'rgba(154,188,175,.27)',2);
      bridge(ctx,true,time);cord(ctx,350,490,832,490,time,outro?16:73);
    }else if(chapter===6){
      const warm=ctx.createLinearGradient(0,170,0,500);warm.addColorStop(0,'rgba(166,83,50,0)');warm.addColorStop(1,'rgba(166,83,50,.19)');ctx.fillStyle=warm;ctx.fillRect(-500,170,2300,420);
      ctx.fillStyle='#677563';ctx.fillRect(-100,456,1500,180);
      for(let x=-100;x<1400;x+=95)ctx.fillRect(x,424,63,55);
      path(ctx,[[965,460],[965,163]],INK,6);path(ctx,[[968,170],[1100,193+Math.sin(time)*7],[1060,239],[968,223]],RED,1,true);
      for(const x of [210,1080]){path(ctx,[[x,445],[x,366]],'#4b5b47',5);ellipse(ctx,x,351,8+Math.sin(time*4),22,'#a4643b');}
    }else if(chapter===7){
      for(const x of [160,480,800,1100]){ellipse(ctx,x,558,100,13,'#718d7a');path(ctx,[[x-88,550],[x-40,525],[x+75,540],[x+97,553]],'#8d9c81',1,true);}
      for(let i=0;i<6;i++)figure(ctx,{x:310+i*132,y:497,role:'companion',scale:.76,alpha:outro?.1:.17,facing:i%2?1:-1,time});
    }else{
      path(ctx,[[100,550],[100,510],[600,495],[632,565]],'#87937a',1,true);path(ctx,[[686,565],[720,495],[1210,505],[1210,550]],'#7b8c73',1,true);
      const release=outro?ease(progress):0;
      ellipse(ctx,760,360,110*(1-release)+20,155*(1-release),'rgba(32,47,40,.7)');
      for(let i=0;i<8;i++){
        const angle=i*Math.PI/4+time*.08;
        path(ctx,[[760+Math.cos(angle)*65,360+Math.sin(angle)*85],[760+Math.cos(angle)*155,360+Math.sin(angle)*170]],`rgba(40,55,43,${.2*(1-release)})`,3);
      }
    }
  }
  function inkPull(ctx,progress,time){
    const x=mix(660,900,ease(progress));
    for(let i=0;i<6;i++){
      ctx.strokeStyle=`rgba(26,39,34,${.23+i*.05})`;ctx.lineWidth=4+i*3;ctx.beginPath();ctx.moveTo(x+80,390-i*14);
      ctx.bezierCurveTo(x+30,285+i*28,x-50,490+i*9,x-130,395+i*16);ctx.stroke();
    }
    figure(ctx,{x,y:520-progress*55,role:'companion',pose:'reach',facing:-1,time,alpha:1-ease(progress)*.65});
  }
  function draw(canvas,chapter,phase,frame,{reducedMotion=false,character='nameless'}={}){
    const ctx=canvas.getContext('2d');
    const box=canvas.getBoundingClientRect();const ratio=Math.min(globalThis.devicePixelRatio||1,2);
    const width=Math.max(1,Math.round(box.width*ratio)),height=Math.max(1,Math.round(box.height*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.fillStyle=PAPER;ctx.fillRect(0,0,box.width,box.height);
    const scale=Math.min(box.width/1280,box.height/720);ctx.translate(box.width/2,box.height*.47);ctx.scale(scale,scale);ctx.translate(-640,-360);
    const t=reducedMotion?2:frame.elapsed,p=reducedMotion?.5:ease(frame.progress),outro=phase==='outro',shot=frame.shot;
    const targets={landscape:[640,350],hero:[355,435],companion:[740,420],boss:[890,418],jade:[585,433],cord:[580,472],mirror:[680,475],bell:[650,388]};
    const target=targets[shot.focus]||targets.landscape;
    let zoom=shot.camera==='close'?1.72:shot.camera==='medium'?1.16:1;
    if(shot.focus==='landscape')zoom=1;
    const drift=reducedMotion?0:(p-.5)*18;
    ctx.save();ctx.translate(640,350);ctx.scale(zoom,zoom);ctx.translate(-target[0]-drift,-target[1]);
    const landscape=backdrop(chapter.id);
    if(landscape)ctx.drawImage(landscape,0,0);else mountains(ctx,chapter.id,t);
    scenery(ctx,chapter.id,t,outro,frame.elapsed/frame.total);
    const firstSeize=chapter.id===0&&phase==='intro'&&shot.action==='seize';
    const finalJoin=chapter.id===8&&outro;
    const heroPose=firstSeize||finalJoin&&shot.action==='join'?'reach':shot.action==='depart'||shot.action==='approach'?'walk':'idle';
    const heroX=shot.action==='depart'?mix(355,finalJoin?730:455,p):355;
    figure(ctx,{x:heroX,y:535,pose:heroPose,time:t,character});
    if(firstSeize)inkPull(ctx,p,t);
    else if(chapter.id===0&&phase==='intro'||chapter.id===8||chapter.id===5&&shot.focus==='companion'){
      const companionX=finalJoin?(shot.action==='depart'?heroX+70:mix(740,430,clamp((frame.elapsed-12)/12))):740;
      figure(ctx,{x:companionX,y:535,role:'companion',pose:finalJoin?(shot.action==='depart'?'walk':'reach'):'idle',time:t,facing:shot.action==='depart'?1:-1,alpha:chapter.id===5?.3:chapter.id===8&&!outro?.6:1});
    }
    if(chapter.id>0||outro){
      const dissolve=chapter.id===8&&outro?1-p:1;
      figure(ctx,{x:890,y:535,role:'boss',pose:outro?'kneel':'idle',time:t,facing:-1,alpha:dissolve});
    }
    if(shot.focus==='jade'){
      path(ctx,[[509,492],[553,459],[577,466],[616,458]],INK,9);
      path(ctx,[[553,459],[570,444]],INK,7);
      jade(ctx,585,433,2.35,t);
    }
    if(shot.focus==='cord'){
      cord(ctx,heroX+24,460,655,481,t,25);jade(ctx,647,493,.55,t);
      if(chapter.id===6){ctx.fillStyle='#c7bc9e';ctx.fillRect(610,481,25,37);path(ctx,[[615,492],[630,492],[619,507]],'#76654e',2);}
      if(chapter.id===2&&phase==='intro'){
        const arrowX=mix(1170,658,ease(frame.local/.65));
        path(ctx,[[arrowX+74,465],[arrowX,482]],INK,2);
        path(ctx,[[arrowX+9,475],[arrowX,482],[arrowX+13,484]],INK,1,true);
      }
    }
    if(shot.focus==='bell'){
      bell(ctx,650,388,t,outro);
      if(!outro)for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(650,421+i*9,8+i*2,5,-.4+i*.3,0,Math.PI*2);ctx.strokeStyle='rgba(35,44,37,.7)';ctx.lineWidth=3;ctx.stroke();}
    }
    if(chapter.id===7&&phase==='intro')cord(ctx,520,565,mix(790,744,p),549,t,4);
    if(chapter.id===6&&phase==='intro'&&shot.focus==='boss')ellipse(ctx,840,420,6,16+Math.sin(t*2)*2,'#b47b4a');
    if(finalJoin&&shot.action==='join')cord(ctx,heroX+27,461,mix(740,430,p)-33,461,t,25);
    if(chapter.id!==5&&chapter.id!==6){
      ctx.strokeStyle='rgba(65,84,72,.16)';ctx.lineWidth=.8;
      for(let i=0;i<65;i++){const x=(i*137)%1700-180,y=((i*61+t*170)%720);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-9,y+23);ctx.stroke();}
    }
    ctx.restore();
    ctx.setTransform(ratio,0,0,ratio,0,0);
    ctx.fillStyle='rgba(68,61,38,.07)';
    for(let i=0;i<550;i++){const x=(i*7919%10007)/10007*box.width,y=(i*4513%10009)/10009*box.height;ctx.fillRect(x,y,.8,.8);}
    if(!reducedMotion){const transition=Math.max(0,1-frame.local/.24);if(transition>0){ctx.fillStyle=`rgba(232,227,213,${transition*.78})`;ctx.fillRect(0,0,box.width,box.height);}}
  }
  return {draw};
});
