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
    MAX_HP: 100,
    REGEN: 0.7,              // 每秒回血
    ARMOR: 0,
    PICKUP_RADIUS: 82,
    INVULN: 0.7,             // 受伤后的无敌时间（秒）
    KNOCKBACK: 130,          // 被撞时的击退初速
    PUSH_DAMP: 7,            // 击退衰减速率
    START_WEAPON: 'bolt'
  };

  /* ---------------- 经验与升级 ---------------- */

  C.XP = {
    BASE: 5,
    GROWTH: 1.28,            // 升到 n+1 级需要 BASE * GROWTH^(n-1)
    MAX_LEVEL: 99,
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
    boss: {
      id: 'boss', name: '尸潮之王',
      hp: 3200, speed: 42, radius: 44, damage: 42, xp: 320,
      color: '#5f9e57', edge: '#d6ffc9', shape: 'blob',
      minTime: Infinity, weight: 0, boss: true
    }
  };

  /* ---------------- 刷怪 / 波次曲线 ---------------- */

  C.SPAWN = {
    WAVE_PERIOD: 30,          // 每 30 秒推进一个波次
    START_INTERVAL: 1.15,     // 初始刷怪间隔（秒）
    MIN_INTERVAL: 0.15,
    INTERVAL_DECAY: 0.0072,   // 每秒缩短的间隔
    BATCH_GROWTH: 0.021,      // 每只怪的数量增长：1 + floor(t * BATCH_GROWTH)
    MAX_BATCH: 15,
    MAX_ENEMIES: 520,         // 场上怪物硬上限（性能保护）
    RING_MARGIN: 110,         // 在屏幕外多远处生成
    RING_MIN_FACTOR: 0.75,    // 生成环最小半径系数（相对屏幕对角线的一半）

    /*
     * 怪物强度按"关键帧曲线"插值，而不是固定每秒增长率。
     * 这样能单独压住"2 分钟之后明显变难"那一段：
     * 0→2 分钟涨得快（保持前期紧张感），2→4 分钟的尸潮阶段刻意放缓，
     * 免得怪又多又厚直接把玩家压死。
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
      typeBias: null,
      tip: '', sub: ''
    },
    {
      id: 'horde', name: '尸潮', short: '尸潮',
      from: 120, until: 240,
      spawnMul: 0.40, batchMul: 2.80,
      typeBias: { zombie: 6, skeleton: 1.8 },
      tip: '尸 潮 来 袭', sub: '僵尸数量暴增，撑住！'
    },
    {
      id: 'rest', name: '休整', short: '休整',
      from: 240, until: 300,
      spawnMul: 2.20, batchMul: 0.40,
      typeBias: null,
      tip: '短 暂 喘 息', sub: '怪物变少了，抓紧捡经验升级'
    },
    {
      id: 'boss', name: '首领', short: '首领',
      from: 300, until: Infinity,
      spawnMul: 1.05, batchMul: 1.15,
      typeBias: null,
      tip: '尸 潮 之 王 降 临', sub: '击败它！'
    }
  ];

  /* ---------------- Boss ---------------- */

  C.BOSS = {
    FIRST_AT: 300,        // 第 5 分钟首次出现
    REPEAT_DELAY: 90,     // 击杀后隔多久再来一只（越来越强）
    HP_GROWTH: 1.45,      // 每只比上一只强多少倍
    ENTRY_SHAKE: 16,      // 登场时的镜头震动
    MINION_BATCH: 3       // 登场时额外带几只小怪
  };

  /* ---------------- 掉落 ---------------- */

  C.DROP = {
    HEART_CHANCE: 0.018,      // 普通怪掉红心概率
    HEART_ELITE_CHANCE: 0.9,  // 精英怪掉红心概率
    HEART_HEAL: 20,
    HEART_RADIUS: 9,
    GEM_RADIUS: 6
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
      stats: function (lv) {
        return {
          radius: 64 + 10 * (lv - 1),
          damage: 6 + 3.5 * (lv - 1),
          tick: Math.max(0.22, 0.55 - 0.03 * (lv - 1))
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
      stats: function (lv) {
        return {
          count: 2 + Math.floor(lv / 2),
          radius: 76 + 8 * (lv - 1),
          damage: 9 + 4.5 * (lv - 1),
          spin: 2.1 + 0.13 * (lv - 1),
          bladeRadius: 13,
          hitCooldown: 0.40
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
      stats: function (lv) {
        return {
          cooldown: Math.max(1.4, 3.6 - 0.30 * (lv - 1)),
          damage: 16 + 8 * (lv - 1),
          maxRadius: 155 + 24 * (lv - 1),
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
