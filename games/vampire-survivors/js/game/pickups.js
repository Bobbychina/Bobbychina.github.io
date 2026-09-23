/* ===========================================================
   拾取物：经验球（普通 / 金色 / 超级）与红心
   -----------------------------------------------------------
   普通经验球：经验量 = 怪物自身的 xp 值，蓝→绿→金按大小分档
   金色经验球：经验量 = 普通球的 100 倍；3 分钟后开始掉，
               初期 5%，打完第一只 Boss 后升到 20%，
               球体更大、吸附范围更广，用来解决 4 分钟后升级慢的问题
   超级经验球：10 分钟后 0.3% 概率掉落，不加经验，直接等级 +1

   数量设了上限：到上限时不再新建实体，而是把经验并进已有球体，
   避免怪物密集时实体数量失控。超级经验球不受该上限约束。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  var MAX_GEMS = 520;

  /** 到上限时给新经验找一个已有的球并进去；优先合并同类 */
  function mergeInto(state, value, gold) {
    var gems = state.gems;
    var n = gems.length;
    if (n === 0) return false;

    /* 金色经验优先并进金色球，避免显示上的价值错乱 */
    if (gold) {
      for (var i = 0; i < n; i++) {
        if (gems[i].gold) { gems[i].value += value; return true; }
      }
    }

    var g = gems[(Math.random() * n) | 0];
    if (g) { g.value += value; return true; }
    return false;
  }

  var Pickups = {

    /** 场上经验球硬上限（测试与调试用） */
    MAX_GEMS: MAX_GEMS,

    create: function () {
      return {
        gems: [],
        hearts: [],
        stats: {
          normalSpawned: 0, goldSpawned: 0, superSpawned: 0,
          xpCollected: 0, goldCollected: 0, superCollected: 0
        }
      };
    },

    reset: function (state) {
      state.gems.length = 0;
      state.hearts.length = 0;
      state.stats.normalSpawned = 0;
      state.stats.goldSpawned = 0;
      state.stats.superSpawned = 0;
      state.stats.xpCollected = 0;
      state.stats.goldCollected = 0;
      state.stats.superCollected = 0;
    },

    /** 掉一颗普通经验球 */
    spawnXp: function (state, x, y, value) {
      state.stats.normalSpawned++;

      if (state.gems.length >= MAX_GEMS) {
        mergeInto(state, value, false);
        return;
      }

      var a = Math.random() * U.TAU;
      var sp = U.rand(30, 90);

      state.gems.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        value: value,
        radius: C.DROP.GEM_RADIUS,
        magnet: false,
        gold: false,
        super: false,
        phase: Math.random() * U.TAU,
        tier: value >= 20 ? 3 : (value >= 5 ? 2 : 1)
      });
    },

    /** 掉一颗金色经验球（经验量 = 普通球的 100 倍） */
    spawnGold: function (state, x, y, value) {
      state.stats.goldSpawned++;

      if (state.gems.length >= MAX_GEMS) {
        mergeInto(state, value, true);
        return;
      }

      var a = Math.random() * U.TAU;
      var sp = U.rand(20, 60);

      state.gems.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        value: value,
        radius: C.DROP.GOLD_ORB_RADIUS,
        magnet: false,
        gold: true,
        super: false,
        phase: Math.random() * U.TAU,
        tier: 4
      });
    },

    /**
     * 掉一颗超级经验球。
     * 它不带经验值 —— 拾取时直接让玩家等级 +1（见 update 里的 super 分支）。
     */
    spawnSuper: function (state, x, y) {
      state.stats.superSpawned++;

      /* 注意：超级经验球**不**受 MAX_GEMS 限制。
         它掉率只有 0.3%，落在"等级 +1"这种不可替代的奖励上，
         被合并掉就等于白掉一颗 —— 宁可多一个实体也不吞掉它。 */

      var a = Math.random() * U.TAU;
      var sp = U.rand(16, 44);

      state.gems.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        value: 0,
        radius: C.DROP.SUPER_ORB_RADIUS,
        magnet: false,
        gold: true,          // 复用金球的吸附逻辑（范围 ×2）
        super: true,
        phase: Math.random() * U.TAU,
        tier: 5
      });
    },

    /** 当前时间下的金色经验球掉落率（0 = 还没解锁） */
    goldChance: function (t, firstBossDown) {
      if (t < C.DROP.GOLD_ORB_FROM) return 0;             // 3:00 之前不掉
      if (firstBossDown) return C.DROP.GOLD_ORB_CHANCE_AFTER_BOSS;  // 打完第一只 Boss：20%
      return C.DROP.GOLD_ORB_CHANCE_EARLY;                // 3:00–4:00（及之后未打完 Boss）：5%
    },

    /** 超级经验球是否已解锁 */
    superUnlocked: function (t) { return t >= C.DROP.SUPER_ORB_FROM; },

    /** 掷一次超级经验球（10 分钟后 0.3%） */
    rollSuper: function (t) {
      if (t < C.DROP.SUPER_ORB_FROM) return false;
      return Math.random() < C.DROP.SUPER_ORB_CHANCE;
    },

    /**
     * 按当前掉落配置掷一次金色经验球。
     * 集中放在这里，方便测试直接验证"解锁时间"与"分档掉落率"。
     * @param {number} t 当前存活时间（秒）
     * @param {boolean} firstBossDown 第一只 Boss 是否已被击杀
     * @returns {boolean} 这次是否掉落
     */
    rollGold: function (t, firstBossDown) {
      var c = Pickups.goldChance(t, firstBossDown);
      if (c <= 0) return false;
      return Math.random() < c;
    },

    /** 金色经验球是否已解锁（UI 与测试用） */
    goldUnlocked: function (t) {
      return t >= C.DROP.GOLD_ORB_FROM;
    },

    /** 掉一颗红心 */
    spawnHeart: function (state, x, y) {
      state.hearts.push({
        x: x, y: y,
        radius: C.DROP.HEART_RADIUS,
        heal: C.DROP.HEART_HEAL,
        phase: Math.random() * U.TAU,
        life: 22
      });
    },

    update: function (state, dt, game) {
      var p = game.player;

      var baseR = p.pickupRadius;
      var baseR2 = baseR * baseR;
      var goldR = baseR * C.DROP.GOLD_MAGNET_MULT;
      var goldR2 = goldR * goldR;
      var superR = baseR * C.DROP.SUPER_MAGNET_MULT;
      var superR2 = superR * superR;

      /* ---- 经验球 ---- */
      var gems = state.gems;
      for (var i = gems.length - 1; i >= 0; i--) {
        var g = gems[i];

        g.phase += dt * 4;

        var dx = p.x - g.x;
        var dy = p.y - g.y;
        var d2 = dx * dx + dy * dy;

        /* 越稀有的球吸附范围越大，尽量别让玩家漏掉 */
        var range2 = g.super ? superR2 : (g.gold ? goldR2 : baseR2);

        /* 被吸走之后就一直飞向玩家，直到被吃掉 */
        if (g.magnet || d2 <= range2) {
          g.magnet = true;

          var d = Math.sqrt(d2) || 1;
          var acc = C.XP.GEM_MAGNET_ACC * (g.super ? 1.8 : (g.gold ? 1.35 : 1));

          g.vx += (dx / d) * acc * dt;
          g.vy += (dy / d) * acc * dt;

          /* 限速，避免高速下穿过玩家 */
          var sp = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
          var maxSp = 900;
          if (sp > maxSp) { g.vx = (g.vx / sp) * maxSp; g.vy = (g.vy / sp) * maxSp; }
        } else {
          /* 平衡（2026-09-23）：还没进入吸附范围时，200px 内的石头**慢慢往玩家飘**。
             玩家绝大多数时候是"边退边打"，不飘的话杀完就走的那些经验全留在原地 ——
             测量台实测 60 秒才 Lv1。加速度比吸附小一个数量级，所以手感还是"走过去捡"。 */
          var drift = C.XP.GEM_DRIFT_RADIUS || 0;
          if (drift > 0 && d2 <= drift * drift) {
            var dd = Math.sqrt(d2) || 1;
            var dacc = (C.XP.GEM_DRIFT_ACC || 200) * (g.gold ? 1.2 : 1);
            g.vx += (dx / dd) * dacc * dt;
            g.vy += (dy / dd) * dacc * dt;
          }
          var damp = Math.exp(-4 * dt);
          g.vx *= damp;
          g.vy *= damp;
        }

        g.x += g.vx * dt;
        g.y += g.vy * dt;

        /* 吃掉 */
        if (p.alive && U.circleHit(p.x, p.y, baseR * 0.28 + p.radius, g.x, g.y, g.radius)) {
          if (g.super) {
            /* 超级经验球：不加经验，直接升一级 */
            state.stats.superCollected++;
            VS.Audio.play('level');
            VS.Effects.text(game.fx, g.x, g.y, '等级 +1', '#ff9de2', { life: 1.3, size: 22 });
            VS.Effects.explosion(game.fx, g.x, g.y, 2.2);
            VS.Effects.burst(game.fx, g.x, g.y, '#ff9de2', 34, { speed: 260, life: 0.9, size: 4 });
            if (game.onInstantLevel) game.onInstantLevel();
          } else if (g.gold) {
            state.stats.goldCollected++;
            VS.Audio.play('level');
            VS.Effects.text(game.fx, g.x, g.y, '+' + g.value, '#ffd166', { life: 0.95, size: 19 });
            VS.Effects.burst(game.fx, g.x, g.y, '#ffd166', 16, { speed: 180, life: 0.5, size: 3 });
            state.stats.xpCollected += g.value;
            if (game.onXp) game.onXp(g.value);
          } else {
            VS.Audio.play('pickup');
            VS.Effects.text(game.fx, g.x, g.y, '+' + g.value, '#cfe8ff', { life: 0.5, size: 12 });
            state.stats.xpCollected += g.value;
            if (game.onXp) game.onXp(g.value);
          }

          U.swapRemove(gems, i);
        }
      }

      /* ---- 红心 ---- */
      var hearts = state.hearts;
      for (var j = hearts.length - 1; j >= 0; j--) {
        var h = hearts[j];

        h.phase += dt * 3;
        h.life -= dt;

        var hdx = p.x - h.x;
        var hdy = p.y - h.y;
        var hd2 = hdx * hdx + hdy * hdy;

        if (hd2 <= baseR2) {
          var hd = Math.sqrt(hd2) || 1;
          var pull = 620 * dt;
          h.x += (hdx / hd) * pull;
          h.y += (hdy / hd) * pull;
        }

        if (h.life <= 0) { U.swapRemove(hearts, j); continue; }

        if (p.alive && U.circleHit(p.x, p.y, p.radius, h.x, h.y, h.radius)) {
          var healed = VS.Player.heal(p, h.heal, game);
          VS.Effects.text(game.fx, h.x, h.y, '+' + Math.round(healed) + ' HP', '#7ee787', { life: 0.7, size: 13 });
          U.swapRemove(hearts, j);
        }
      }
    },

    /** 场上金色球数量（UI / 测试用） */
    goldCount: function (state) {
      var n = 0;
      for (var i = 0; i < state.gems.length; i++) {
        if (state.gems[i].gold && !state.gems[i].super) n++;
      }
      return n;
    },

    /** 场上超级经验球数量 */
    superCount: function (state) {
      var n = 0;
      for (var i = 0; i < state.gems.length; i++) {
        if (state.gems[i].super) n++;
      }
      return n;
    }
  };

  VS.register('Pickups', Pickups);

})(window.VS = window.VS || {});
