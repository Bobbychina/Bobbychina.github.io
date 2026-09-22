/* ===========================================================
   拾取物：经验石 与 红心
   经验石会被玩家的拾取范围吸过来；数量设了上限，
   超过上限时不再新建实体，而是把经验并进已有宝石，避免实体爆炸。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  var MAX_GEMS = 420;

  var Pickups = {

    create: function () {
      return {
        gems: [],
        hearts: []
      };
    },

    reset: function (state) {
      state.gems.length = 0;
      state.hearts.length = 0;
    },

    /** 掉一颗经验石；数量到上限时并入随机一颗已有宝石 */
    spawnXp: function (state, x, y, value) {
      if (state.gems.length >= MAX_GEMS) {
        var g = state.gems[(Math.random() * state.gems.length) | 0];
        if (g) g.value += value;
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
        phase: Math.random() * U.TAU,
        tier: value >= 20 ? 3 : (value >= 5 ? 2 : 1)
      });
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
      var pr2 = p.pickupRadius * p.pickupRadius;

      /* ---- 经验石 ---- */
      var gems = state.gems;
      for (var i = gems.length - 1; i >= 0; i--) {
        var g = gems[i];

        g.phase += dt * 4;

        var dx = p.x - g.x;
        var dy = p.y - g.y;
        var d2 = dx * dx + dy * dy;

        /* 被吸走之后就一直飞向玩家，直到被吃掉 */
        if (g.magnet || d2 <= pr2) {
          g.magnet = true;

          var d = Math.sqrt(d2) || 1;
          var acc = C.XP.GEM_MAGNET_ACC;

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
        if (p.alive && U.circleHit(p.x, p.y, p.pickupRadius * 0.28 + p.radius, g.x, g.y, g.radius)) {
          VS.Audio.play('pickup');
          VS.Effects.text(game.fx, g.x, g.y, '+' + g.value, '#7ee0ff', { life: 0.5, size: 12 });
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

        if (hd2 <= pr2) {
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
    }
  };

  VS.register('Pickups', Pickups);

})(window.VS = window.VS || {});
