/* ===========================================================
   渲染层
   -----------------------------------------------------------
   全部角色/怪物/特效都画 base64 内嵌的像素精灵图，
   不再使用简单的圆形几何图形。

   关于像素锐利：所有精灵都按整数倍放大，并关闭 imageSmoothing，
   坐标用 Math.round 对齐，避免出现半像素模糊。

   降级策略：若资源尚未解码完成（data URI 是异步的）或环境不支持
   Image（无头测试），自动退回简单色块绘制，保证画面不空白、
   逻辑测试也不受影响。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  var FONT = 'Segoe UI, Microsoft YaHei, sans-serif';

  /* 各类实体的精灵放大倍数（原始 16/24px -> 屏幕像素） */
  var ENEMY_SCALE = {
    bat: 2, zombie: 2, skeleton: 2, ghost: 2, wraith: 2,
    brute: 3, elite: 4,
    boss: 4            // 24px 原始 -> 96px，配合 radius 44 的碰撞圆
  };
  var PLAYER_SCALE = 2;
  var BOLT_SCALE = 2.2;
  var GEM_SCALE = 2;
  var GOLD_ORB_SCALE = 2.3;
  var HEART_SCALE = 2.2;
  var DECO_SCALE = 2;
  var DECO_CELL = 108;       // 装饰物按这个网格撒点

  /* ---------------- 精灵绘制小工具 ---------------- */

  function A() { return VS.Assets; }

  function imgReady(name) {
    var a = VS.Assets;
    return a && a.ready(name);
  }

  /**
   * 把精灵按中心点绘制
   * @returns {boolean} 是否真的画出来了（false 表示调用方该退回简单图形）
   */
  function blit(ctx, name, x, y, scale, opt) {
    if (!name) return false;
    var a = VS.Assets;
    var img = a.img(name);
    if (!a.isReady(img)) return false;

    opt = opt || {};
    var w = Math.round(img.naturalWidth * scale);
    var h = Math.round(img.naturalHeight * scale);
    var dx = Math.round(x - w / 2);
    var dy = Math.round(y - h / 2 + (opt.dy || 0));

    var needRestore = false;
    if (opt.alpha !== undefined && opt.alpha < 1) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, opt.alpha);
      needRestore = true;
    }

    if (opt.flipX) {
      if (!needRestore) { ctx.save(); needRestore = true; }
      ctx.translate(dx + w / 2, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, dy, w, h);
    } else if (opt.angle) {
      if (!needRestore) { ctx.save(); needRestore = true; }
      ctx.translate(Math.round(x), Math.round(y + (opt.dy || 0)));
      ctx.rotate(opt.angle);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.drawImage(img, dx, dy, w, h);
    }

    if (needRestore) ctx.restore();
    return true;
  }

  /** 受击闪光：叠一层纯白剪影 */
  function blitWhite(ctx, name, x, y, scale, alpha, dy) {
    if (!name) return false;
    var a = VS.Assets;
    var c = a.white(name);
    if (!c) return false;

    var w = Math.round(c.width * scale);
    var h = Math.round(c.height * scale);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(c, Math.round(x - w / 2), Math.round(y - h / 2 + (dy || 0)), w, h);
    ctx.restore();
    return true;
  }

  /** 从动画组里取当前帧 */
  function animFrame(group, t, fps, offset) {
    var list = VS.SpriteGroups[group];
    if (!list || !list.length) return null;
    var phase = (t + (offset || 0)) * fps;
    var i = Math.floor(phase) % list.length;
    if (i < 0) i += list.length;
    return { name: list[i], index: i };
  }

  /* ---------------- 简单图形降级 ---------------- */

  function fallbackCircle(ctx, x, y, r, fill, edge) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, U.TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  /* ===========================================================
     主体
     =========================================================== */

  /* ---------------- 渲染缩放（性能闸门） ----------------
     宽屏 + 2 倍缩放下画面后备尺寸是 4 倍像素，而每帧至少两次全屏填充（地面 + 暗角）；
     JS 自身只占 ~2% 时间，剩下全是这堆像素的光栅化：实测 2880x1800 时 p50 = 33ms（31fps），
     压到 1 倍（1440x900）立刻回 60fps。像素画只需要整数档，非整数缩放会让像素粗细不匀。 */
  var PX_BUDGET = 2.3e6;      // ≈1920x1200 像素量，再往上堆分辨率换不到观感
  var DPR_LADDER = [2, 1];

  function pickRenderScale(cssW, cssH) {
    var want = Math.min(window.devicePixelRatio || 1, 2);
    for (var i = 0; i < DPR_LADDER.length; i++) {
      var d = DPR_LADDER[i];
      if (d <= want && cssW * cssH * d * d <= PX_BUDGET) return d;
    }
    return 1;                 // 兜底：至少保证 1 倍（不会比 CSS 像素更糊）
  }

  var Renderer = {

    create: function (canvas) {
      var r = {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        dpr: 1,
        w: 0,
        h: 0,
        vw: 0,            // 上次同步的窗口尺寸（用来判断要不要重新量画布）
        vh: 0,
        needResize: true,
        groundPattern: null,
        groundPatternFor: null,
        walkPhase: 0,
        dt: 1 / 60,
        vignette: null,   // 预渲染的暗角/危险红屏（静态图，每帧只贴一次）
        vigW: 0,
        vigH: 0
      };
      /* 尺寸变化靠事件置脏，别在每帧里读 clientWidth（那会强制同步排版） */
      var mark = function () { r.needResize = true; };
      window.addEventListener('resize', mark);
      window.addEventListener('orientationchange', mark);
      /* 画布 CSS 尺寸也可能被样式改（如站点 BETA 条撑高 --beta-h）：ResizeObserver 兜住这种情况 */
      if (window.ResizeObserver) {
        try { new ResizeObserver(mark).observe(canvas); } catch (e) { /* 老浏览器就算了 */ }
      }
      return r;
    },

    /** 尺寸自适应（含 devicePixelRatio） */
    resize: function (r, force) {
      var canvas = r.canvas;

      /* 尺寸没变的绝大多数帧里只比一次窗口尺寸（读 innerWidth 不会触发排版），
         省掉每帧读 clientWidth 带来的强制同步排版 —— HUD 每帧改 DOM，这一读就是全页重排 */
      var vw = window.innerWidth || 1280;
      var vh = window.innerHeight || 720;
      if (!force && !r.needResize && vw === r.vw && vh === r.vh) return r;
      r.needResize = false;
      r.vw = vw;
      r.vh = vh;

      var cssW = canvas.clientWidth || vw;
      var cssH = canvas.clientHeight || vh;

      var dpr = pickRenderScale(cssW, cssH);

      var pw = Math.max(1, Math.floor(cssW * dpr));
      var ph = Math.max(1, Math.floor(cssH * dpr));

      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }

      r.dpr = dpr;
      r.w = cssW;
      r.h = cssH;
      return r;
    },

    /* ---------------- 每帧入口 ---------------- */

    render: function (r, game, time, dt) {
      var ctx = r.ctx;
      if (!ctx) return;

      Renderer.resize(r);

      r.dt = dt || (1 / 60);

      var cam = game.world.camera;
      var dpr = r.dpr;

      /* 屏幕震动 */
      var shake = game.shake || 0;
      var sx = 0, sy = 0;
      if (shake > 0.01) {
        sx = (Math.random() - 0.5) * shake * 2;
        sy = (Math.random() - 0.5) * shake * 2;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, r.w, r.h);

      /* --- 1. 地面贴图（屏幕空间平铺，纹理锚定世界坐标） --- */
      Renderer.drawGround(ctx, r, game, cam.x - sx, cam.y - sy);

      /* --- 2. 世界空间实体 --- */
      ctx.save();
      ctx.translate(Math.round(-cam.x + sx), Math.round(-cam.y + sy));

      var view = VS.World.viewRect(game.world, 120);

      Renderer.drawDecorations(ctx, game, view);
      Renderer.drawPickups(ctx, r, game, view, time);
      Renderer.drawAura(ctx, game, time);
      Renderer.drawNovas(ctx, game, time);
      Renderer.drawEnemies(ctx, game, view, time);
      Renderer.drawPlayer(ctx, r, game);
      Renderer.drawOrbit(ctx, game, time);
      Renderer.drawProjectiles(ctx, game, view, time);
      Renderer.drawParticles(ctx, game, view);
      Renderer.drawSparks(ctx, game, view);
      Renderer.drawBooms(ctx, game, view);
      Renderer.drawTexts(ctx, game, view);

      ctx.restore();

      /* --- 3. 屏幕层 --- */
      Renderer.drawWorldEdge(ctx, r, game, cam);
      Renderer.drawScreenFx(ctx, r, game, time);
      Renderer.drawJoystick(ctx, r);
    },

    /* ---------------- 地面 ---------------- */

    ensureGroundPattern: function (r) {
      var img = VS.Assets.img('ground');
      if (!VS.Assets.isReady(img)) return null;
      if (r.groundPattern && r.groundPatternFor === img) return r.groundPattern;

      try {
        r.groundPattern = r.ctx.createPattern(img, 'repeat');
        r.groundPatternFor = img;
      } catch (e) {
        r.groundPattern = null;
      }
      return r.groundPattern;
    },

    /**
     * 地面：先把整屏涂成"地图外"的深色，再只在世界矩形内铺贴图。
     * 贴图原点按相机位置取模，保证纹理固定在世界坐标上（不随镜头滑动）。
     */
    /* 【量过但没采纳，别再试一遍】把下面这段改成"预渲染成 (屏 + 一格) 的离屏图 + 每帧一次 blit"：
       怪铺满时实测 31.6 → 33.7fps（第三次对照 30.6，收益是真的但只有 ~2fps），代价是一块约 5MB 的离屏画布。
       结论：不值 —— 瓶颈是"每帧光栅化的像素总量 + 整屏合成"，不是这一处的填充方式。 */
    drawGround: function (ctx, r, game, camX, camY) {
      var world = game.world;

      /* 世界矩形换算到屏幕坐标后与屏幕求交 */
      var x0 = Math.max(0, -camX);
      var y0 = Math.max(0, -camY);
      var x1 = Math.min(r.w, world.w - camX);
      var y1 = Math.min(r.h, world.h - camY);

      /* 贴图铺满整屏时不必先刷一遍底色（少一次全屏填充）；只在露出地图外的地方补底色 */
      var covers = x0 <= 0 && y0 <= 0 && x1 >= r.w && y1 >= r.h;
      if (!covers) {
        ctx.fillStyle = '#05070a';
        ctx.fillRect(0, 0, r.w, r.h);
      }
      if (x1 <= x0 || y1 <= y0) return;

      var pat = Renderer.ensureGroundPattern(r);
      if (!pat) {
        ctx.fillStyle = '#101720';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        return;
      }

      var img = VS.Assets.img('ground');
      var TS = img.naturalWidth || 64;

      var ox = -(((camX % TS) + TS) % TS);
      var oy = -(((camY % TS) + TS) % TS);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.translate(ox, oy);
      ctx.fillStyle = pat;
      ctx.fillRect(x0 - ox, y0 - oy, x1 - x0, y1 - y0);
      ctx.restore();
    },

    /**
     * 金色经验球的脉动光晕。
     * 与暗角同样的思路：静态渐变只画一次成小图，之后每帧只贴图 ——
     * 而不是每个金球每帧都新建一次 radialGradient。
     */
    ensureGoldGlow: function (r) {
      if (r.goldGlow) return r.goldGlow;

      var S = 64;
      var c = document.createElement('canvas');
      c.width = S;
      c.height = S;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(S / 2, S / 2, 1, S / 2, S / 2, S / 2);
      grad.addColorStop(0, 'rgba(255, 224, 130, 0.55)');
      grad.addColorStop(0.55, 'rgba(255, 205, 80, 0.22)');
      grad.addColorStop(1, 'rgba(255, 190, 60, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);

      r.goldGlow = c;
      return c;
    },

    /**
     * 暗角 / 低血红屏都是**静态**的：预渲染成 1/4 尺寸小图，每帧只贴一次。
     * 原来是每帧新建全屏 radialGradient 再铺满整屏 —— 2 倍缩放下等于每帧 5M 像素的渐变光栅化。
     */
    ensureVignette: function (r) {
      var w = Math.max(2, Math.round(r.w / 4));
      var h = Math.max(2, Math.round(r.h / 4));
      if (r.vignetteDark && r.vigW === w && r.vigH === h) return;

      var make = function (edge) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var g = c.getContext('2d');
        var grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42,
                                          w / 2, h / 2, Math.max(w, h) * 0.72);
        grad.addColorStop(0, 'rgba(' + edge + ',0)');
        grad.addColorStop(1, 'rgba(' + edge + ',1)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
        return c;
      };

      r.vignetteDark = make('0,0,0');
      r.vignetteDanger = make('255,0,0');
      r.vigW = w;
      r.vigH = h;
    },

    /** 地图边界（发光紫线） */
    drawWorldEdge: function (ctx, r, game, cam) {
      var world = game.world;
      var p = world.pad;

      var x0 = p - cam.x;
      var y0 = p - cam.y;
      var w = world.w - p * 2;
      var h = world.h - p * 2;

      ctx.save();
      ctx.strokeStyle = 'rgba(180,120,255,.55)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0, y0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 4, y0 + 4, w - 8, h - 8);
      ctx.restore();
    },

    /* ---------------- 场景装饰 ---------------- */

    drawDecorations: function (ctx, game, view) {
      var names = VS.SpriteGroups.deco;
      if (!names || !names.length) return;

      var world = game.world;
      var cell = DECO_CELL;

      var cx0 = Math.floor(view.x0 / cell) - 1;
      var cx1 = Math.floor(view.x1 / cell) + 1;
      var cy0 = Math.floor(view.y0 / cell) - 1;
      var cy1 = Math.floor(view.y1 / cell) + 1;

      for (var cy = cy0; cy <= cy1; cy++) {
        for (var cx = cx0; cx <= cx1; cx++) {
          // 约 65% 的格子有装饰，其余留空
          if (U.hash2(cx * 1.7 + 0.5, cy * 2.3 + 0.9) > 0.65) continue;

          var pick = U.hash2(cx + 91.3, cy - 57.1);
          var name = names[Math.floor(pick * names.length) % names.length];

          var px = cx * cell + U.hash2(cx + 13.7, cy + 29.1) * (cell - 28) + 14;
          var py = cy * cell + U.hash2(cx - 7.3, cy + 41.9) * (cell - 28) + 14;

          if (px < 8 || py < 8 || px > world.w - 8 || py > world.h - 8) continue;

          blit(ctx, name, px, py, DECO_SCALE, { alpha: 0.85 });
        }
      }
    },

    /* ---------------- 拾取物 ---------------- */

    drawPickups: function (ctx, r, game, view, time) {
      var gems = game.pickups.gems;
      var glow = null;

      for (var i = 0; i < gems.length; i++) {
        var g = gems[i];
        if (!VS.World.isVisible(view, g.x, g.y, 20)) continue;

        if (g.gold) {
          /* 金色经验球：更大、会浮动、带一圈脉动光晕，一眼就能认出 */
          var gb = Math.sin(g.phase * 1.6) * 2.4;
          var pulse = 0.55 + 0.45 * Math.sin(g.phase * 2.2);

          if (!glow) glow = Renderer.ensureGoldGlow(r);
          if (glow) {
            var gr = (16 + pulse * 6) * 2;
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.drawImage(glow, g.x - gr / 2, g.y - gr / 2 + gb, gr, gr);
            ctx.restore();
          }

          if (!blit(ctx, 'orb_gold', g.x, g.y, GOLD_ORB_SCALE, { dy: gb })) {
            fallbackCircle(ctx, g.x, g.y, g.radius, '#ffc93c');
          }
        } else {
          var bob = Math.sin(g.phase) * 1.5;
          var name = g.tier >= 3 ? 'gem_2' : (g.tier === 2 ? 'gem_1' : 'gem_0');
          if (!blit(ctx, name, g.x, g.y, GEM_SCALE, { dy: bob })) {
            fallbackCircle(ctx, g.x, g.y, g.radius, '#7ee0ff');
          }
        }
      }

      var hearts = game.pickups.hearts;
      for (var j = 0; j < hearts.length; j++) {
        var h = hearts[j];
        if (!VS.World.isVisible(view, h.x, h.y, 16)) continue;

        // 快消失时闪烁
        var blink = h.life < 4 ? (Math.sin(h.life * 14) > 0 ? 0.35 : 1) : 1;
        var hb = Math.sin(h.phase) * 2;
        if (!blit(ctx, 'heart', h.x, h.y, HEART_SCALE, { dy: hb, alpha: blink })) {
          fallbackCircle(ctx, h.x, h.y, h.radius, '#ff4d6d');
        }
      }
    },

    /* ---------------- 武器场 ---------------- */

    drawAura: function (ctx, game, time) {
      var p = game.player;
      if (!p || !p.alive) return;

      var garlic = VS.Weapons.get(p, 'garlic');
      if (!garlic) return;

      var st = C.WEAPONS.garlic.stats(garlic.level);
      var gr = st.radius * p.areaMul;

      var grad = ctx.createRadialGradient(p.x, p.y, gr * 0.15, p.x, p.y, gr);
      grad.addColorStop(0, 'rgba(154,230,110,.16)');
      grad.addColorStop(0.7, 'rgba(154,230,110,.08)');
      grad.addColorStop(1, 'rgba(154,230,110,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, gr, 0, U.TAU);
      ctx.fill();

      // 旋转的虚线环，比纯圆更有"魔法阵"感
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(time * 0.55);
      ctx.strokeStyle = 'rgba(180,255,140,.42)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, gr, 0, U.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      var pulse = game.weapons.auraPulse;
      if (pulse) {
        var k = pulse.life / pulse.maxLife;
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, pulse.r * (1 + (1 - k) * 0.1), 0, U.TAU);
        ctx.strokeStyle = 'rgba(200,255,160,' + (k * 0.55).toFixed(3) + ')';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    },

    drawNovas: function (ctx, game, time) {
      var novas = game.weapons.novas;
      for (var i = 0; i < novas.length; i++) {
        var nv = novas[i];
        var a = U.clamp(nv.life / 1.4, 0, 1);

        // 主冲击环
        ctx.beginPath();
        ctx.arc(nv.x, nv.y, nv.r, 0, U.TAU);
        ctx.strokeStyle = 'rgba(255,107,107,' + (a * 0.8).toFixed(3) + ')';
        ctx.lineWidth = 7;
        ctx.stroke();

        // 内侧亮边
        ctx.beginPath();
        ctx.arc(nv.x, nv.y, nv.r * 0.9, 0, U.TAU);
        ctx.strokeStyle = 'rgba(255,226,200,' + (a * 0.45).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();

        // 锯齿外沿，避免看起来只是一个圆
        ctx.beginPath();
        var seg = 40;
        for (var s = 0; s <= seg; s++) {
          var ang = (s / seg) * U.TAU;
          var rr = nv.r * (1.06 + 0.06 * Math.sin(ang * 9 + time * 8));
          var px = nv.x + Math.cos(ang) * rr;
          var py = nv.y + Math.sin(ang) * rr;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255,160,90,' + (a * 0.35).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    },

    drawOrbit: function (ctx, game, time) {
      var blades = game.weapons.orbitBlades;
      for (var i = 0; i < blades.length; i++) {
        var b = blades[i];
        if (!blit(ctx, 'blade', b.x, b.y, 1.9, { angle: b.angle })) {
          fallbackCircle(ctx, b.x, b.y, b.r * 0.6, '#ffd166');
        }
      }
    },

    /* ---------------- 怪物 ---------------- */

    drawEnemies: function (ctx, game, view, time) {
      var list = game.enemies.list;

      // 先数屏幕内数量，据此决定是否画普通怪血条
      var onScreen = 0;
      for (var i = 0; i < list.length; i++) {
        var e0 = list[i];
        if (!e0.dead && VS.World.isVisible(view, e0.x, e0.y, e0.radius + 16)) onScreen++;
      }
      var showBars = onScreen <= 90;

      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (e.dead) continue;
        if (!VS.World.isVisible(view, e.x, e.y, e.radius + 20)) continue;

        var scale = ENEMY_SCALE[e.type] || 2;
        var fr = animFrame(e.type, time, 5.5, e.uid * 0.31);
        var name = fr ? fr.name : null;

        // 奇数帧整体上浮 1 像素（按缩放），走路有起伏
        var bob = (fr && (fr.index % 2 === 1)) ? -1 * scale : 0;

        var drawn = blit(ctx, name, e.x, e.y, scale, { dy: bob });

        if (!drawn) {
          fallbackCircle(ctx, e.x, e.y, e.radius, e.color, e.edge);
        }

        // 受击闪光：叠一层白色剪影
        if (e.hitFlash > 0 && name) {
          blitWhite(ctx, name, e.x, e.y, scale, Math.min(1, e.hitFlash / 0.12) * 0.9, bob);
        }

        // 精英/Boss 脚下光环
        if (e.elite || e.boss) {
          var ringR = e.boss ? e.radius * 1.5 : e.radius * 1.25;
          ctx.save();
          ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 4 + e.uid);
          ctx.strokeStyle = e.boss ? '#ff5d5d' : '#ffd166';
          ctx.lineWidth = e.boss ? 3 : 2;
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + e.radius * 0.9, ringR, ringR * 0.36, 0, 0, U.TAU);
          ctx.stroke();
          ctx.restore();
        }

        // 血条（Boss 不用这条，走屏幕顶部的专属血条）
        if (showBars && !e.boss && (e.elite || e.hp < e.maxHp)) {
          var w = e.elite ? e.radius * 2.4 : e.radius * 2;
          var h = e.elite ? 4 : 2.4;
          var bx = e.x - w / 2;
          var by = e.y - e.radius - (e.elite ? 12 : 8);

          ctx.fillStyle = 'rgba(0,0,0,.6)';
          ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
          ctx.fillStyle = e.elite ? '#ffd166' : '#ff6b6b';
          ctx.fillRect(bx, by, w * U.clamp(e.hp / e.maxHp, 0, 1), h);
        }
      }
    },

    /* ---------------- 玩家 ---------------- */

    drawPlayer: function (ctx, r, game) {
      var p = game.player;
      if (!p || !p.alive) return;

      /* 行走相位：只在移动时推进，停下时回到站立帧 */
      if (p.moving) {
        r.walkPhase += r.dt * 7.5;
      } else {
        r.walkPhase = 0;
      }

      /* 朝向：上下优先看 y，否则用侧面图（左右镜像） */
      var dirName, flip = false;
      if (Math.abs(p.facing.y) > Math.abs(p.facing.x)) {
        dirName = p.facing.y > 0 ? 'down' : 'up';
      } else {
        dirName = 'side';
        flip = p.facing.x < 0;
      }

      var group = 'player_' + dirName;
      var list = VS.SpriteGroups[group];
      var idx = list ? (Math.floor(r.walkPhase) % list.length) : 0;
      var name = list ? list[idx] : null;

      // 奇数帧上浮，走路更有弹性
      var bob = (idx % 2 === 1) ? -1 * PLAYER_SCALE : 0;

      /* 无敌帧闪烁 */
      var alpha = 1;
      if (p.invuln > 0) {
        alpha = 0.45 + 0.55 * Math.abs(Math.sin(r.walkPhase * 3 + p.invuln * 26));
      }

      // 脚下阴影，让角色站在地面上
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + p.radius * 0.95, p.radius * 0.85, p.radius * 0.34, 0, 0, U.TAU);
      ctx.fill();
      ctx.restore();

      var drawn = blit(ctx, name, p.x, p.y, PLAYER_SCALE, { flipX: flip, dy: bob, alpha: alpha });

      if (!drawn) {
        fallbackCircle(ctx, p.x, p.y, p.radius, p.hurtFlash > 0 ? '#ffd0d0' : '#e6dcff', '#8f6bd8');
      }

      if (p.hurtFlash > 0 && name) {
        blitWhite(ctx, name, p.x, p.y, PLAYER_SCALE, Math.min(1, p.hurtFlash / 0.28) * 0.85, bob);
      }
    },

    /* ---------------- 弹道 ---------------- */

    drawProjectiles: function (ctx, game, view, time) {
      var list = game.weapons.projectiles;
      var fr = animFrame('bolt', time, 14, 0);
      var name = fr ? fr.name : null;

      for (var i = 0; i < list.length; i++) {
        var pr = list[i];
        if (!VS.World.isVisible(view, pr.x, pr.y, pr.r + 14)) continue;

        // 拖尾
        var len = 0.05;
        ctx.strokeStyle = 'rgba(127,216,255,.30)';
        ctx.lineWidth = Math.max(2, pr.r * 1.2);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pr.x - pr.vx * len, pr.y - pr.vy * len);
        ctx.lineTo(pr.x, pr.y);
        ctx.stroke();

        var ang = pr.angle !== undefined ? pr.angle : Math.atan2(pr.vy, pr.vx);
        if (!blit(ctx, name, pr.x, pr.y, BOLT_SCALE, { angle: ang })) {
          fallbackCircle(ctx, pr.x, pr.y, pr.r, '#eaf9ff');
        }
      }
    },

    /* ---------------- 特效 ---------------- */

    drawParticles: function (ctx, game, view) {
      var list = game.fx.particles;
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (!VS.World.isVisible(view, p.x, p.y, 8)) continue;

        var a = U.clamp(p.life / p.maxLife, 0, 1);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;

        var s = p.size * (0.5 + a * 0.5);
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    },

    drawSparks: function (ctx, game, view) {
      var list = game.fx.sparks;
      var frames = VS.SpriteGroups.spark;
      if (!frames) return;

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!VS.World.isVisible(view, s.x, s.y, 24)) continue;

        var t = 1 - s.life / s.maxLife;
        var fi = Math.min(frames.length - 1, Math.floor(t * frames.length));
        blit(ctx, frames[fi], s.x, s.y, 2.4);
      }
    },

    drawBooms: function (ctx, game, view) {
      var list = game.fx.booms;
      var frames = VS.SpriteGroups.boom;
      if (!frames) return;

      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        if (!VS.World.isVisible(view, b.x, b.y, 80 * b.scale)) continue;

        var t = 1 - b.life / b.maxLife;
        var fi = Math.min(frames.length - 1, Math.floor(t * frames.length));
        blit(ctx, frames[fi], b.x, b.y, b.scale * 1.35);
      }
    },

    drawTexts: function (ctx, game, view) {
      var list = game.fx.texts;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (!VS.World.isVisible(view, t.x, t.y, 40)) continue;

        var a = U.clamp(t.life / t.maxLife, 0, 1);
        ctx.globalAlpha = a;
        ctx.font = (t.crit ? 'bold ' : '') + t.size + 'px ' + FONT;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.72)';
        ctx.strokeText(t.str, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.str, t.x, t.y);
      }
      ctx.globalAlpha = 1;
    },

    /* ---------------- 屏幕层 ---------------- */

    drawScreenFx: function (ctx, r, game, time) {
      var p = game.player;

      if (p && p.hurtFlash > 0) {
        ctx.fillStyle = 'rgba(255,40,40,' + (p.hurtFlash * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, 0, r.w, r.h);
      }

      Renderer.ensureVignette(r);

      /* 贴预渲染图：暗角是平滑渐变，放大贴回来肉眼看不出差别（要开插值，关掉会出色带） */
      var smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;

      if (p && p.alive && p.hp / p.maxHp < 0.3) {
        ctx.globalAlpha = 0.16 + 0.16 * Math.abs(Math.sin(time * 4));
        ctx.drawImage(r.vignetteDanger, 0, 0, r.w, r.h);
      }

      ctx.globalAlpha = 0.45;
      ctx.drawImage(r.vignetteDark, 0, 0, r.w, r.h);
      ctx.globalAlpha = 1;

      ctx.imageSmoothingEnabled = smooth;
    },

    drawJoystick: function (ctx, r) {
      var j = VS.Input.joystick;
      if (!j || !j.active) return;

      var ox = j.ox, oy = j.oy;

      ctx.beginPath();
      ctx.arc(ox, oy, 62, 0, U.TAU);
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ox + j.x * 62, oy + j.y * 62, 26, 0, U.TAU);
      ctx.fillStyle = 'rgba(200,170,255,.42)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  VS.register('Renderer', Renderer);

})(window.VS = window.VS || {});
