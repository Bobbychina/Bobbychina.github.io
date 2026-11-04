/* ===========================================================
   章节数值扩展（第三关「霜钟回廊」/ 第四关「余烬熔庭」）
   -----------------------------------------------------------
   职责：
     · 只往 C.ENEMY_TYPES / C.LEVELS 里**追加**条目，并补充章节主题、
       规则、遭遇上限、无尽 Boss 池与遗物 metadata。
     · 纯配置：不依赖 DOM，不计算、不注册任何系统，不覆盖旧键。
   加载顺序：
     js/game/config.js 先加载（提供 VS.Config），本文件随后执行。
   消费方（由战斗层实现，本文件只声明名字）：
     · ENEMY_TYPES[x].behavior     → 常规怪的行为脚本名（warder/archer/...）
     · ENEMY_TYPES[x].behaviorConfig → 该行为脚本的参数（可选）
     · LEVELS[i].mechanic          → CHAPTER_RULES 里的地图机制键（frost/forge）
     · LEVELS[i].bosses[j].type     → 查 ENEMY_TYPES[type].encounter 得到遭遇脚本名（bell/queen/colossus）
   排错：
     · 报“chapters-config.js 需要 config.js” = 脚本顺序错了；
     · 战斗行为在 encounters.js，章节环境在 stages.js；新增机制需同时实现消费逻辑。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  if (!C) throw new Error('chapters-config.js 需要先加载 js/game/config.js');

  /* ---------------- 第三 / 第四关常规怪 ----------------
     hp/speed/radius/damage/xp 是基准值（关卡乘区由 LEVELS 施加）。
     minTime   = 本关内多少秒后进入抽取池
     weight    = 抽取权重
     onlyFromLevel = 从第几关（0 起：第三关 = 2，第四关 = 3）开始可抽
     shape     = 降级画法（新美术由渲染层按 id 接管）
     behavior  = 行为脚本名，behaviorConfig 为其参数
     spawnOnly = true 表示只能由其它怪/机制生成，不参与常规抽取
  ------------------------------------------------------ */

  C.ENEMY_TYPES = C.ENEMY_TYPES || {};

  /* —— 第三关「霜钟回廊」：守钟、远程、冲撞、奶妈 —— */
  C.ENEMY_TYPES.frostguard = {
    id: 'frostguard', name: '铸霜卫士',
    hp: 140, speed: 54, radius: 17, damage: 19, xp: 10,
    color: '#5f9ec4', edge: '#c9f2ff', shape: 'blob',
    minTime: 0, weight: 7, onlyFromLevel: 2,
    behavior: 'warder'
  };
  C.ENEMY_TYPES.icearcher = {
    id: 'icearcher', name: '冰棱猎手',
    hp: 80, speed: 66, radius: 13, damage: 16, xp: 8,
    color: '#87e0f3', edge: '#e6fbff', shape: 'skull',
    minTime: 30, weight: 7, onlyFromLevel: 2,
    behavior: 'archer'
  };
  C.ENEMY_TYPES.rimehound = {
    id: 'rimehound', name: '霜咬猎犬',
    hp: 65, speed: 112, radius: 12, damage: 18, xp: 6,
    color: '#446f8c', edge: '#a9e8ff', shape: 'bat',
    minTime: 50, weight: 8, onlyFromLevel: 2,
    behavior: 'charger',
    /* 前摇站定 → 直线突进；1 段冲刺，冷却 3 秒 */
    behaviorConfig: { cooldown: 3, windup: 0.6, speed: 330, dashes: 1 }
  };
  C.ENEMY_TYPES.bellwisp = {
    id: 'bellwisp', name: '鸣钟幽灵',
    hp: 100, speed: 61, radius: 13, damage: 13, xp: 10,
    color: '#b8d9c9', edge: '#f0fff7', shape: 'ghost',
    minTime: 90, weight: 4, onlyFromLevel: 2,
    behavior: 'healer'
  };

  /* —— 第四关「余烬熔庭」：自爆、法系、重骑、分裂 —— */
  C.ENEMY_TYPES.cinderbug = {
    id: 'cinderbug', name: '爆燃虫',
    hp: 52, speed: 104, radius: 11, damage: 16, xp: 6,
    color: '#c9542a', edge: '#ffc078', shape: 'bat',
    minTime: 0, weight: 8, onlyFromLevel: 3,
    behavior: 'bomber'
  };
  C.ENEMY_TYPES.ashcaster = {
    id: 'ashcaster', name: '余烬术士',
    hp: 100, speed: 58, radius: 15, damage: 20, xp: 12,
    color: '#8c5a3c', edge: '#ffb277', shape: 'ghost',
    minTime: 25, weight: 6, onlyFromLevel: 3,
    behavior: 'caster'
  };
  C.ENEMY_TYPES.obsidianknight = {
    id: 'obsidianknight', name: '黑曜重骑',
    hp: 180, speed: 73, radius: 19, damage: 25, xp: 14,
    color: '#3f3a44', edge: '#e39a53', shape: 'skull',
    minTime: 60, weight: 5, onlyFromLevel: 3,
    behavior: 'charger',
    /* 比霜咬猎犬更慢的出手，但两段冲刺、突进更快 */
    behaviorConfig: { cooldown: 4, windup: 0.75, speed: 370, dashes: 2 }
  };
  C.ENEMY_TYPES.emberslime = {
    id: 'emberslime', name: '熔核黏团',
    hp: 130, speed: 48, radius: 18, damage: 17, xp: 11,
    color: '#a8431f', edge: '#ffd08a', shape: 'blob',
    minTime: 10, weight: 7, onlyFromLevel: 3,
    behavior: 'splitter'
  };

  /* —— 分裂产物：不参与抽取（weight 0 + spawnOnly），由 splitter 生成 —— */
  C.ENEMY_TYPES.cinderling = {
    id: 'cinderling', name: '熔渣幼体',
    hp: 18, speed: 112, radius: 7, damage: 8, xp: 1,
    color: '#d9662f', edge: '#ffd9a1', shape: 'blob',
    minTime: 0, weight: 0, onlyFromLevel: 3,
    behavior: 'chaser', spawnOnly: true
  };

  /* ---------------- 章节 Boss ----------------
     不参与常规抽取（minTime=Infinity / weight=0），由 LEVELS[i].bosses 定点投放。
     behavior 不在这里声明：Boss 的招式由 encounter 对应的遭遇脚本驱动；
     关卡条目里 kit:false 即表示"不走通用 BossKit，按 encounter 打"。
  ------------------------------------------------------ */

  C.ENEMY_TYPES.bellkeeper = {
    id: 'bellkeeper', name: '霜钟守望',
    hp: 2400, speed: 43, radius: 40, damage: 30, xp: 100,
    color: '#3f7f9e', edge: '#d6f6ff', shape: 'skull',
    minTime: Infinity, weight: 0, onlyFromLevel: 2,
    boss: true, elite: true, encounter: 'bell'
  };
  C.ENEMY_TYPES.rimeQueen = {
    id: 'rimeQueen', name: '霜冕女王',
    hp: 3400, speed: 50, radius: 42, damage: 34, xp: 150,
    color: '#9fe8ff', edge: '#ffffff', shape: 'ghost',
    minTime: Infinity, weight: 0, onlyFromLevel: 2,
    boss: true, elite: true, encounter: 'queen'
  };
  C.ENEMY_TYPES.emberColossus = {
    id: 'emberColossus', name: '熔心巨像',
    hp: 4200, speed: 38, radius: 48, damage: 40, xp: 200,
    color: '#c25627', edge: '#ffd98a', shape: 'blob',
    minTime: Infinity, weight: 0, onlyFromLevel: 3,
    boss: true, elite: true, encounter: 'colossus'
  };

  /* ---------------- 第三关「霜钟回廊」 ---------------- */

  C.LEVELS.push({
    id: 3,
    name: '第三关',
    subtitle: '霜钟回廊',
    duration: 720,                       // 12:00 结算：女王没死 = 无法通关
    fresh: false,                        // 继承上一关的构筑（本文件不处理继承逻辑）
    clearRule: 'killFinalBoss',
    noRest: true,                        // 没有喘息阶段
    bosses: [
      {
        at: 240, type: 'bellkeeper', name: '霜钟守望',
        tip: '霜 钟 守 望 · 第 一 响',
        sub: '钟声落下时脚下结冰 · 站进暖光里回温',
        reward: 'firstBoss',
        kit: false
      },
      {
        at: 600, type: 'rimeQueen', name: '霜冕女王',
        tip: '霜 冕 女 王 降 临',
        sub: '12:00 之前击败女王 · 留意交叉冰晶与带缺口的钟环',
        reward: 'levelUp',
        requireKill: true,
        kit: false
      }
    ],
    hpMul: 2,
    dmgMul: 1.65,
    speedMul: 1.10,
    spawnMul: 0.95,
    unlockMul: 0.22,
    playerDmgMul: 1.2,
    /* 这一关由本章四只霜怪当主角：权重 ×3，旧怪保留但不抢戏 */
    typeBias: {
      frostguard: 3, icearcher: 3, rimehound: 3, bellwisp: 3
    },
    ground: 'ground_frost',
    deco: 'deco_l2',
    decoCell: 108,
    decoDensity: 0.5,
    /* 地图机制键：见下方 CHAPTER_RULES.frost（寒冷条 + 暖光点） */
    mechanic: 'frost'
  });

  /* ---------------- 第四关「余烬熔庭」 ---------------- */

  C.LEVELS.push({
    id: 4,
    name: '第四关',
    subtitle: '余烬熔庭',
    duration: 720,                       // 12:00 结算：巨像没死 = 无法通关
    fresh: false,
    clearRule: 'killFinalBoss',
    noRest: true,
    bosses: [
      {
        at: 600, type: 'emberColossus', name: '熔心巨像',
        tip: '熔 心 巨 像 苏 醒',
        sub: '12:00 之前击碎熔心 · 卸压阀能打断巨像并制造破绽',
        reward: 'levelUp',
        requireKill: true,
        kit: false
      }
    ],
    hpMul: 2.6,
    dmgMul: 1.9,
    speedMul: 1.12,
    spawnMul: 0.9,
    unlockMul: 0.18,
    playerDmgMul: 1.3,
    typeBias: {
      cinderbug: 3, ashcaster: 3, obsidianknight: 3, emberslime: 3
    },
    ground: 'ground_ember',
    deco: 'deco_l1',
    decoCell: 110,
    decoDensity: 0.45,
    /* 地图机制键：见下方 CHAPTER_RULES.forge（地火喷口 + 预警） */
    mechanic: 'forge'
  });

  /* ---------------- 章节主题（地表 / 网格 / 装饰线的配色） ---------------- */

  C.CHAPTER_THEMES = {
    ground_frost: {
      base: '#172e3d',
      tile: '#263f50',
      line: '#426379',
      accent: '#87e0f3'
    },
    ground_ember: {
      base: '#241c1c',
      tile: '#43312a',
      line: '#6b4430',
      accent: '#e39a53'
    }
  };

  /* ---------------- 章节地图规则 ----------------
     frost（第三关 · 寒冷）：
       coldStart 从入场后第几秒开始寒潮；period/active 为周期与持续秒数；
       gain 暴露时每秒增长；温暖区内 warmRate 每秒降低；
       warmRadius 暖光半径；maxCold 上限；damage/damageEvery 满寒后结算；
       slowAt/speedMul 低温减速阈值与倍率；shrines 遗物祭坛时间表（秒）。
     forge（第四关 · 地火）：
       period 喷发周期；warning 预警时长；active 喷口持续；
       width/length 喷流尺寸；damage 单次伤害；ventRadius 卸压阀交互半径；
       ventCharge 阀门充能时长；shrines 遗物祭坛时间表（秒）。
  ------------------------------------------------------ */

  C.CHAPTER_RULES = {
    frost: {
      coldStart: 90, period: 28, active: 12, gain: 9,
      warmRadius: 95, warmRate: 25, maxCold: 100,
      damage: 14, damageEvery: 2.2,
      slowAt: 70, speedMul: 0.76,
      shrines: [90, 330]
    },
    forge: {
      period: 18, warning: 1.3, active: 2.2,
      width: 38, length: 760, damage: 22,
      ventRadius: 48, ventCharge: 1.2,
      shrines: [90, 330]
    }
  };

  /* ---------------- 遭遇战上限（性能保护，Boss encounter 共用） ---------------- */

  C.ENCOUNTER_LIMITS = {
    shots: 180,
    zones: 48,
    rings: 14,
    beams: 12
  };

  /* ---------------- 无尽模式追加 ---------------- */

  C.ENDLESS.BIOME_SECONDS = 600;
  /* 第三/第四关 Boss 也进无尽轮换；保留原有两只 */
  C.ENDLESS.BOSS_POOL = ['boss', 'lemonPig', 'bellkeeper', 'rimeQueen', 'emberColossus'];

  /* ---------------- 遗物（纯 metadata，不带 apply） ----------------
     由主代理的遗物系统读取 id/name/icon/color/desc 展示与生效；
     这里只描述效果文案，不实现任何数值逻辑，避免两处口径。
  ---------------------------------------------------------------- */

  C.RELICS = [
    {
      id: 'lantern', name: '玉霜符', icon: '❄', color: '#87e0f3',
      desc: '范围 +18% / 移动速度 -5%'
    },
    {
      id: 'emberHeart', name: '熔心残片', icon: '❤', color: '#e8703f',
      desc: '伤害 +20% / 最大生命 -12%'
    },
    {
      id: 'pilgrim', name: '旅者铭牌', icon: '➤', color: '#e3c27a',
      desc: '移速 +12% / 拾取范围 +18%'
    },
    {
      id: 'hourglass', name: '余时沙漏', icon: '⏳', color: '#c9d4e0',
      desc: '攻速 +15% / 闪避冷却 ×0.9'
    },
    {
      id: 'mercy', name: '护灯之誓', icon: '✚', color: '#a8e6a0',
      desc: '每秒回血 +1 / 生命上限 +15'
    },
    {
      id: 'mirror', name: '碎镜印', icon: '✧', color: '#d8c6ff',
      desc: '暴击率 +8 个百分点 / 额外弹数 +1 / 护甲 -1'
    }
  ];

})(window.VS = window.VS || {});
