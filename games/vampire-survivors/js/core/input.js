/* ===========================================================
   输入：WASD / 方向键移动，Esc 暂停，M 静音，1/2/3 选卡
   另外提供触摸虚拟摇杆（手机端在画面上拖动）
   =========================================================== */
(function (VS) {
  'use strict';

  var keys = Object.create(null);   // code/key -> true
  var joystick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  var axis = { x: 0, y: 0 };
  var handlers = {};
  var bound = false;
  var surface = null;

  var UP = ['w', 'W', 'ArrowUp'];
  var DOWN = ['s', 'S', 'ArrowDown'];
  var LEFT = ['a', 'A', 'ArrowLeft'];
  var RIGHT = ['d', 'D', 'ArrowRight'];

  var JOY_RADIUS = 62;   // 触摸摇杆满量程半径（像素）

  function anyDown(list) {
    for (var i = 0; i < list.length; i++) {
      if (keys[list[i]]) return true;
    }
    return false;
  }

  function recomputeAxis() {
    var x = 0, y = 0;

    if (anyDown(RIGHT)) x += 1;
    if (anyDown(LEFT)) x -= 1;
    if (anyDown(DOWN)) y += 1;
    if (anyDown(UP)) y -= 1;

    // 键盘取值：归一化，保证斜向不会更快
    var len = Math.sqrt(x * x + y * y);
    if (len > 1) { x /= len; y /= len; }

    // 触摸摇杆（若在拖动则以它为准）
    if (joystick.active) {
      x = joystick.x;
      y = joystick.y;
    }

    axis.x = x;
    axis.y = y;
  }

  function onKeyDown(e) {
    var k = e.key || e.code;
    if (!k) return;

    // 记录按键（含方向键与字母）
    keys[k] = true;
    if (e.code) keys[e.code] = true;

    var isMove = UP.indexOf(k) >= 0 || DOWN.indexOf(k) >= 0 ||
                 LEFT.indexOf(k) >= 0 || RIGHT.indexOf(k) >= 0;

    if (isMove) {
      if (e.preventDefault) e.preventDefault();
      recomputeAxis();
      return;
    }

    if (k === 'Escape' || k === 'p' || k === 'P') {
      if (handlers.onPause) handlers.onPause();
      return;
    }
    if (k === 'm' || k === 'M') {
      if (handlers.onMute) handlers.onMute();
      return;
    }
    if (k === '1' || k === '2' || k === '3') {
      if (handlers.onChoice) handlers.onChoice(parseInt(k, 10) - 1);
      return;
    }
    if (k === ' ' || k === 'Enter' || k === 'Spacebar') {
      if (handlers.onConfirm) handlers.onConfirm();
      return;
    }
    // 任何其它按键都通知一次，用于"任意键开始"
    if (handlers.onAnyKey) handlers.onAnyKey();
  }

  function onKeyUp(e) {
    var k = e.key || e.code;
    if (!k) return;
    keys[k] = false;
    if (e.code) keys[e.code] = false;
    recomputeAxis();
  }

  /* ---------------- 触摸摇杆 ---------------- */

  function findTouch(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  function touchStart(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (joystick.active && joystick.id !== null) break;
      joystick.active = true;
      joystick.id = t.identifier;
      joystick.ox = t.clientX;
      joystick.oy = t.clientY;
      joystick.x = 0;
      joystick.y = 0;
      if (handlers.onTouchStart) handlers.onTouchStart();
      break;
    }
    if (e.preventDefault) e.preventDefault();
    recomputeAxis();
  }

  function touchMove(e) {
    if (!joystick.active || joystick.id === null) return;
    var t = findTouch(e.changedTouches, joystick.id);
    if (!t) return;

    var dx = t.clientX - joystick.ox;
    var dy = t.clientY - joystick.oy;
    var len = Math.sqrt(dx * dx + dy * dy);

    if (len > JOY_RADIUS) {
      // 超出量程：把原点跟着拖，手感更接近摇杆
      var k = (len - JOY_RADIUS) / len;
      joystick.ox += dx * k;
      joystick.oy += dy * k;
      dx = t.clientX - joystick.ox;
      dy = t.clientY - joystick.oy;
      len = JOY_RADIUS;
    }

    var mag = len / JOY_RADIUS;
    if (len > 0.0001) {
      joystick.x = (dx / len) * mag;
      joystick.y = (dy / len) * mag;
    } else {
      joystick.x = 0;
      joystick.y = 0;
    }

    if (e.preventDefault) e.preventDefault();
    recomputeAxis();
  }

  function touchEnd(e) {
    if (!joystick.active || joystick.id === null) return;
    var t = findTouch(e.changedTouches, joystick.id);
    if (!t && e.changedTouches.length) t = e.changedTouches[0];
    if (!t) return;

    joystick.active = false;
    joystick.id = null;
    joystick.x = 0;
    joystick.y = 0;
    recomputeAxis();
  }

  var Input = {

    /** 供渲染模块画摇杆指示用 */
    joystick: joystick,

    init: function (opts) {
      opts = opts || {};
      handlers = {
        onPause: opts.onPause,
        onMute: opts.onMute,
        onChoice: opts.onChoice,
        onConfirm: opts.onConfirm,
        onAnyKey: opts.onAnyKey,
        onTouchStart: opts.onTouchStart
      };
      surface = opts.surface || null;

      if (bound) return;
      bound = true;

      try {
        window.addEventListener('keydown', onKeyDown, false);
        window.addEventListener('keyup', onKeyUp, false);
        // 失焦时清空按键，避免"切出去再回来一直往一个方向走"
        window.addEventListener('blur', function () {
          keys = Object.create(null);
          joystick.active = false;
          joystick.x = 0;
          joystick.y = 0;
          recomputeAxis();
        });
      } catch (e) {}

      if (surface && surface.addEventListener) {
        surface.addEventListener('touchstart', touchStart, { passive: false });
        surface.addEventListener('touchmove', touchMove, { passive: false });
        surface.addEventListener('touchend', touchEnd, { passive: false });
        surface.addEventListener('touchcancel', touchEnd, { passive: false });
      }
    },

    /** 归一化后的移动轴，长度 ∈ [0,1] */
    getAxis: function () {
      return axis;
    },

    /** 是否按住了某个键（调试/扩展用） */
    isDown: function (k) { return !!keys[k]; },

    /** 直接设置轴（脚本/测试用） */
    setAxis: function (x, y) {
      joystick.active = false;
      axis.x = x;
      axis.y = y;
    },

    reset: function () {
      keys = Object.create(null);
      joystick.active = false;
      joystick.id = null;
      joystick.x = 0;
      joystick.y = 0;
      axis.x = 0;
      axis.y = 0;
    }
  };

  VS.register('Input', Input);

})(window.VS = window.VS || {});
