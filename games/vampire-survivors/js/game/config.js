/* ===========================================================
   全部数值配置：想调平衡，只改这个文件
   —— 玩家 / 经验 / 怪物类型 / 刷怪曲线 / 武器 / 增益 全在这里
   =========================================================== */
(function (VS) {
  'use strict';

  var C = {};

  /* ---------------- 世界 ---------------- */

  C.WORLD = {
    W: 3400,          // 地图宽（像素）
    H: 3400,          // 地图高
    PAD: 28,          // 边界内的安全内缩
    GRID: 80          // 背景网格尺寸
  };

  /* ---------------- 摄像机 ---------------- */

  C.CAMERA = {
    SMOOTH: 9,        // 跟随平滑速率（越大越紧）
    LOOKAHEAD: 0.10   // 朝移动方向的前瞻比例（相对速度）
  };

  /* ---------------- 玩家 ---------------- */

  C.PLAYER = {
    RADIUS: 13,
    SPEED: 205,              // 像素/秒
    MAX_HP: 120,             // 平衡：100 → 120（见下）
    REGEN: 1.0,              // 每秒回血（平衡：0.7 → 1.0）
    ARMOR: 0,
    PICKUP_RADIUS: 120,      // 经验石吸附半径（平衡：82 → 120，见下）
    INVULN: 1.0,             // 受伤后的无敌时间（秒）。平衡：0.7 → 1.0 —— 被围住时每秒最多吃一下，
                             // 不然 100 血配 12~15 点接触伤害只有 5 秒活路（测量台实测：被围住必死）
    KNOCKBACK: 130,          // 被撞时的击退初速
    PUSH_DAMP: 7,            // 击退衰减速率
    START_WEAPON: 'bolt',

    /* 闪避（Shift）：Boss 加强后的"手法"入口 —— 弹幕/激光/冲撞都能靠它躲掉，
       无敌帧 0.28 秒比冲刺时长略长，这样"卡着时机闪"才有意义。 */
    DASH: { SPEED: 900, TIME: 0.16, CD: 1.5, IFRAME: 0.30 }
  };

  /* ---------------- 经验与升级 ---------------- */

  C.XP = {
    BASE: 5,
    GROWTH: 1.28,            // 升到 n+1 级需要 BASE * GROWTH^(n-1)
    MAX_LEVEL: 99,

    /* 平衡（2026-09-23 测量台数据）：原来只有 PICKUP_RADIUS 82px 内才吸经验石，
       而玩家打怪基本都在"边退边打"，杀完就往外走 → 石头全留在原地，实测 60 秒只到 Lv1、
       105 秒才 Lv4，人越打越弱、怪越堆越多（2 分钟后直接顶到 520 上限）。
       改法：石头在 DRIFT_RADIUS 内会**慢慢往玩家飘**（比吸附慢得多，不抢吸附的手感），
       加上 PICKUP_RADIUS 82 → 120，让"边打边退"也能吃到经验。 */
    GEM_DRIFT_RADIUS: 200,   // 这个距离内经验石开始慢慢飘向玩家
    GEM_DRIFT_ACC: 240,      // 飘的加速度（吸附是 1500，所以只是"慢慢挪"）
    GEM_MAGNET_ACC: 1500     // 经验石被吸走时的加速度
  };

  /* ---------------- 怪物类型 ----------------
     hp/speed/damage 是 1 级波次（t=0）的基准值，
     实际生成时会乘上随时间增长的倍率。
     minTime = 多少秒后开始出现；weight = 抽取权重
     shape 供渲染模块决定画法：blob / bat / skull / ghost
  ------------------------------------------- */

  C.ENEMY_TYPES = {
    bat: {
      id: 'bat', name: '血蝠',
      hp: 9, speed: 112, radius: 9, damage: 6, xp: 1,
      color: '#a878ff', edge: '#d9c2ff', shape: 'bat',
      minTime: 0, weight: 10
    },
    zombie: {
      id: 'zombie', name: '腐尸',
      hp: 26, speed: 56, radius: 14, damage: 11, xp: 2,
      color: '#6fbf73', edge: '#b6f0b9', shape: 'blob',
      minTime: 25, weight: 9
    },
    skeleton: {
      id: 'skeleton', name: '骷髅兵',
      hp: 19, speed: 84, radius: 12, damage: 9, xp: 2,
      color: '#d8d2c0', edge: '#fffdf2', shape: 'skull',
      minTime: 70, weight: 9
    },
    ghost: {
      id: 'ghost', name: '幽魂',
      hp: 36, speed: 98, radius: 13, damage: 13, xp: 3,
      color: '#7fd8ff', edge: '#d3f4ff', shape: 'ghost',
      minTime: 130, weight: 8
    },
    brute: {
      id: 'brute', name: '巨魔',
      hp: 120, speed: 46, radius: 21, damage: 19, xp: 6,
      color: '#d1553f', edge: '#ffb3a0', shape: 'blob',
      minTime: 200, weight: 6
    },
    wraith: {
      id: 'wraith', name: '暗影',
      hp: 78, speed: 132, radius: 12, damage: 16, xp: 5,
      color: '#6b5bb5', edge: '#c3b4ff', shape: 'ghost',
      minTime: 280, weight: 6
    },
    elite: {
      id: 'elite', name: '精英·血裔',
      hp: 460, speed: 64, radius: 27, damage: 28, xp: 26,
      color: '#ffcc44', edge: '#fff0b8', shape: 'blob',
      minTime: 240, weight: 1.3, elite: true
    },
    /* Boss：由 C.BOSS 定时单独投放，不参与常规抽取
       （minTime=Infinity 保证 pickType 永远不会选到它） */
    /* Boss 本体（加强版）：血量 3200 → 4000（**这是基础值**，实际还要乘难度曲线 HP_CURVE：
       5:00 首次登场时 ×2.45 ≈ 9800）。速度略降、撞击更疼 —— 打得久才谈得上"手法"。
       血量口径量了四轮才对，三个"秤不准"的坑都记在这儿（调这个数字之前先看这段）：
       ① 机器人测出 117~203 DPS 且忽高忽低 —— 三个原因都在**探针自己**，不在游戏；
       ② 标签页不在前台时 requestAnimationFrame 被浏览器节流，而伤害是按帧结算的 → 帧率减半 DPS 也减半。
          修法：CDP `Emulation.setFocusEmulationEnabled` 打开焦点模拟，并且每局把帧率一起量出来（ttkFps）。
       ③ 卡片的乘区（`damageMul / attackSpeedMul / areaMul / projBonus / luck / critChance`）会跨局残留，
          只重置伤害/攻速时同一套构筑实测 160 vs 337 DPS；打 Boss 期间还会一直升级白拿卡（60 秒后 DPS 从 120 跳到 200+）。
          修法：六个乘区打回初始值 + 测量期间冻结升级。
       ④ 清干净后的真数字：中期构筑（bolt Lv5 + 光环 Lv4、零被动、60fps）**≈120 DPS** → 9800 血 **TTK ≈ 82 秒**
          （探针 ⑩ 窗口 20~95 秒）。满构筑（5:00 时 Lv20+ 带被动）约 3~5 倍 DPS → 20~30 秒，
          这就是设计意图：Boss 的威胁在**机制**（护盾逼你清小弟、激光/落石逼你动），不是血条。
       后续 Boss 再乘 HP_GROWTH 1.45。
       它的伤害减免由 shield 阶段与虚弱期共同决定（见 bosskit） */
    boss: {
      id: 'boss', name: '尸潮之王',
      hp: 4000, speed: 46, radius: 46, damage: 52, xp: 620,
      color: '#5f9e57', edge: '#d6ffc9', shape: 'blob',
      minTime: Infinity, weight: 0, boss: true
    }
  };

  /* ---------------- 刷怪 / 波次曲线 ---------------- */

  C.SPAWN = {
    WAVE_PERIOD: 30,          // 每 30 秒推进一个波次
    START_INTERVAL: 1.05,     // 初始刷怪间隔（秒）
    MIN_INTERVAL: 0.34,       // 平衡：0.15 → 0.34（见下）
    INTERVAL_DECAY: 0.0060,   // 每秒缩短的间隔（原来 0.0072）
    BATCH_GROWTH: 0.012,      // 每只怪的数量增长：1 + floor(t * BATCH_GROWTH)（原来 0.021）
    MAX_BATCH: 11,            // 原来 15
    MAX_ENEMIES: 520,         // 场上怪物硬上限（性能保护）
    /* 人潮刹车：场上怪 ≥ CROWD_AT 时刷怪间隔 × CROWD_MUL（怪掉回去就恢复）。
       测量台数据：弱构筑的最差一局 180 秒就顶满 520、之后只能被磨死；有这道闸至少能撑住不再滚雪球。 */
    CROWD_AT: 380,
    CROWD_MUL: 2.4,
    RING_MARGIN: 110,         // 在屏幕外多远处生成
    RING_MIN_FACTOR: 0.75,    // 生成环最小半径系数（相对屏幕对角线的一半）

    /*
     * 2026-09-23 平衡（测量台 `tools/vs-balance.mjs` 的实测依据）：
     * 改前 = 尸潮阶段(spawnMul 0.40 / batchMul 2.80) × 间隔被 MIN_INTERVAL 0.15 夹住，
     * 实际刷怪速率 **≈53 只/秒**（120s 时：(1.15-0.864)×0.40 → 0.15 下限，batch 3×2.8=8 → 8/0.15）。
     * 结果：2:00 一到十几秒内就顶到 520 硬上限，机器人玩家 128 秒必死、全程只到 Lv8。
     * 改后：120s ≈ 5.8 只/秒、240s ≈ 8.8 只/秒，留出"打得动"的空间；
     * 难度仍随时间是涨的，只是不再是断崖。
     */
    HP_CURVE: [
      { at: 0, mult: 1.00 },
      { at: 120, mult: 1.70 },
      { at: 240, mult: 2.12 },
      { at: 300, mult: 2.45 },
      { at: 600, mult: 3.60 }
    ],
    DMG_CURVE: [
      { at: 0, mult: 1.00 },
      { at: 120, mult: 1.50 },
      { at: 300, mult: 1.90 },
      { at: 600, mult: 2.60 }
    ],

    HP_SCALE_PER_SEC: 1 / 130,    // 保留作参考，实际强度走上面的 HP_CURVE
    DMG_SCALE_PER_SEC: 1 / 170,
    SPEED_SCALE_PER_SEC: 1 / 950, // 每秒 +0.105% 速度（缓慢）
    ELITE_HP_MULT: 1,             // elite 已内置高血量

    SEPARATION: 62,           // 怪物之间的分离力强度
    SEPARATION_RADIUS: 26     // 分离判定距离
  };

  /* ---------------- 阶段（按存活时间划分） ----------------
     from/until 单位秒，左闭右开。
     spawnMul : 刷怪间隔倍率（越小刷得越密）
     batchMul : 每波数量的倍率
     typeBias : 抽取权重加成，用来让某个阶段"僵尸特别多"
  ---------------------------------------------------------- */

  C.PHASES = [
    {
      id: 'normal', name: '正常', short: '正常',
      from: 0, until: 120,
      spawnMul: 1.00, batchMul: 1.00,
      typeBias: null, noSpawn: false,
      tip: '', sub: ''
    },
    {
      id: 'horde', name: '尸潮', short: '尸潮',
      from: 120, until: 240,
      spawnMul: 0.95, batchMul: 1.55,   // 平衡：0.40/2.80（≈53 只/秒，直接顶满 520 上限）→ 1.05/1.20（又太松，机器人 5 分钟零受伤）
                                        //         → 现在这组：2:00 起 ≈8.8 只/秒、4:00 前爬到 ≈11.8 只/秒
      typeBias: { zombie: 6, skeleton: 1.8 }, noSpawn: false,
      tip: '尸 潮 来 袭', sub: '僵尸数量暴增，撑住！'
    },
    {
      id: 'rest', name: '休整', short: '休整',
      from: 240, until: 300,
      spawnMul: 0, batchMul: 0,
      typeBias: null,
      noSpawn: true,          // 整段完全不刷怪
      tip: '喘 息 时 刻', sub: '怪物停止刷新 · 把地上的经验捡干净'
    },
    {
      id: 'boss', name: '首领', short: '首领',
      from: 300, until: Infinity,
      spawnMul: 1.05, batchMul: 1.15,
      typeBias: null,
      noSpawn: false,         // 由 C.BOSS.PAUSE_SPAWN 在 Boss 存活期间停刷
      tip: '尸 潮 之 王 降 临', sub: '单挑时间 · 小怪不再刷新'
    }
  ];

  /* ---------------- Boss ---------------- */

  C.BOSS = {
    FIRST_AT: 300,        // 第 5 分钟首次出现
    REPEAT_DELAY: 90,     // 击杀后隔多久再来一只（越来越强）
    HP_GROWTH: 1.45,      // 每只比上一只强多少倍
    ENTRY_SHAKE: 16,      // 登场时的镜头震动
    MINION_BATCH: 0,      // 登场不带小怪（Boss 战期间常规刷怪仍然停）
    PAUSE_SPAWN: true,    // Boss 存活期间完全停止常规刷怪，直到它死亡

    /* ---------------- 招式（M-VS「尸潮之王」加强） ----------------
       改前：它只会"走过来撞你"，没有任何招式与机制。
       改后：血分三档，每档一套招式池；**每一招都有前摇**——前摇期间 Boss 站住不动、
       身上转一圈对应颜色的光环（ring 绿 / spread 黄 / spiral 紫 / summon 橙 / charge 红），
       玩家看到光环就知道要躲哪一招。

       三档：
         压制（100%~66%）：环形弹幕 + 扇形瞄准弹
         召唤（66%~33%）：多一招招小弟（场上有上限，不会无限堆）
         暴怒（33%~0%）  ：再解锁螺旋弹幕与冲撞，出手更快、冷却更短 */
    SHOT_MAX: 320,        // 场上敌方弹幕上限（到顶就不再发射，保性能）
    MINION_MAX: 24,       // Boss 小弟的同时存在上限（打 Boss 时常规刷怪是停的，多放点才够压力）
    /* 护盾阶段（"配队思路"的核心）：血量跌破阈值时 Boss 无敌 + 召唤一波小弟，
       必须把这一波清掉才破盾、才能继续输出 —— 逼玩家在"清小怪"和"打 Boss"之间做取舍，
       也顺手惩罚纯单体 / 纯 AoE 的极端构筑。 */
    SHIELD: {
      AT: [0.62, 0.30],   // 这两档血量触发（按 maxHp 比例，从高到低只触发一次）
      WAVE: [8, 10],      // 每档召唤几只
      IFRAME: 2.5,        // 破盾后 Boss 会有一段"虚弱期"（其实是给玩家的输出窗口）
      VULN_BONUS: 1.35    // 虚弱期受伤倍率（打得好 → 收益大）
    },
    ENRAGE: { AT: 0.18, CD_MUL: 0.55, SPEED_MUL: 1.35, SHOT_DMG_MUL: 1.25 },
    PHASES: [
      { at: 1.00, name: '压制', speedMul: 1.00, cdMul: 1.00, pool: ['ring', 'spread', 'meteor'] },
      { at: 0.70, name: '召唤', speedMul: 1.06, cdMul: 0.88, pool: ['ring', 'spread', 'summon', 'meteor', 'laser'] },
      { at: 0.45, name: '暴怒', speedMul: 1.18, cdMul: 0.72, pool: ['ring', 'spread', 'spiral', 'summon', 'charge', 'laser', 'meteor'] },
      { at: 0.20, name: '狂暴', speedMul: 1.30, cdMul: 0.55, pool: ['spiral', 'ring', 'charge', 'laser', 'meteor', 'summon'] }
    ],
    /* 每招：前摇 telegraph → 施放（busy 为施放时长）→ 冷却 cd（乘当前档的 cdMul） */
    MOVES: {
      ring:   { tone: '#7ee787', telegraph: 0.85, busy: 0.35, cd: 4.6, shots: { n: 22, speed: 148, r: 7, dmg: 18, life: 5.0, spin: 0.22 } },
      spread: { tone: '#ffd166', telegraph: 0.70, busy: 0.30, cd: 5.4, shots: { n: 7, arc: 0.72, speed: 196, r: 6, dmg: 21, life: 4.2 } },
      spiral: { tone: '#b58cff', telegraph: 0.80, busy: 2.60, cd: 7.0, shots: { every: 0.095, speed: 140, r: 6, dmg: 17, life: 4.0, turn: 2.35 } },
      summon: { tone: '#ff9a6c', telegraph: 1.00, busy: 0.55, cd: 10.0, minions: 10 },
      charge: { tone: '#ff6b6b', telegraph: 0.90, busy: 1.05, cd: 7.6, speed: 380, dmg: 48 },
      /* 激光横扫：一条长射线从一侧扫到另一侧 —— 必须判断扫过来的方向、横向闪开（手法招） */
      laser:  { tone: '#ff5d5d', telegraph: 1.05, busy: 1.35, cd: 8.6, laser: { len: 520, width: 26, dmg: 30, sweep: 2.2 } },
      /* 落石：在你脚下连续标记几处，延迟后炸开 —— 逼你一直动，别站桩输出 */
      meteor: { tone: '#ffa94d', telegraph: 0.55, busy: 2.10, cd: 7.4, meteor: { count: 6, every: 0.28, delay: 0.95, radius: 68, dmg: 26 } }
    }
  };

  /* ---------------- 掉落 ---------------- */

  C.DROP = {
    HEART_CHANCE: 0.018,      // 普通怪掉红心概率
    HEART_ELITE_CHANCE: 0.9,  // 精英怪掉红心概率
    HEART_HEAL: 20,
    HEART_RADIUS: 9,
    GEM_RADIUS: 6,

    /* --- 金色经验球 ---
       普通经验球的经验量就是怪物自身的 xp 值；
       金色球 = 该值的 GOLD_ORB_MULT 倍，一次顶一百个。
       存活满 GOLD_ORB_FROM（3 分钟）之后才开始掉落，
       用来解决后期升级太慢的问题。 */
    GOLD_ORB_FROM: 180,       // 存活满 3 分钟（180 秒）后才开始掉落
    GOLD_ORB_CHANCE: 0.10,    // 解锁后，每只普通怪 10% 概率掉一颗金色经验球
    GOLD_ORB_MULT: 100,       // 经验量 = 普通经验球的 100 倍
    GOLD_ORB_RADIUS: 9,       // 比普通球大一圈，更显眼
    GOLD_MAGNET_MULT: 1.7     // 金色球的吸附范围更大，尽量别让它被漏掉
  };

  /* ---------------- 武器 ----------------
     每个武器：stats(level) 返回该等级下的数值；
     describe(level) 返回卡片上显示的一行说明。
  ------------------------------------------- */

  C.WEAPONS = {

    bolt: {
      id: 'bolt', name: '魔法飞弹', icon: '✦', color: '#7fd8ff',
      desc: '自动向最近的敌人发射飞弹，穿透力随等级提升。',
      maxLevel: 8,
      stats: function (lv) {
        return {
          cooldown: Math.max(0.20, 1.15 - 0.10 * (lv - 1)),
          damage: 13 + 6 * (lv - 1),
          speed: 470,
          radius: 5 + 0.35 * (lv - 1),
          pierce: 1 + Math.floor((lv - 1) / 3),
          count: 1 + Math.floor(lv / 3)
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '伤害 ' + s.damage + ' · 间隔 ' + s.cooldown.toFixed(2) + 's · 弹数 ' + s.count +
               (s.pierce > 1 ? ' · 穿透 ' + s.pierce : '');
      }
    },

    garlic: {
      id: 'garlic', name: '腐化光环', icon: '◉', color: '#9ae66e',
      desc: '身周持续散发腐化区域，周期性伤害范围内的所有敌人。',
      maxLevel: 8,
      /* 平衡（2026-09-23，测量台数据）：这是最典型的"轮椅" —— 满级 89.7 dps 覆盖半径 134 的整片区域、
         不用瞄准、没有空窗期。砍法：伤害 -28%、半径 -15%、节拍放慢（满级 ≈52 dps）。 */
      stats: function (lv) {
        return {
          radius: 58 + 8 * (lv - 1),
          damage: 5 + 2.4 * (lv - 1),
          tick: Math.max(0.26, 0.62 - 0.028 * (lv - 1))
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '每 ' + s.tick.toFixed(2) + 's 造成 ' + VS.Utils.fixed(s.damage) + ' 伤害 · 半径 ' + Math.round(s.radius);
      }
    },

    orbit: {
      id: 'orbit', name: '环绕骨刃', icon: '✜', color: '#ffd166',
      desc: '若干骨刃环绕身周旋转，碰到敌人即造成伤害。',
      maxLevel: 8,
      /* 平衡（2026-09-23）：另一件"轮椅" —— 满级 6 把刃、每 0.4 秒就能对同一个敌人再砍一刀（≈101 dps 常驻）。
         砍法：刃数 6→4、单次伤害 -28%、同一敌人的再命中间隔 0.4→0.55 秒（满级 ≈53 dps）。 */
      stats: function (lv) {
        return {
          count: 2 + Math.floor(lv / 3),
          radius: 70 + 6 * (lv - 1),
          damage: 8 + 3.0 * (lv - 1),
          spin: 2.1 + 0.13 * (lv - 1),
          bladeRadius: 13,
          hitCooldown: 0.55
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '伤害 ' + VS.Utils.fixed(s.damage) + ' · 数量 ' + s.count + ' · 半径 ' + Math.round(s.radius);
      }
    },

    nova: {
      id: 'nova', name: '血爆新星', icon: '❂', color: '#ff6b6b',
      desc: '周期性以自身为中心引爆冲击波，扫过范围内的所有敌人。',
      maxLevel: 8,
      /* 平衡（2026-09-23）：半径 323 的整圈扫、48 dps，配合"站桩"太舒服 —— 伤害 -20%、间隔 +30%。 */
      stats: function (lv) {
        return {
          cooldown: Math.max(1.9, 3.9 - 0.27 * (lv - 1)),
          damage: 15 + 6 * (lv - 1),
          maxRadius: 150 + 22 * (lv - 1),
          expandSpeed: 430
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '伤害 ' + s.damage + ' · 间隔 ' + s.cooldown.toFixed(2) + 's · 半径 ' + Math.round(s.maxRadius);
      }
    }
  };

  /** 可用于"获取新武器"的清单（开局自带 bolt） */
  C.START_WEAPONS = ['bolt'];
  C.NEW_WEAPON_POOL = ['garlic', 'orbit', 'nova'];
  C.MAX_WEAPONS = 4;

  /* ---------------- 升级增益 ----------------
     max  = 最多可叠加层数
     apply(player) 直接改玩家属性
  ------------------------------------------- */

  C.UPGRADES = [
    {
      id: 'dmg', name: '力量增幅', icon: '⚔', max: 8, weight: 10,
      desc: '所有伤害 +12%',
      apply: function (p) { p.damageMul *= 1.12; }
    },
    {
      id: 'aspd', name: '迅捷咏唱', icon: '⚡', max: 8, weight: 10,
      desc: '攻击速度 +12%（武器冷却缩短）',
      apply: function (p) { p.attackSpeedMul *= 1.12; }
    },
    {
      id: 'speed', name: '疾风之靴', icon: '➤', max: 5, weight: 8,
      desc: '移动速度 +10%',
      apply: function (p) { p.speed *= 1.10; }
    },
    {
      id: 'maxhp', name: '生命强化', icon: '❤', max: 8, weight: 9,
      desc: '最大生命 +25，并立即回复 25 点',
      apply: function (p) { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); }
    },
    {
      id: 'regen', name: '再生', icon: '✚', max: 6, weight: 8,
      desc: '每秒生命回复 +0.9',
      apply: function (p) { p.regen += 0.9; }
    },
    {
      id: 'armor', name: '板甲', icon: '⛨', max: 5, weight: 7,
      desc: '受到的所有伤害 -1',
      apply: function (p) { p.armor += 1; }
    },
    {
      id: 'pickup', name: '磁力核心', icon: '◎', max: 4, weight: 6,
      desc: '经验拾取范围 +30%',
      apply: function (p) { p.pickupRadius *= 1.30; }
    },
    {
      id: 'area', name: '范围扩张', icon: '◯', max: 5, weight: 7,
      desc: '武器效果范围 +15%',
      apply: function (p) { p.areaMul *= 1.15; }
    },
    {
      id: 'proj', name: '多重射击', icon: '⋔', max: 4, weight: 6,
      desc: '投射物数量 +1',
      apply: function (p) { p.projBonus += 1; }
    },
    {
      id: 'luck', name: '幸运', icon: '★', max: 5, weight: 6,
      desc: '敌人掉落经验 +15%',
      apply: function (p) { p.luck *= 1.15; }
    },
    {
      id: 'crit', name: '致命一击', icon: '✧', max: 5, weight: 7,
      desc: '暴击率 +8%（暴击造成 2 倍伤害）',
      apply: function (p) { p.critChance += 0.08; }
    }
  ];

  C.CRIT_MULT = 2.0;

  /* ---------------- 视觉 / 特效 ---------------- */

  C.FX = {
    MAX_PARTICLES: 900,
    MAX_TEXTS: 120,
    HIT_PARTICLES: 4,
    DEATH_PARTICLES: 10,
    MAX_PARTICLES_PER_FRAME: 90
  };

  /* ---------------- 主循环 ---------------- */

  C.LOOP = {
    MAX_DT: 0.05,        // 单帧最大步长（防止切标签页回来后瞬移穿墙）
    MAX_SUBSTEPS: 4      // 一帧最多补算几次
  };

  VS.register('Config', C);

})(window.VS = window.VS || {});
