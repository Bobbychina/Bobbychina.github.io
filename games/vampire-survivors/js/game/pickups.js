/* ===========================================================
   拾取物：经验球（普通 / 金色）与红心
   -----------------------------------------------------------
   普通经验球：经验量 = 怪物自身的 xp 值，蓝→绿→金按大小分档
   金色经验球：经验量 = 普通球的 100 倍，10% 概率掉落，
               球体更大、吸附范围更广，用来解决 4 分钟后升级慢的问题

   数量设了上限：到上限时不再新建实体，而是把经验并进已有球体，
   避免怪物密集时实体数量失控。
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
        stats: { normalSpawned: 0, goldSpawned: 0, xpCollected: 0, goldCollected: 0 }
      };
    },

    reset: function (state) {
      state.gems.length = 0;
      state.hearts.length = 0;
      state.stats.normalSpawned = 0;
      state.stats.goldSpawned = 0;
      state.stats.xpCollected = 0;
      state.stats.goldCollected = 0;
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
        phase: Math.random() * U.TAU,
        tier: 4
      });
    },

    /**
     * 按当前掉落配置掷一次金色经验球。
     * 集中放在这里，方便测试直接验证掉落率。
     * @returns {boolean} 这次是否掉落
     */
    rollGold: function () {
      return Math.random() < C.DROP.GOLD_ORB_CHANCE;
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

      /* ---- 经验球 ---- */
      var gems = state.gems;
      for (var i = gems.length - 1; i >= 0; i--) {
        var g = gems[i];

        g.phase += dt * 4;

        var dx = p.x - g.x;
        var dy = p.y - g.y;
        var d2 = dx * dx + dy * dy;

        /* 金色球的吸附范围更大，尽量别让玩家漏掉 */
        var range2 = g.gold ? goldR2 : baseR2;

        /* 被吸走之后就一直飞向玩家，直到被吃掉 */
        if (g.magnet || d2 <= range2) {
          g.magnet = true;

          var d = Math.sqrt(d2) || 1;
          var acc = C.XP.GEM_MAGNET_ACC * (g.gold ? 1.35 : 1);

          g.vx += (dx / d) * acc * dt;
          g.vy += (dy / d) * acc * dt;

          /* 限速，避免高速下穿过玩家 */
          var sp = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
          var maxSp = 900;
          if (sp > maxSp) { g.vx = (g.vx / sp) * maxSp; g.vy = (g.vy / sp) * maxSp; }
        } else {
          var damp = Math.exp(-4 * dt);
          g.vx *= damp;
          g.vy *= damp;
        }

        g.x += g.vx * dt;
        g.y += g.vy * dt;

        /* 吃掉 */
        if (p.alive && U.circleHit(p.x, p.y, baseR * 0.28 + p.radius, g.x, g.y, g.radius)) {
          if (g.gold) {
            state.stats.goldCollected++;
            VS.Audio.play('level');
            VS.Effects.text(game.fx, g.x, g.y, '+' + g.value, '#ffd166', { life: 0.95, size: 19 });
            VS.Effects.burst(game.fx, g.x, g.y, '#ffd166', 16, { speed: 180, life: 0.5, size: 3 });
          } else {
            VS.Audio.play('pickup');
            VS.Effects.text(game.fx, g.x, g.y, '+' + g.value, '#cfe8ff', { life: 0.5, size: 12 });
          }

          state.stats.xpCollected += g.value;
          if (game.onXp) game.onXp(g.value);
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
        if (state.gems[i].gold) n++;
      }
      return n;
    }
  };

  VS.register('Pickups', Pickups);

})(window.VS = window.VS || {});
