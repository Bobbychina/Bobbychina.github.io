/* ===========================================================
   特效：粒子 / 飘字 / 爆炸动画 / 火花动画
   全部设了硬上限并做了"每帧预算"，
   避免一次打死几十只怪时瞬间生成上千实体导致掉帧。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  /* 动画实体的数量上限（超出就丢弃最老的） */
  var MAX_BOOMS = 40;
  var MAX_SPARKS = 70;

  var Effects = {

    create: function () {
      return {
        particles: [],
        texts: [],
        booms: [],        // 死亡爆炸动画
        sparks: [],       // 命中火花动画
        budget: C.FX.MAX_PARTICLES_PER_FRAME
      };
    },

    /** 每帧开始时重置粒子生成预算 */
    beginFrame: function (state) {
      state.budget = C.FX.MAX_PARTICLES_PER_FRAME;
    },

    /**
     * 爆散粒子
     * @param {object} state
     * @param {number} x @param {number} y
     * @param {string} color
     * @param {number} count 想要的数量（会受预算与上限削减）
     * @param {object} [opt] { speed, life, size, spread, angle, drag }
     */
    burst: function (state, x, y, color, count, opt) {
      opt = opt || {};
      var speed = opt.speed !== undefined ? opt.speed : 130;
      var life = opt.life !== undefined ? opt.life : 0.45;
      var size = opt.size !== undefined ? opt.size : 2.6;
      var spread = opt.spread !== undefined ? opt.spread : U.TAU;
      var baseAngle = opt.angle !== undefined ? opt.angle : 0;
      var drag = opt.drag !== undefined ? opt.drag : 3.2;

      var n = Math.min(count, state.budget, C.FX.MAX_PARTICLES - state.particles.length);
      if (n <= 0) return;
      state.budget -= n;

      for (var i = 0; i < n; i++) {
        var a = baseAngle + (Math.random() - 0.5) * spread;
        var sp = speed * U.rand(0.35, 1.15);
        state.particles.push({
          x: x, y: y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: life * U.rand(0.6, 1.25),
          maxLife: life,
          size: size * U.rand(0.65, 1.35),
          color: color,
          drag: drag
        });
      }
    },

    /** 死亡时的"肉块"爆散：方向更散、速度更慢 */
    gib: function (state, x, y, color, count) {
      Effects.burst(state, x, y, color, count, {
        speed: 105, life: 0.55, size: 3.2, drag: 2.6
      });
    },

    /**
     * 爆炸动画（贴图序列帧）
     * @param {number} scale 相对 32px 原始尺寸的倍率
     */
    explosion: function (state, x, y, scale) {
      if (state.booms.length >= MAX_BOOMS) state.booms.shift();
      var life = 0.46;
      state.booms.push({
        x: x, y: y,
        life: life,
        maxLife: life,
        scale: scale || 1
      });
    },

    /** 命中火花动画 */
    spark: function (state, x, y) {
      if (state.sparks.length >= MAX_SPARKS) state.sparks.shift();
      var life = 0.18;
      state.sparks.push({
        x: x, y: y,
        life: life,
        maxLife: life
      });
    },

    /**
     * 飘字（伤害数字等）
     */
    text: function (state, x, y, str, color, opt) {
      if (state.texts.length >= C.FX.MAX_TEXTS) {
        state.texts.shift();
      }
      opt = opt || {};
      var crit = !!opt.crit;
      var life = opt.life !== undefined ? opt.life : (crit ? 0.85 : 0.62);

      state.texts.push({
        x: x + U.rand(-6, 6),
        y: y - 6,
        vx: U.rand(-14, 14),
        vy: -52,
        life: life,
        maxLife: life,
        str: str,
        color: color || '#ffffff',
        size: opt.size !== undefined ? opt.size : (crit ? 17 : 13),
        crit: crit
      });
    },

    update: function (state, dt) {
      var list = state.particles;
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        p.life -= dt;
        if (p.life <= 0) { U.swapRemove(list, i); continue; }

        var d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy *= d;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      var texts = state.texts;
      for (var j = texts.length - 1; j >= 0; j--) {
        var t = texts[j];
        t.life -= dt;
        if (t.life <= 0) { U.swapRemove(texts, j); continue; }
        t.vy += 96 * dt;          // 轻微重力
        t.x += t.vx * dt;
        t.y += t.vy * dt;
      }

      var booms = state.booms;
      for (var k = booms.length - 1; k >= 0; k--) {
        booms[k].life -= dt;
        if (booms[k].life <= 0) U.swapRemove(booms, k);
      }

      var sparks = state.sparks;
      for (var m = sparks.length - 1; m >= 0; m--) {
        sparks[m].life -= dt;
        if (sparks[m].life <= 0) U.swapRemove(sparks, m);
      }
    },

    clear: function (state) {
      state.particles.length = 0;
      state.texts.length = 0;
      state.booms.length = 0;
      state.sparks.length = 0;
    },

    /** 调试/UI 用：当前特效实体总数 */
    count: function (state) {
      return state.particles.length + state.texts.length +
             state.booms.length + state.sparks.length;
    }
  };

  VS.register('Effects', Effects);

})(window.VS = window.VS || {});
