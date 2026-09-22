/* ===========================================================
   世界：地图边界、摄像机、空间网格（碰撞加速）
   空间网格让"每个投射物去查所有怪物"变成 O(1) 邻域查询，
   否则几百只怪 + 几十个投射物会直接把帧率打穿。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  /* ---------------- 空间网格 ---------------- */

  function createGrid(cellSize, worldW, worldH) {
    var cols = Math.ceil(worldW / cellSize) + 1;
    var rows = Math.ceil(worldH / cellSize) + 1;
    var cells = new Array(cols * rows);
    for (var i = 0; i < cells.length; i++) cells[i] = [];

    /* 记录本帧被写入过的格子下标，清空时只清这些，
       避免每帧遍历全部 cols*rows 个格子（3400/64 → 2916 个）。 */
    var used = [];

    return {
      cellSize: cellSize,
      cols: cols,
      rows: rows,
      cells: cells,

      /** 只清空本帧用到的格子（避免每帧遍历全部格子 + 不产生 GC） */
      clear: function () {
        for (var i = 0; i < used.length; i++) {
          cells[used[i]].length = 0;
        }
        used.length = 0;
      },

      insert: function (e) {
        var cx = Math.floor(e.x / cellSize);
        var cy = Math.floor(e.y / cellSize);
        if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
        if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;

        var idx = cy * cols + cx;
        var bucket = cells[idx];
        if (bucket.length === 0) used.push(idx);
        bucket.push(e);
      },

      /**
       * 查询圆形范围内可能相交的对象，结果写入 out（复用数组）
       * @param {number} [limit] 最多收集多少个就提前返回。
       *   怪物被围成一团时，单个网格单元里可能有几百个实体；
       *   对这些"只需命中一两个"的场景（分离力、投射物）必须限流，
       *   否则查询会退化成 O(n²)。
       */
      queryCircle: function (x, y, r, out, limit) {
        out.length = 0;
        var cap = limit > 0 ? limit : 0;

        // 这里刻意不用 U.clamp：这段每帧要跑几百次，
        // 内联比较能省掉 4 次属性查找 + 函数调用
        var minX = Math.floor((x - r) / cellSize);
        var maxX = Math.floor((x + r) / cellSize);
        var minY = Math.floor((y - r) / cellSize);
        var maxY = Math.floor((y + r) / cellSize);

        if (minX < 0) minX = 0; else if (minX >= cols) minX = cols - 1;
        if (maxX < 0) maxX = 0; else if (maxX >= cols) maxX = cols - 1;
        if (minY < 0) minY = 0; else if (minY >= rows) minY = rows - 1;
        if (maxY < 0) maxY = 0; else if (maxY >= rows) maxY = rows - 1;

        for (var cy = minY; cy <= maxY; cy++) {
          var rowBase = cy * cols;
          for (var cx = minX; cx <= maxX; cx++) {
            var bucket = cells[rowBase + cx];
            for (var i = 0; i < bucket.length; i++) {
              out.push(bucket[i]);
              if (cap && out.length >= cap) return out;
            }
          }
        }
        return out;
      }
    };
  }

  /* ---------------- 世界 ---------------- */

  var World = {

    create: function () {
      return {
        w: C.WORLD.W,
        h: C.WORLD.H,
        pad: C.WORLD.PAD,
        time: 0,
        camera: { x: 0, y: 0, w: 1, h: 1 },
        grid: createGrid(64, C.WORLD.W, C.WORLD.H),
        scratch: []          // 复用的查询结果数组
      };
    },

    /** 把坐标夹进地图（含内缩边界） */
    clampX: function (world, x, r) {
      var lo = world.pad + (r || 0);
      var hi = world.w - world.pad - (r || 0);
      return U.clamp(x, lo, Math.max(lo, hi));
    },

    clampY: function (world, y, r) {
      var lo = world.pad + (r || 0);
      var hi = world.h - world.pad - (r || 0);
      return U.clamp(y, lo, Math.max(lo, hi));
    },

    /** 把一个带 x/y/radius 的实体夹回地图内 */
    clampEntity: function (world, e) {
      e.x = World.clampX(world, e.x, e.radius);
      e.y = World.clampY(world, e.y, e.radius);
      return e;
    },

    isInside: function (world, x, y, r) {
      r = r || 0;
      return x >= world.pad + r && x <= world.w - world.pad - r &&
             y >= world.pad + r && y <= world.h - world.pad - r;
    },

    /**
     * 摄像机跟随目标；视野比地图大时自动居中
     * @param {object} world
     * @param {number} tx 目标 x
     * @param {number} ty 目标 y
     * @param {number} vw 视口宽（CSS 像素）
     * @param {number} vh 视口高
     * @param {number} dt
     * @param {number} leadX 目标速度 x（用于前瞻）
     * @param {number} leadY 目标速度 y
     */
    updateCamera: function (world, tx, ty, vw, vh, dt, leadX, leadY) {
      var cam = world.camera;
      cam.w = vw;
      cam.h = vh;

      var lookX = (leadX || 0) * C.CAMERA.LOOKAHEAD;
      var lookY = (leadY || 0) * C.CAMERA.LOOKAHEAD;

      var desiredX = tx + lookX - vw / 2;
      var desiredY = ty + lookY - vh / 2;

      if (vw >= world.w) {
        desiredX = (world.w - vw) / 2;      // 视野比地图宽 → 水平居中
      } else {
        desiredX = U.clamp(desiredX, 0, world.w - vw);
      }

      if (vh >= world.h) {
        desiredY = (world.h - vh) / 2;
      } else {
        desiredY = U.clamp(desiredY, 0, world.h - vh);
      }

      cam.x = U.damp(cam.x, desiredX, C.CAMERA.SMOOTH, dt);
      cam.y = U.damp(cam.y, desiredY, C.CAMERA.SMOOTH, dt);

      // 数值兜底，避免浮点误差让视野探出地图
      if (vw < world.w) cam.x = U.clamp(cam.x, 0, world.w - vw);
      if (vh < world.h) cam.y = U.clamp(cam.y, 0, world.h - vh);
    },

    /** 立刻把摄像机放到目标上（开局用，避免从 (0,0) 滑过去） */
    snapCamera: function (world, tx, ty, vw, vh) {
      world.camera.w = vw;
      world.camera.h = vh;
      world.camera.x = vw >= world.w ? (world.w - vw) / 2 : U.clamp(tx - vw / 2, 0, world.w - vw);
      world.camera.y = vh >= world.h ? (world.h - vh) / 2 : U.clamp(ty - vh / 2, 0, world.h - vh);
    },

    /** 视口矩形（世界坐标），用于剔除屏幕外实体 */
    viewRect: function (world, margin) {
      var cam = world.camera;
      var m = margin || 0;
      return {
        x0: cam.x - m,
        y0: cam.y - m,
        x1: cam.x + cam.w + m,
        y1: cam.y + cam.h + m
      };
    },

    isVisible: function (rect, x, y, r) {
      return x + r >= rect.x0 && x - r <= rect.x1 &&
             y + r >= rect.y0 && y - r <= rect.y1;
    },

    /**
     * 在玩家周围一圈随机取生成点（屏幕外），并夹进地图边界。
     * 如果夹进边界后离玩家太近（玩家贴着地图边角时会发生），
     * 就在边界内重新随机，直到够远或达到重试上限。
     */
    ringSpawnPoint: function (world, px, py, ringRadius, out) {
      out = out || { x: 0, y: 0 };

      for (var attempt = 0; attempt < 12; attempt++) {
        var a = Math.random() * U.TAU;
        var x = px + Math.cos(a) * ringRadius;
        var y = py + Math.sin(a) * ringRadius;

        var insideX = x >= world.pad && x <= world.w - world.pad;
        var insideY = y >= world.pad && y <= world.h - world.pad;

        if (insideX && insideY) {
          out.x = x; out.y = y;
          return out;
        }

        // 夹回边界内再看看距玩家够不够远
        var cx = World.clampX(world, x, 0);
        var cy = World.clampY(world, y, 0);
        var dx = cx - px, dy = cy - py;
        if (dx * dx + dy * dy > (ringRadius * 0.55) * (ringRadius * 0.55)) {
          out.x = cx; out.y = cy;
          return out;
        }
      }

      // 兜底：地图内任意远离玩家的点
      var best = null, bestD = -1;
      for (var i = 0; i < 20; i++) {
        var rx = U.rand(world.pad, world.w - world.pad);
        var ry = U.rand(world.pad, world.h - world.pad);
        var d = U.dist2(rx, ry, px, py);
        if (d > bestD) { bestD = d; best = { x: rx, y: ry }; }
      }
      out.x = best.x; out.y = best.y;
      return out;
    }
  };

  VS.register('World', World);
  VS.createGrid = createGrid;

})(window.VS = window.VS || {});
