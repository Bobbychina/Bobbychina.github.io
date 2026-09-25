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

    /* ---------------- 第二关「柠檬深渊」专属怪物 ----------------
       2026-09-25：原来两关共用上面这批人形怪（同一套模板换色），
       走进去两关打起来长得一模一样。这里补 3 只"酸适应"的怪：
       美术在 tools/enemy-art.js（16×16、两帧），组名 = 这里的 id。
       onlyFromLevel: 1 表示**第二关及以后**才会进抽取池
       （和 C.WEAPONS / C.UPGRADES / C.PETS 同一个字段口径，
        敌人这一侧由 Enemies.pickType 读 VS.Levels.allows 把关）。
       数值按第二关的乘区（hp ×1.30 / dmg ×1.50 / speed ×1.08）配，
       定位分别是"中坚肉盾 / 快而脆的骚扰 / 后期法系"。 */
    acidhusk: {
      id: 'acidhusk', name: '蚀酸腐尸',
      hp: 64, speed: 50, radius: 15, damage: 16, xp: 4,
      color: '#7d9440', edge: '#a8bd5c', shape: 'blob',
      minTime: 90, weight: 8, onlyFromLevel: 1
    },
    sporebat: {
      id: 'sporebat', name: '孢蝠',
      hp: 30, speed: 128, radius: 10, damage: 12, xp: 3,
      color: '#c2d84a', edge: '#e2f07a', shape: 'bat',
      minTime: 60, weight: 8, onlyFromLevel: 1
    },
    toxicshaman: {
      id: 'toxicshaman', name: '腐沼祭司',
      hp: 110, speed: 70, radius: 14, damage: 20, xp: 9,
      color: '#5e7430', edge: '#c2d84a', shape: 'ghost',
      minTime: 210, weight: 5, onlyFromLevel: 1
    },
    /* Boss：由 C.BOSS.SCHEDULE 定时单独投放，不参与常规抽取
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
    },
    /* 第二个 Boss：柠檬猪（2026-09-23 加强）
       原来只会"吐一发扇形酸液"，站在侧面绕圈就能白嫖 —— 现在三种攻击轮换：
         fan  扇形三连（原来的招式，弹速与伤害上调）
         ring 环形十连（贴身会被糊一脸，必须往外闪）
         pool 往玩家脚下吐酸液池（在地上持续掉血，逼你换位置）
       血量/伤害/速度也都上调了一档，10 分钟不再是"顺手打死"。 */
    lemonPig: {
      id: 'lemonPig', name: '柠檬猪',
      hp: 11000, speed: 52, radius: 54, damage: 58, xp: 900,
      color: '#e3d84a', edge: '#fffbae', shape: 'blob',
      minTime: Infinity, weight: 0, boss: true,
      ranged: {
        cooldown: 1.9,       // 每隔多久出手一次
        count: 3,            // 扇形：一次几发
        spread: 0.34,        // 扇形散布（弧度）
        speed: 250,          // 酸液飞行速度
        radius: 13,
        damage: 26,
        life: 3.2,
        range: 760,          // 玩家在这个距离内才会出手
        patterns: ['fan', 'ring', 'pool'],   // 三种攻击轮换（顺序固定，玩家能背板）
        ringCount: 10,       // 环形弹幕发数
        ringSpeed: 175,      // 环形弹幕慢一点，是"走位题"不是"反应题"
        /* 酸液池：吐在玩家脚下，落地后持续掉血 */
        pool: {
          count: 3,          // 一次吐几滩
          radius: 78,
          life: 5.0,         // 存在几秒
          tick: 0.5,         // 每几秒结算一次
          damage: 12,
          dist: 130,         // 落在离玩家多远处（命中点附近会散开）
          gap: 0.12          // 同一轮几滩之间的间隔（秒）
        }
      }
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
    /*
     * 速度曲线（2026-09-23 改）：
     * 原来速度是**纯线性**的 `1 + t/950`，到 10 分钟就是 ×1.63 —— 而玩家速度只有 205，
     * 于是暗影（132 基础）在 10 分钟变成 **215 px/s，比玩家还快**：无论怎么跑都会被贴上，
     * 玩起来就是"打完第一只 Boss 之后怪快得离谱"。现在改成关键帧曲线：
     *   · 0–5:00 与旧公式**逐点一致**（1.13 / 1.25 / 1.32），前期手感不动；
     *   · 5:00→6:00 之间松手降到 ×1.14，之后几乎封顶（15 分钟才 1.24）。
     * 结果：5:00 之后最快的暗影 ≈150 px/s，玩家始终能拉开 25% 以上的身位。
     */
    SPEED_CURVE: [
      { at: 0, mult: 1.00 },
      { at: 120, mult: 1.13 },     // 旧公式 1.126
      { at: 240, mult: 1.25 },     // 旧公式 1.253
      { at: 300, mult: 1.32 },     // 旧公式 1.316 —— 5:00 之前完全不变
      { at: 360, mult: 1.14 },     // 打完第一只 Boss 之后松手（≈ −14%）
      { at: 900, mult: 1.20 },
      { at: 1800, mult: 1.24 }
    ],

    HP_SCALE_PER_SEC: 1 / 130,    // 保留作参考，实际强度走上面的 HP_CURVE
    DMG_SCALE_PER_SEC: 1 / 170,
    SPEED_SCALE_PER_SEC: 1 / 950, // 已被 SPEED_CURVE 取代，仅作历史参考（别再改它）
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

  /* ---------------- Boss ----------------
     固定时间表，每只只投一次。
     （2026-09-22 改：删掉"击杀后 90 秒再来一只"的循环 Boss —— 那只会落在 7 分多钟；
       现在改成 5:00 尸潮之王、10:00 柠檬猪，各一只。）
  ---------------------------------------- */

  C.BOSS = {
    SCHEDULE: [
      {
        at: 300, type: 'boss', name: '尸潮之王',
        tip: '尸 潮 之 王 降 临', sub: '单挑时间 · 小怪不再刷新',
        reward: 'firstBoss'          // 击杀后：等级 +1 并解锁宠物三选一
      },
      {
        at: 600, type: 'lemonPig', name: '柠檬猪',
        tip: '柠 檬 猪 出 现', sub: '小心它嘴里的柠檬酸液',
        reward: null,
        kit: false                   // 不走 BossKit 的四档七招，只有逼近 + 酸液
      }
    ],
    ENTRY_SHAKE: 16,      // 登场时的镜头震动
    MINION_BATCH: 0,      // 登场不带小怪（Boss 战期间常规刷怪仍然停）
    PAUSE_SPAWN: true,    // Boss 存活期间完全停止常规刷怪，直到它死亡
    HP_GROWTH: 1.45,      // 仅作参考；固定时间表下不再按次数增厚

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

  /* ---------------- 关卡 ----------------
     一次"跑图" = 若干关，打完一关进下一关，最后一关打完算通关。
     · duration  本关时长（秒），时间到就过关（第一关 = 15:00）
     · bosses    本关的 Boss 时间表（时间按**本关**的 game.time 算）
     · hpMul / dmgMul / speedMul   本关所有怪物的额外乘区（叠在难度曲线之上）
     · spawnMul  刷怪间隔倍率（<1 = 刷得更密）
     · unlockMul 怪物解锁时间倍率（<1 = 强力怪更早出场）
     · typeBias  额外权重（让某一关"某种怪特别多"）
     · ground    地面底图精灵名（每关一张，零每帧开销，见 tools/gen-sprites.js）

     第二关：节奏和第一关**同一套逻辑**（2:00 尸潮 / 3:00 金球 / 5:00 第一只 Boss），
     区别只有三点：没有 4:00–5:00 的喘息时间、10:00 不刷 Boss（但超级经验从 10:00 开始掉）、
     12:00 刷最终 Boss 且**必须打死**才能通关（15:00 时它还活着 = 这一局无法通关）。
  ---------------------------------------- */

  C.LEVELS = [
    {
      id: 1,
      name: '第一关',
      subtitle: '血色荒野',
      duration: 900,                     // 15:00 过关
      bosses: C.BOSS.SCHEDULE,           // 5:00 尸潮之王（送宠物）、10:00 柠檬猪
      hpMul: 1, dmgMul: 1, speedMul: 1,
      spawnMul: 1, unlockMul: 1,
      typeBias: null,
      /* 第一关「血色荒野」美术：焦土锈红地表 + 废墟/焦骨/焦草/焦木桩一套点缀。
         deco 指向 SpriteGroups 里的组名；Cell/Density 控制撒点网格与疏密。
         第一关要"荒" —— 网格大一点、密度低一点，留出大片空地给走位。 */
      deco: 'deco_l1',
      decoCell: 116,
      decoDensity: 0.58,
      ground: 'ground'
    },
    {
      id: 2,
      name: '第二关',
      subtitle: '柠檬深渊',
      duration: 900,                     // 15:00 结算：最终 Boss 死了才算通关
      /* 和第二关的**第一关没有任何关系**：进去以后从 1 级重新开始，
         不带第一关的等级/武器/增益/宠物（见 Game.startLevel 的 def.fresh 分支）。 */
      fresh: true,
      /* 没有喘息时间：4:00–5:00 的休整阶段照常刷怪 */
      noRest: true,
      /* 通关条件：12:00 的最终 Boss 必须被打死 */
      clearRule: 'killFinalBoss',
      bosses: [
        {
          at: 300, type: 'boss', name: '尸潮之王',
          tip: '尸 潮 之 王 降 临', sub: '和第一关同一个节拍 · 单挑时间',
          reward: 'firstBoss'          // 重新开始 → 宠物重新三选一
        },
        {
          at: 720, type: 'lemonPig', name: '柠檬猪 · 最终形态', hpMul: 1.6,
          tip: '柠 檬 猪 · 最 终 形 态', sub: '15:00 之前必须打死它，否则无法通关',
          reward: 'levelUp',
          requireKill: true            // ← 通关条件挂在这一条上
        }
      ],
      /* 强度 = 第一关的 1.3 倍（2026-09-23 站长要求"削弱第二关的怪、减少血条"：
         血量从 ×1.5 降到 **×1.3**；伤害仍然是 ×1.5，怪还是打得更疼） */
      hpMul: 1.30,
      dmgMul: 1.50,
      speedMul: 1.08,                    // 速度只小幅回补（第一关已经压过速度曲线）
      spawnMul: 0.90,                    // 刷得更密一点
      unlockMul: 0.35,                   // 暗影/巨魔/精英很早就出来
      /* 第二关专属的三只酸怪加权：这一关就是要"柠檬深渊的怪"当主角，
         但也保留第一关那几只的偏置（关卡不是把旧怪全换掉，是换一拨主力）。 */
      typeBias: {
        wraith: 2.2, brute: 1.8, elite: 1.6, ghost: 1.4,
        acidhusk: 2.4, sporebat: 2.0, toxicshaman: 1.6
      },

      /* 玩家技能伤害（2026-09-23 站长点单：怪血有点厚，所有技能小幅加强）
         —— 加在**武器的伤害数值**上，六件武器一起吃到（statsFor 里统一施加）：
            bolt / garlic / orbit / nova / acidSpray / chain 全部 ×playerDmgMul。
         2026-09-24 再小加强一档：1.15 → **1.25**（怪血 ×1.30，等效压力从约 1.13 倍降到约 1.04 倍）。
         刻意只给 25%：既不"超标"，也让第二关的怪不至于变成磨血。
         注意：环绕骨刃 / 腐化光环上面还有 weaponMul ×1.5，两条叠起来是 ×1.875。 */
      playerDmgMul: 1.25,

      /* 只在第二关生效的武器强化（站长点单：只加强环绕骨刃和腐化光环） */
      weaponMul: { orbit: 1.5, garlic: 1.5 },

      /* 地图机制：地上会自己冒柠檬酸池（范围中等、有预警、站进去持续掉血） */
      hazards: {
        interval: 7.5,     // 每隔多久冒一批
        count: 2,          // 一批几滩
        radius: 66,        // 半径："不要太大也别太小" —— 比 Boss 那滩(78)小一圈，比经验石吸附圈大
        warn: 0.9,         // 冒出来之前的预警时间（先亮一圈，再喷）
        life: 6.5,         // 存在几秒
        tick: 0.5,         // 每几秒结算一次
        damage: 9,         // 每次结算的伤害（比 Boss 的 12 低，因为它是持续存在的环境）
        max: 9,            // 场上同时最多几滩（性能 + 不至于走不动路）
        near: 150,         // 刷新在离玩家多远的圈内（太远没意义，太近没反应时间）
        spread: 320        // 距离的随机上浮
      },

      /* 第二关「柠檬深渊」美术：酸沼黄绿地表 + 沼石/蚀骨/酸沼草/柠檬树一套点缀。
         2026-09-25 站长反馈"绿色装饰太多"：密度 0.72 → **0.50**（少撒约三成），
         网格 96 → 104（撒得也更稀）；同时把孢子囊/酸沼草/柠檬树的配色往黄白与
         柠檬色偏（见 tools/deco-art.js），这一关不再是一整片绿。 */
      deco: 'deco_l2',
      decoCell: 104,
      decoDensity: 0.50,

      ground: 'ground_l2'
    }
  ];

  /* ---------------- 宠物（打完第一只 Boss 三选一） ----------------
     `onlyFromLevel` 控制哪几关能抽到（0 起：第二关 = 1）。
     2026-09-23 改：删掉「德国的狼」，第二关加入「柠檬猪」。
  ---------------------------------------- */

  C.PETS = [
    {
      id: 'faerie', name: '小精灵', icon: '✧', color: '#a6f7b0',
      desc: '每秒额外回复 10 点生命',
      detail: '生命回复 +10/秒'
    },
    {
      id: 'pig', name: '死亡猪神', icon: '🐷', color: '#ffb4c8',
      desc: '每 2 分钟积攒一次复活：致命伤时自动消耗，回复一半生命并无敌 5 秒',
      detail: '每 2 分钟 +1 次复活'
    },
    {
      id: 'lemonPig', name: '柠檬猪', icon: '🍋', color: '#e3d84a',
      onlyFromLevel: 1,                     // 只有第二关能选
      desc: '免疫所有柠檬酸液伤害（Boss 的酸液弹、地上的酸池都不怕），并且最大生命直接变成 250',
      detail: '酸液免疫 · 血量 250'
    }
  ];

  C.PET = {
    FAERIE_REGEN: 10,            // 小精灵：每秒额外回血（3 → 10，站长嫌弱）
    PIG_CHARGE_INTERVAL: 120,    // 死亡猪神：每多少秒攒一次复活
    PIG_MAX_CHARGES: 3,          // 最多攒几次
    PIG_REVIVE_HP: 0.5,          // 复活回复最大生命的比例
    PIG_REVIVE_INVULN: 5,        // 复活后的无敌秒数
    LEMON_ACID_RESIST: 1,        // 柠檬猪：酸液伤害免疫（1 = 100% 减免）
    LEMON_MAX_HP: 250            // 柠檬猪：把最大生命直接顶到 250
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
       掉落率按时间和进度分档（见 Pickups.goldChance）。 */
    GOLD_ORB_FROM: 180,             // 存活满 3 分钟（180 秒）后才开始掉落
    GOLD_ORB_CHANCE_EARLY: 0.05,    // 3:00–4:00 期间：5%
    GOLD_ORB_CHANCE_AFTER_BOSS: 0.20, // 打完第一只 Boss 之后：20%
    GOLD_ORB_CHANCE: 0.05,          // 兼容旧字段（等于 EARLY）
    GOLD_ORB_MULT: 100,             // 经验量 = 普通经验球的 100 倍
    GOLD_ORB_RADIUS: 9,             // 比普通球大一圈，更显眼
    GOLD_MAGNET_MULT: 1.7,          // 金色球的吸附范围更大，尽量别让它被漏掉

    /* --- 超级经验球 ---
       10 分钟之后 0.3% 概率掉落；拾取后等级直接 +1（不是加经验）。 */
    SUPER_ORB_FROM: 600,            // 存活满 10 分钟
    SUPER_ORB_CHANCE: 0.003,        // 0.3%
    SUPER_ORB_RADIUS: 11,
    SUPER_MAGNET_MULT: 2.0
  };

  /* ---------------- 武器 ----------------
     每个武器：stats(level) 返回该等级下的数值；
     describe(level) 返回卡片上显示的一行说明。

     school（流派增益，2026-09-23 新增）：
       拥有这把武器之后，升级卡池里会多出一张"流派"卡 —— 思路是**缺什么补什么**：
         bolt      缺清群 → 穿透 + 暴击
         garlic    贴脸才有用 → 吸血 + 范围
         orbit     数量少、转速慢 → +1 骨刃 + 转速
         nova      空窗期长 → 半径 + 冷却
         acidSpray 伤害低 → 酸滩伤害 + 持续时间
         chain     连得短 → 连锁数 + 搜索半径
     数值改在 statsFor() 里统一施加（见 weapons.js），加新武器别忘了给 school。
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
      },
      /* 流派：飞弹缺的是"清群"，所以补穿透 + 暴击 */
      school: {
        name: '贯穿强化', icon: '✦', color: '#7fd8ff', max: 3,
        short: '飞弹穿透 +1 · 暴击率 +7%',
        apply: function (p, w) {
          w.schoolPierce = (w.schoolPierce || 0) + 1;
          p.critChance += 0.07;
        }
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
      },
      /* 流派：光环要贴脸才有用，所以补"站得住"（吸血）+ 范围 */
      school: {
        name: '腐蚀蔓延', icon: '◉', color: '#9ae66e', max: 3,
        short: '吸血 +1.2/次击杀 · 光环范围 +12%',
        apply: function (p, w) {
          p.lifesteal += 1.2;
          w.schoolArea = (w.schoolArea || 0) + 0.12;
        }
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
      },
      /* 流派：骨刃缺"数量"和"转速"，所以各补一档 */
      school: {
        name: '利刃回旋', icon: '✜', color: '#ffd166', max: 3,
        short: '骨刃 +1 把 · 旋转速度 +10%',
        apply: function (p, w) {
          w.schoolBlades = (w.schoolBlades || 0) + 1;
          w.schoolSpeed = (w.schoolSpeed || 0) + 0.10;
        }
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
      },
      /* 流派：新星空窗期长，所以补半径 + 冷却 */
      school: {
        name: '冲击共振', icon: '❂', color: '#ff6b6b', max: 3,
        short: '新星半径 +12% · 间隔 -10%',
        apply: function (p, w) {
          w.schoolArea = (w.schoolArea || 0) + 0.12;
          w.schoolCd = (w.schoolCd || 0) + 0.10;
        }
      }
    },

    /* ---------------- 第二关专属武器（onlyFromLevel: 1 = 下标 1 = 第二关） ----------------
       第一关抽不到，第二关"重新开始"以后才会进卡池。 */

    acidSpray: {
      id: 'acidSpray', name: '柠檬喷射器', icon: '☣', color: '#c7f24a',
      desc: '朝最近的敌人抛出酸液，落地炸开一小滩腐蚀酸液，持续伤害站在里面的敌人。',
      maxLevel: 8,
      onlyFromLevel: 1,
      stats: function (lv) {
        return {
          cooldown: Math.max(0.85, 2.6 - 0.22 * (lv - 1)),
          damage: 6 + 3.2 * (lv - 1),        // 每次结算的伤害
          radius: 44 + 5 * (lv - 1),
          life: 3.0 + 0.25 * (lv - 1),
          tick: 0.45,
          range: 460
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '每 ' + s.tick.toFixed(2) + 's 造成 ' + VS.Utils.fixed(s.damage) +
               ' 伤害 · 酸滩半径 ' + Math.round(s.radius) + ' · 持续 ' + s.life.toFixed(1) + 's';
      },
      /* 流派：喷射器缺"伤害"，所以补酸滩伤害 + 持续时间（等于多烫几下） */
      school: {
        name: '腐蚀扩散', icon: '☣', color: '#c7f24a', max: 3,
        short: '酸滩伤害 +25% · 持续时间 +0.6s',
        apply: function (p, w) {
          w.schoolDmg = (w.schoolDmg || 0) + 0.25;
          w.schoolLife = (w.schoolLife || 0) + 0.6;
        }
      }
    },

    chain: {
      id: 'chain', name: '雷击链', icon: '⚡', color: '#ffe066',
      desc: '周期性劈向最近的敌人，并沿着附近的敌人连锁跳跃。',
      maxLevel: 8,
      onlyFromLevel: 1,
      stats: function (lv) {
        return {
          cooldown: Math.max(0.95, 2.9 - 0.24 * (lv - 1)),
          damage: 11 + 5.5 * (lv - 1),
          chains: 2 + Math.floor(lv / 2),    // 最多连几个
          range: 320 + 18 * (lv - 1),        // 第一跳的搜索半径
          jump: 150 + 6 * (lv - 1)           // 后续每一跳的最大距离
        };
      },
      describe: function (lv) {
        var s = this.stats(lv);
        return '伤害 ' + s.damage + ' · 间隔 ' + s.cooldown.toFixed(2) + 's · 连锁最多 ' + s.chains + ' 个';
      },
      /* 流派：雷击缺"够得着"，所以补连锁数 + 搜索半径 */
      school: {
        name: '连锁过载', icon: '⚡', color: '#ffe066', max: 3,
        short: '连锁目标 +1 · 搜索半径 +15%',
        apply: function (p, w) {
          w.schoolChains = (w.schoolChains || 0) + 1;
          w.schoolRange = (w.schoolRange || 0) + 0.15;
        }
      }
    }
  };

  /** 可用于"获取新武器"的清单（开局自带 bolt） */
  C.START_WEAPONS = ['bolt'];
  C.NEW_WEAPON_POOL = ['garlic', 'orbit', 'nova', 'acidSpray', 'chain'];
  C.MAX_WEAPONS = 4;

  /* ---------------- 环绕骨刃的"切换范围"（E 键，2026-09-23） ----------------
     拥有环绕骨刃之后按 E 在两种形态之间切换（按住不连发）：
       近身：半径 ×0.78、转速 ×1.2 —— 收起刀刃贴脸打，转得更快
       外扩：半径 ×1.45、转速 ×0.9 —— 覆盖更大，但转得慢
     伤害不随之变化，纯粹是"打法取向"的开关：被围住切近身、想在远处蹭经验切外扩。 */
  C.ORBIT_MODES = [
    { id: 'close', name: '近身', radiusMul: 0.78, spinMul: 1.20, tip: '骨刃收拢 · 转得更快' },
    { id: 'wide', name: '外扩', radiusMul: 1.45, spinMul: 0.90, tip: '骨刃外扩 · 覆盖更大' }
  ];
  C.ORBIT_TOGGLE_KEY = 'E';

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
    },

    /* ---------------- 第二关专属增益（onlyFromLevel: 1） ---------------- */

    {
      id: 'acidResist', name: '酸液抗性', icon: '☣', max: 2, weight: 8, onlyFromLevel: 1,
      desc: '受到的酸液伤害 -50%（Boss 的酸液弹与地上的柠檬酸池都算）',
      apply: function (p) { p.acidResist = Math.min(1, (p.acidResist || 0) + 0.5); }
    },
    {
      id: 'lifesteal', name: '嗜血', icon: '❦', max: 4, weight: 7, onlyFromLevel: 1,
      desc: '每次击杀回复 0.8 点生命',
      apply: function (p) { p.lifesteal = (p.lifesteal || 0) + 0.8; }
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
