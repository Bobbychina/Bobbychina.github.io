(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.InkStoryContent=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return {
  "chapters": [
    {
      "id": 0,
      "title": "墨雨长路",
      "enemy": "夺色墨将",
      "objective": "沿着红绳追过墨雨长路，追上卷走同行者的墨影。",
      "dramaticQuestion": "她被卷走前，为什么先把行者推开？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "墨雨盖住官道。两个人赶到渡口，水里却多出第三道影子。",
          "camera": "wide",
          "focus": "landscape",
          "action": "approach",
          "duration": 6
        },
        {
          "speaker": "同行者",
          "text": "别碰水里的玉光。我的玉佩还在袖里——那块是假的。",
          "camera": "close",
          "focus": "jade",
          "action": "resist",
          "duration": 5.5
        },
        {
          "speaker": "旁白",
          "text": "她把行者推开。墨影卷上她的手腕，红绳在两人之间绷断。",
          "camera": "close",
          "focus": "hero",
          "action": "seize",
          "duration": 5
        },
        {
          "speaker": "行者",
          "text": "绳头还在我这里。你撑住，我沿着这条路找你。",
          "camera": "medium",
          "focus": "cord",
          "action": "depart",
          "duration": 6.5
        }
      ],
      "outro": [
        {
          "speaker": "夺色墨将",
          "text": "绳头？她经过这里时，还在往路边的桩上打结。",
          "camera": "close",
          "focus": "boss",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "她还醒着。绳结朝外，是我们约好的出口。",
          "camera": "medium",
          "focus": "cord",
          "action": "listen",
          "duration": 5.5
        },
        {
          "speaker": "旁白",
          "text": "行者把断绳系上刀柄，踏过墨将压塌的桥板，往山里去了。",
          "camera": "wide",
          "focus": "hero",
          "action": "depart",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 1,
      "title": "檐上听雷",
      "enemy": "听雷山主",
      "objective": "攀上听雷檐，破开雷阵，问出同行者去向。",
      "dramaticQuestion": "山主守的是山门，还是墨潮的缺口？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "瓦缝里的玉光亮了一下。雷声从屋檐滚过，檐下的湿衣裳纹丝不动。",
          "camera": "close",
          "focus": "jade",
          "action": "reveal",
          "duration": 6
        },
        {
          "speaker": "听雷山主",
          "text": "别上来！我一收刀，雷就落进巷子。",
          "camera": "wide",
          "focus": "landscape",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "那就朝我来。把雷落在刀上，别落在人住的地方。",
          "camera": "medium",
          "focus": "hero",
          "action": "approach",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "听雷山主",
          "text": "她把雷引进空屋，替我保下半个村。墨气钻进地脉，我才封山。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "那我不拆你的雷孔。借一道雷，劈开山后的墨门。",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "山主抬掌引雷，雷头却偏向行者刀背，山后墨门裂开一线。",
          "camera": "wide",
          "focus": "landscape",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 2,
      "title": "竹海伏影",
      "enemy": "藏锋竹客",
      "objective": "穿过竹海迷阵，辨出竹客真身，保住他守着的墨路截口。",
      "dramaticQuestion": "谁借竹影栽赃，谁真的截住了墨？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "一支箭钉住了绳头。箭尾还在颤，第二支已经从竹梢飞出。",
          "camera": "close",
          "focus": "cord",
          "action": "seize",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "你射的是绳，不是我。你在怕后面有什么跟来？",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "藏锋竹客",
          "text": "看脚下。竹根全黑了——你每往前一步，墨就往水里近一寸。",
          "camera": "wide",
          "focus": "landscape",
          "action": "reveal",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "藏锋竹客",
          "text": "昨夜她拖走两个采药人，自己挡在墨潮前。我截竹，是怕墨顺水进村。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "所以你砍的是路，不是人。把墨逼回竹根，别让它顺沟走。",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "竹客收竹成桥，行者踏过断口；身后墨水被新竹根分成两股。",
          "camera": "wide",
          "focus": "landscape",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 3,
      "title": "断桥惊潮",
      "enemy": "逐浪渡主",
      "objective": "借渡主旧船追上墨潮，同时保住下游渡口。",
      "dramaticQuestion": "断桥是为了拦人，还是给自己留退路？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "河面漂着碎桥板，岸边却拴着一条刚补好的小船。",
          "camera": "wide",
          "focus": "landscape",
          "action": "approach",
          "duration": 6
        },
        {
          "speaker": "逐浪渡主",
          "text": "桥是我拆的。上游墨涨，船一下水，整条渡口都得沉。",
          "camera": "close",
          "focus": "boss",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "缆桩上的红绳打的是水手结。我只借旧缆，追到墨眼就还。",
          "camera": "medium",
          "focus": "cord",
          "action": "listen",
          "duration": 5.5
        }
      ],
      "outro": [
        {
          "speaker": "逐浪渡主",
          "text": "她上回也这么说。船到河心，她把我推回岸，自己跳进墨里。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "墨跟的是玉佩。她把它带离村子，却没能在归墨台脱身。",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "渡主解开缆，船头调向下游；桥桩上的墨痕开始往回流。",
          "camera": "wide",
          "focus": "landscape",
          "action": "depart",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 4,
      "title": "古寺鸣钟",
      "enemy": "守钟墨僧",
      "objective": "登上钟台，破开缠住钟绳的墨气。",
      "dramaticQuestion": "钟声压住的是墨，还是墨僧欠下的债？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "钟口朝下，声音却闷在里面。那根绳被拉得笔直，绳上全是黑墨。",
          "camera": "close",
          "focus": "bell",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "守钟墨僧",
          "text": "钟不能停。下面还有人，钟不能停！",
          "camera": "medium",
          "focus": "boss",
          "action": "seize",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "你听，横梁在裂。放开绳，让我把那团墨挑下来。",
          "camera": "wide",
          "focus": "landscape",
          "action": "approach",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "守钟墨僧",
          "text": "她在这里歇过一刻，问我：钟声最远，能不能传到归墨台。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "那就让她听见。钟绳已经松开，你守住这里，我去台上。",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "墨僧重新拉动钟绳。行者推开后门，第一声钟鸣越过了山口。",
          "camera": "wide",
          "focus": "bell",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 5,
      "title": "寒瀑栈道",
      "enemy": "断瀑刀客",
      "objective": "沿瀑壁修出落脚点，逼刀客收刀，问清归墨台封印。",
      "dramaticQuestion": "刀客砍的是路，还是最后一道堤？",
      "intro": [
        {
          "speaker": "墨中倒影",
          "text": "我在这儿。拉我一把，快一点。",
          "camera": "close",
          "focus": "companion",
          "action": "seize",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "你的绳结朝着水里。她不会这样系。",
          "camera": "close",
          "focus": "cord",
          "action": "reveal",
          "duration": 6
        },
        {
          "speaker": "断瀑刀客",
          "text": "总算有人看出来了。路我能让，封印一根也不能砍。",
          "camera": "wide",
          "focus": "landscape",
          "action": "resist",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "断瀑刀客",
          "text": "她还在台上撑着。可缝里伸出七只手，每只都戴着红绳。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "瀑边那个也在叫我拉它。先看绳结，再听它说话。",
          "camera": "medium",
          "focus": "cord",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "刀客重新系紧断缆，刀尖朝下；栈道只补出一脚宽，够一个人侧身过。",
          "camera": "wide",
          "focus": "landscape",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 6,
      "title": "烽台夜渡",
      "enemy": "镇烽守将",
      "objective": "在烽火落下前改掉火道，给守将一条不烧台的撤路。",
      "dramaticQuestion": "守将保的是城，还是不敢承认自己也怕墨？",
      "intro": [
        {
          "speaker": "镇烽守将",
          "text": "火道已经铺好。天一亮，归墨台和里面的东西一起烧。",
          "camera": "close",
          "focus": "boss",
          "action": "seize",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "街上一扇门也没关。门边的红绳串着号牌，顺风一块块翻过来。",
          "camera": "wide",
          "focus": "landscape",
          "action": "reveal",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "先把火把放下。她把人带走了，你看这些空屋的号牌。",
          "camera": "medium",
          "focus": "cord",
          "action": "listen",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "镇烽守将",
          "text": "这些号牌，是她一夜一户挂上的。人走了，屋才空。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "我一路追的标记，原来是她留给后面那些人的。路还通，先别烧。",
          "camera": "medium",
          "focus": "hero",
          "action": "listen",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "守将把火把插进湿泥，火线转了个弯；城头只照见空街，没有哭声。",
          "camera": "wide",
          "focus": "landscape",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 7,
      "title": "镜湖迷阵",
      "enemy": "照影剑使",
      "objective": "辨清红绳所指的方向，穿过镜湖抵达归墨台。",
      "dramaticQuestion": "哪个影子会求救，哪个只会学她说话？",
      "intro": [
        {
          "speaker": "墨中倒影",
          "text": "我在这儿。拉我一把，快一点。",
          "camera": "close",
          "focus": "mirror",
          "action": "seize",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "在瀑边你也是这句话。水换了，连一个字都没换。",
          "camera": "medium",
          "focus": "hero",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "七个影子同时伸手。岸边的绳头却往相反的方向，轻轻收了一寸。",
          "camera": "wide",
          "focus": "mirror",
          "action": "reveal",
          "duration": 6
        }
      ],
      "outro": [
        {
          "speaker": "照影剑使",
          "text": "你分得清影子，可你分不清她是不是还活着。台缝那点光，撑不了太久。",
          "camera": "close",
          "focus": "boss",
          "action": "reveal",
          "duration": 6.5
        },
        {
          "speaker": "行者",
          "text": "岸边的绳还在往回收。不是水流——是她在那头拉。",
          "camera": "medium",
          "focus": "hero",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "剑使收剑入鞘，湖面七个倒影同时散去，只剩岸上一截湿红绳。",
          "camera": "wide",
          "focus": "mirror",
          "action": "release",
          "duration": 6.5
        }
      ]
    },
    {
      "id": 8,
      "title": "归墨终章",
      "enemy": "噬色无相",
      "objective": "与缝内的同行者里外配合，切断噬色与玉佩的联系。",
      "dramaticQuestion": "救她，是把她拉出来，还是先断开拴住她的东西？",
      "intro": [
        {
          "speaker": "旁白",
          "text": "归墨台裂成两半，一半翻着墨海，一半是她撑起的白。",
          "camera": "wide",
          "focus": "landscape",
          "action": "approach",
          "duration": 6
        },
        {
          "speaker": "同行者",
          "text": "别砍封印！先断我腕上的绳。玉佩离身，墨就找不到锚。",
          "camera": "close",
          "focus": "jade",
          "action": "resist",
          "duration": 6
        },
        {
          "speaker": "行者",
          "text": "听见了。我先打开外面这层墨。等我到你面前，再一起松手。",
          "camera": "medium",
          "focus": "hero",
          "action": "approach",
          "duration": 5.5
        }
      ],
      "outro": [
        {
          "speaker": "旁白",
          "text": "行者把红绳穿过半枚雷纹玉佩的断口，刀背一压，玉与绳同时离腕。",
          "camera": "close",
          "focus": "jade",
          "action": "release",
          "duration": 5.5
        },
        {
          "speaker": "旁白",
          "text": "玉佩落进石缝。无相扑向空下来的绳结，墨身却被合拢的白光扯散。",
          "camera": "wide",
          "focus": "boss",
          "action": "release",
          "duration": 6.5
        },
        {
          "speaker": "同行者",
          "text": "这次接住了。把绳头给我——走吧，雨还没停。",
          "camera": "close",
          "focus": "companion",
          "action": "join",
          "duration": 6
        },
        {
          "speaker": "旁白",
          "text": "她伸手，行者握住；红绳回到她掌心，裂缝外的山河一层层还色。",
          "camera": "wide",
          "focus": "landscape",
          "action": "depart",
          "duration": 6.5
        }
      ]
    }
  ]
};
});
