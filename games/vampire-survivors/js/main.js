/* ===========================================================
   启动入口：接线（renderer / hud / panels / input / audio / save）
   并跑主循环（requestAnimationFrame + 固定步长累加器）
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;

  var booted = false;

  function setBootMessage(text, isError) {
    var b = document.getElementById('boot');
    if (!b) return;
    b.hidden = false;
    b.textContent = text;
    if (isError) {
      b.style.background = '#3b1418';
      b.style.borderColor = '#6b2229';
      b.style.color = '#ffb4b4';
      b.style.whiteSpace = 'normal';
    }
  }

  function fatal(err) {
    var msg = err && err.message ? err.message : String(err);
    setBootMessage('启动失败：' + msg, true);
    if (window.console && console.error) console.error(err);
  }

  /* 启动后若仍有未捕获异常，也暴露出来，而不是静默卡住 */
  window.addEventListener('error', function (e) {
    if (!booted) fatal(e.error || new Error(e.message || '未知错误'));
  });

  function boot() {
    var canvas = document.getElementById('game');
    if (!canvas) throw new Error('找不到 <canvas id="game">');

    /* ---- 存档 ---- */
    var data = VS.Save.load();

    /* ---- 渲染器 ---- */
    var renderer = VS.Renderer.create(canvas);
    if (!renderer.ctx) throw new Error('无法获取 canvas 2d 上下文');
    VS.Renderer.resize(renderer);

    /* ---- 像素图集（base64 内嵌，异步解码） ---- */
    var assetsOn = VS.Assets.init();

    /* ---- 音频 ---- */
    VS.Audio.setMuted(!!data.muted);

    /* ---- 创建游戏 ---- */
    var game = VS.Game.create({
      renderer: renderer,
      data: data,
      input: VS.Input,
      audio: VS.Audio
    });
    VS.Game.current = game;

    /* ---- 静音开关 ---- */
    function toggleMute() {
      var m = VS.Audio.toggleMute();
      VS.Hud.setMuted(m);
      VS.Save.setMuted(game.data, m);
    }

    /* ---- HUD ---- */
    var hud = VS.Hud.init({
      onMute: toggleMute,
      onPause: function () { VS.Game.togglePause(game); }
    });
    VS.Hud.setMuted(VS.Audio.isMuted());
    game.deps.hud = hud;

    /* ---- 面板 ---- */
    var panels = VS.Panels.init({
      onStart: function () { VS.Game.start(game); },
      onRetry: function () { VS.Game.start(game); },
      onResume: function () { VS.Game.resume(game); },
      onRestart: function () { VS.Game.start(game); },
      onChoose: function (index) { VS.Game.choose(game, index); }
    });
    game.deps.panels = panels;

    /* ---- 输入 ---- */
    VS.Input.init({
      surface: canvas,
      onPause: function () { VS.Game.togglePause(game); },
      onMute: toggleMute,
      onChoice: function (index) { VS.Game.choose(game, index); },
      onDash: function () { VS.Player.dash(game.player, VS.Input.axis(), game); },
      onConfirm: function () {
        if (!assetsReady) return;
        if (game.state === VS.Game.STATE.MENU || game.state === VS.Game.STATE.GAMEOVER) {
          VS.Game.start(game);
        } else if (game.state === VS.Game.STATE.PAUSED) {
          VS.Game.resume(game);
        }
      },
      onTouchStart: function () { VS.Audio.unlock(); }
    });

    /* ---- 首次交互解锁音频（浏览器自动播放策略） ---- */
    function unlockOnce() {
      VS.Audio.unlock();
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
      window.removeEventListener('touchstart', unlockOnce);
    }
    window.addEventListener('pointerdown', unlockOnce);
    window.addEventListener('keydown', unlockOnce);
    window.addEventListener('touchstart', unlockOnce);

    /* ---- 切走标签页自动暂停 ---- */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) VS.Game.pause(game);
    });

    /* ---- 窗口尺寸变化 ---- */
    window.addEventListener('resize', function () {
      VS.Renderer.resize(renderer);
    });

    /* ---- 起始画面 ---- */
    VS.Hud.hide();
    VS.Panels.showStart(data.bestTime);
    VS.Game.snapCamera(game);

    /* ---- 等图集解码完再允许开局，避免第一帧用降级图形 ---- */
    var assetsReady = false;
    var startBtn = document.getElementById('startBtn');

    function pollAssets() {
      if (assetsReady) return;

      if (!assetsOn || !VS.Assets.supported() || VS.Assets.allReady()) {
        assetsReady = true;
        if (startBtn) {
          startBtn.disabled = false;
          startBtn.textContent = '开始游戏';
        }
        return;
      }

      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = '资源加载中 ' + Math.round(VS.Assets.progress() * 100) + '%';
      }
      window.setTimeout(pollAssets, 50);
    }
    pollAssets();

    /* ---- 主循环 ---- */
    var STEP = 1 / 60;
    var last = 0;
    var acc = 0;
    var renderTick = 0;

    function frame(ts) {
      var now = ts / 1000;
      if (!last) last = now;

      var dt = now - last;
      last = now;

      if (dt > 0.25) dt = 0.25;   // 切标签页回来时别一次补算一大堆
      if (dt < 0) dt = 0;

      game.animTime += dt;
      acc += dt;

      var steps = 0;
      while (acc >= STEP && steps < C.LOOP.MAX_SUBSTEPS) {
        VS.Game.step(game, STEP);
        acc -= STEP;
        steps++;
      }
      if (steps >= C.LOOP.MAX_SUBSTEPS) acc = 0;   // 追不上就丢掉欠账

      /* 非游戏进行中时，也让已经生成的粒子自然消散 */
      if (game.state !== VS.Game.STATE.PLAYING) {
        VS.Effects.update(game.fx, Math.min(dt, 0.05));
        if (game.state === VS.Game.STATE.GAMEOVER && game.shake > 0) {
          game.shake = Math.max(0, game.shake - dt * 26);
        }
      }

      /* 面板/菜单打开时玩法已经暂停，画面基本是静止的：每帧重绘整屏纯属浪费
         （实测面板态 60fps 重绘 = 32fps，降到 1/3 后回 60）。粒子仍在按 dt 走，只是画得疏一点。 */
      renderTick++;
      if (game.state === VS.Game.STATE.PLAYING || renderTick % 3 === 0) {
        VS.Renderer.render(renderer, game, game.animTime, dt);
      }

      if (game.state === VS.Game.STATE.PLAYING || game.state === VS.Game.STATE.LEVELUP) {
        VS.Hud.update(game);
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    /* ---- 启动完成 ---- */
    booted = true;
    var bootEl = document.getElementById('boot');
    if (bootEl) bootEl.hidden = true;
  }

  function start() {
    try {
      if (!VS.Config || !VS.Game || !VS.Renderer || !VS.Panels) {
        throw new Error('模块没有全部加载（检查 js 文件路径与加载顺序）');
      }
      boot();
    } catch (err) {
      fatal(err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})(window.VS = window.VS || {});
