/* ===========================================================
   通用工具函数（纯函数，无副作用、不依赖 DOM）
   =========================================================== */
(function (VS) {
  'use strict';

  var TAU = Math.PI * 2;

  var Utils = {

    TAU: TAU,

    clamp: function (v, lo, hi) {
      return v < lo ? lo : (v > hi ? hi : v);
    },

    lerp: function (a, b, t) {
      return a + (b - a) * t;
    },

    /** 与帧率无关的指数平滑：t 为"每秒收敛速率" */
    damp: function (a, b, rate, dt) {
      return b + (a - b) * Math.exp(-rate * dt);
    },

    rand: function (min, max) {
      return min + Math.random() * (max - min);
    },

    randInt: function (min, max) {
      return Math.floor(min + Math.random() * (max - min + 1));
    },

    pick: function (arr) {
      return arr[(Math.random() * arr.length) | 0];
    },

    /** 原地 Fisher-Yates 洗牌 */
    shuffle: function (arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },

    dist2: function (ax, ay, bx, by) {
      var dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy;
    },

    dist: function (ax, ay, bx, by) {
      var dx = ax - bx, dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    },

    /** 圆与圆是否相交（用平方距离，避免开方） */
    circleHit: function (ax, ay, ar, bx, by, br) {
      var r = ar + br;
      var dx = ax - bx, dy = ay - by;
      return dx * dx + dy * dy <= r * r;
    },

    /** 把秒格式化为 MM:SS */
    formatTime: function (sec) {
      sec = Math.max(0, Math.floor(sec));
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
    },

    /** 按权重随机取一个下标；weights 为数字数组 */
    weightedIndex: function (weights) {
      var total = 0, i;
      for (i = 0; i < weights.length; i++) total += weights[i];
      if (total <= 0) return 0;
      var r = Math.random() * total;
      for (i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    },

    /** 从数组里不重复地取 n 个元素（返回新数组） */
    sampleN: function (arr, n) {
      var copy = arr.slice();
      Utils.shuffle(copy);
      return copy.slice(0, n);
    },

    /** 数组按 swap-remove 删除下标 i —— O(1)，顺序会被打乱（适合实体列表） */
    swapRemove: function (arr, i) {
      var last = arr.length - 1;
      if (i !== last) arr[i] = arr[last];
      arr.pop();
    },

    /** 用空格分位，例 12345 -> "12 345" */
    group: function (n) {
      return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    },

    /** 保留 n 位小数（避免浮点噪声显示成 0.30000000000000004） */
    fixed: function (v, n) {
      return Number(v.toFixed(n === undefined ? 1 : n));
    },

    /** 稳定的 2D 哈希，返回 [0,1)。用于按坐标决定装饰物摆放等 */
    hash2: function (x, y) {
      var n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return n - Math.floor(n);
    }
  };

  VS.register('Utils', Utils);

})(window.VS = window.VS || {});
