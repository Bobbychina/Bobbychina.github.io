/* 新章节像素精灵只烘焙两帧与受击剪影；战斗帧复用位图。 */
(function (VS) {
  'use strict';
  var C = VS.Config, U = VS.Utils, cache = {}, decorations = [];
  function block(g, color, x, y, w, h) { g.fillStyle = color; g.fillRect(x, y, w, h); }
  function paint(g, id, frame) {
    var def = C.ENEMY_TYPES[id], c = def.color, light = def.edge, dark = '#19232c', step = frame ? 1 : 0;
    if (id === 'rimehound') {
      block(g, dark, 5, 13, 22, 10); block(g, c, 6, 14, 15, 7); block(g, light, 20, 10, 6, 7);
      block(g, c, 20, 8, 2, 4); block(g, '#f7f9e5', 24, 12, 2, 2);
      block(g, light, 8, 21, 3, 4 - step); block(g, light, 19, 21, 3, 3 + step);
    } else if (id === 'cinderbug') {
      block(g, dark, 7, 7, 18, 18); block(g, c, 10, 9, 12, 15);
      block(g, '#f7b65c', 13, 12, 6, 9); block(g, '#fff1af', 15, 15 - step, 3, 4 + step);
      for (var leg = 0; leg < 3; leg++) { block(g, light, 6, 11 + leg * 5, 4, 2); block(g, light, 22, 11 + leg * 5 - step, 4, 2); }
    } else if (id === 'emberslime' || id === 'cinderling') {
      block(g, dark, 5, 15, 23, 12); block(g, c, 7, 13 - step, 19, 13 + step);
      block(g, c, 10, 9 - step, 13, 6); block(g, light, 13, 14, 7, 7);
      block(g, '#fff0b1', 15, 15, 3, 4); block(g, dark, 9, 23, 3, 2); block(g, dark, 22, 22, 3, 2);
    } else if (id === 'bellkeeper') {
      block(g, dark, 5, 4, 22, 23); block(g, '#a88b57', 8, 7, 16, 18);
      block(g, '#d2b776', 11, 5, 10, 17); block(g, light, 7, 23, 18, 3);
      block(g, dark, 13, 12, 6, 8); block(g, '#9ce8f4', 14, 13 + step, 4, 6);
      block(g, light, 4, 14, 4, 8); block(g, light, 24, 14, 4, 8); block(g, '#e5cea0', 13, 27, 6, 2);
    } else if (id === 'rimeQueen') {
      block(g, c, 12, 7, 9, 8); block(g, '#eaffff', 9, 4, 3, 5); block(g, '#eaffff', 15, 2, 3, 6); block(g, '#eaffff', 21, 4, 3, 5);
      block(g, '#4d82ab', 10, 15, 13, 10); block(g, c, 7, 23 - step, 19, 4);
      block(g, light, 15, 15, 3, 10); block(g, dark, 13, 10, 2, 2); block(g, dark, 19, 10, 2, 2);
      block(g, '#bfdfff', 4, 16 - step, 4, 8); block(g, '#bfdfff', 25, 16 + step, 4, 8);
    } else if (id === 'emberColossus') {
      block(g, '#181820', 3, 7, 26, 19); block(g, '#51404a', 6, 8, 20, 16);
      block(g, c, 11, 4, 10, 7); block(g, light, 12, 6, 3, 2); block(g, light, 18, 6, 3, 2);
      block(g, '#c55b32', 10, 13, 13, 10); block(g, '#ffbc60', 13, 15, 7, 7); block(g, '#fff5b5', 15, 16 - step, 3, 5);
      block(g, '#39313a', 3, 11, 4, 13); block(g, '#39313a', 25, 11, 4, 13);
      block(g, c, 7, 25, 6, 5 - step); block(g, c, 20, 25, 6, 4 + step);
    } else {
      var hood = id === 'bellwisp' || id === 'ashcaster';
      block(g, dark, 10, 5, 13, 13); block(g, c, 11, 6, 11, 10);
      block(g, hood ? dark : light, 12, 9, 9, 6); block(g, hood ? light : dark, 13, 10, 2, 2); block(g, hood ? light : dark, 18, 10, 2, 2);
      block(g, c, 9, 17, 16, 9); block(g, dark, 12, 26, 4, 4 - step); block(g, dark, 20, 26, 4, 3 + step);
      if (id === 'frostguard') { block(g, light, 4, 15, 8, 13); block(g, '#5688a3', 6, 17, 4, 8); block(g, light, 25, 8, 2, 17); }
      if (id === 'icearcher') { block(g, light, 25, 10, 2, 16); block(g, c, 23, 9, 2, 2); block(g, c, 23, 25, 2, 2); block(g, light, 18, 16, 8, 1); }
      if (id === 'bellwisp') { block(g, '#e6d28f', 5, 19, 5, 7); block(g, light, 11, 25, 3, 3 + step); block(g, light, 20, 24, 3, 3 + step); }
      if (id === 'ashcaster') { block(g, '#df9c5c', 5, 9, 2, 20); block(g, '#ffe091', 3, 5 - step, 6, 6); block(g, '#ff6b46', 13, 17, 9, 3); }
      if (id === 'obsidianknight') { block(g, '#2b2631', 5, 15, 7, 9); block(g, light, 4, 14, 7, 2); block(g, light, 27, 3, 2, 24); block(g, '#eaca8f', 24, 11, 6, 2); }
    }
  }
  function sprite(id) {
    if (cache[id]) return cache[id];
    var out = [];
    for (var frame = 0; frame < 2; frame++) {
      var canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      var g = canvas.getContext('2d'); paint(g, id, frame);
      var white = document.createElement('canvas'); white.width = white.height = 32;
      var w = white.getContext('2d'); w.drawImage(canvas, 0, 0); w.globalCompositeOperation = 'source-in'; w.fillStyle = '#fff'; w.fillRect(0, 0, 32, 32);
      out.push({ image: canvas, white: white });
    }
    cache[id] = out; return out;
  }
  function circle(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.stroke();
  }
  function line(ctx, item, width, alpha) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = item.color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(item.x, item.y); ctx.lineTo(item.x + Math.cos(item.angle) * item.length, item.y + Math.sin(item.angle) * item.length); ctx.stroke();
  }
  function label(ctx, text, x, y, color) { ctx.globalAlpha = 0.95; ctx.fillStyle = color; ctx.font = '11px Microsoft YaHei, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, x, y); }
  var ChapterArt = {
    decoration: function (ctx, game, x, y, pick) {
      if (!game.stage || game.stage.mechanic !== 'frost') return false;
      var index = Math.floor(pick * 3);
      if (!decorations[index]) {
        var canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        var g = canvas.getContext('2d');
        if (index === 0) {
          block(g, '#263c4c', 7, 13, 18, 15); block(g, '#557b8e', 8, 11, 16, 15); block(g, '#9bc8d3', 9, 9, 14, 3);
          block(g, '#b3dbe2', 15, 13, 2, 9); block(g, '#b3dbe2', 12, 16, 8, 2);
        } else if (index === 1) {
          block(g, '#335f77', 6, 21, 21, 7); block(g, '#6394aa', 11, 8, 8, 19); block(g, '#a0d4df', 11, 8, 3, 17);
          block(g, '#80b2c6', 21, 15, 5, 11); block(g, '#bddde0', 21, 15, 2, 10);
        } else {
          block(g, '#456170', 7, 22, 21, 5); block(g, '#78909a', 9, 18, 16, 5); block(g, '#a2b9bc', 11, 17, 11, 2);
        }
        decorations[index] = canvas;
      }
      ctx.save(); ctx.globalAlpha = 0.75; ctx.drawImage(decorations[index], x - 24, y - 24, 48, 48); ctx.restore(); return true;
    },
    enemy: function (ctx, e, time) {
      var def = C.ENEMY_TYPES[e.type];
      if (!def || (!def.behavior && !def.encounter)) return false;
      var frames = sprite(e.type), image = frames[Math.floor(time * 5 + e.uid * 0.31) % 2];
      var size = Math.round(e.radius * (e.boss ? 3.2 : 4));
      var x = Math.round(e.x - size / 2), y = Math.round(e.y - size / 2);
      ctx.drawImage(image.image, x, y, size, size);
      if (e.hitFlash > 0) { ctx.save(); ctx.globalAlpha = Math.min(0.8, e.hitFlash / 0.12); ctx.drawImage(image.white, x, y, size, size); ctx.restore(); }
      return true;
    },
    ground: function (ctx, game, view, time) {
      var state = game.encounters, stage = game.stage, i, item;
      if (!state) return;
      ctx.save(); ctx.lineWidth = 2;
      if (stage && stage.mechanic === 'frost') for (i = 0; i < stage.lamps.length; i++) {
        item = stage.lamps[i];
        if (!VS.World.isVisible(view, item.x, item.y, 100)) continue;
        circle(ctx, item.x, item.y, C.CHAPTER_RULES.frost.warmRadius, '#d9bb77', stage.active ? 0.6 : 0.3);
        ctx.globalAlpha = 1; block(ctx, '#77664b', item.x - 3, item.y - 19, 6, 27);
        block(ctx, '#ffe1a0', item.x - 7, item.y - 21, 14, 11); block(ctx, '#fff6d2', item.x - 3, item.y - 19, 6, 7);
        label(ctx, '暖灯', item.x, item.y + 20, '#e2c996');
      }
      if (stage && stage.mechanic === 'forge') for (i = 0; i < stage.vents.length; i++) {
        item = stage.vents[i];
        if (!VS.World.isVisible(view, item.x, item.y, 65)) continue;
        circle(ctx, item.x, item.y, C.CHAPTER_RULES.forge.ventRadius, '#91d5c3', stage.ventSpent ? 0.2 : 0.55);
        ctx.globalAlpha = 1; block(ctx, '#526664', item.x - 13, item.y - 13, 26, 26);
        block(ctx, '#a3e5cf', item.x - 16, item.y - 3, 32, 6); block(ctx, '#a3e5cf', item.x - 3, item.y - 16, 6, 32);
        if (stage.nearVent === i && stage.ventCharge > 0) {
          ctx.strokeStyle = '#fff0be'; ctx.lineWidth = 4; ctx.beginPath();
          ctx.arc(item.x, item.y, 22, -Math.PI / 2, -Math.PI / 2 + U.TAU * stage.ventCharge / C.CHAPTER_RULES.forge.ventCharge); ctx.stroke();
        }
        label(ctx, '卸压阀', item.x, item.y + 29, '#a3e5cf');
      }
      if (stage) for (i = 0; i < stage.shrines.length; i++) {
        item = stage.shrines[i];
        if (item.used || !VS.World.isVisible(view, item.x, item.y, 85)) continue;
        circle(ctx, item.x, item.y, 29 + Math.sin(time * 3) * 3, '#f2cd7e', 0.7);
        ctx.globalAlpha = 1; block(ctx, '#6c5c45', item.x - 12, item.y - 7, 24, 16); block(ctx, '#e7cf91', item.x - 9, item.y - 16, 18, 12);
        label(ctx, '遗物祭坛 · 靠近选择', item.x, item.y + 48, '#ead398');
      }
      for (i = 0; i < state.zones.length; i++) {
        item = state.zones[i];
        if (!VS.World.isVisible(view, item.x, item.y, item.r)) continue;
        ctx.lineWidth = 2; ctx.setLineDash(item.delay > 0 ? [6, 5] : []);
        if (item.delay <= 0) { ctx.globalAlpha = 0.17; ctx.fillStyle = item.color; ctx.beginPath(); ctx.arc(item.x, item.y, item.r, 0, U.TAU); ctx.fill(); }
        circle(ctx, item.x, item.y, item.r, item.color, 0.9);
        if (item.delay > 0) circle(ctx, item.x, item.y, item.r * (1 - item.delay / Math.max(0.01, item.warning)), item.color, 0.65);
      }
      ctx.setLineDash([]);
      for (i = 0; i < state.rings.length; i++) {
        item = state.rings[i];
        if (!VS.World.isVisible(view, item.x, item.y, item.r + 20)) continue;
        ctx.lineWidth = item.delay > 0 ? 2 : item.width; ctx.strokeStyle = item.color; ctx.globalAlpha = item.delay > 0 ? 0.35 : 0.8;
        ctx.beginPath(); ctx.arc(item.x, item.y, item.r, item.gap + item.gapSize / 2, item.gap + U.TAU - item.gapSize / 2); ctx.stroke();
      }
      for (i = 0; i < state.beams.length; i++) {
        item = state.beams[i]; ctx.setLineDash(item.delay > 0 ? [9, 8] : []);
        line(ctx, item, item.delay > 0 ? 3 : item.width, item.delay > 0 ? 0.85 : 0.45);
        if (item.delay <= 0) line(ctx, item, 3, 0.95);
      }
      ctx.setLineDash([]); ctx.restore();
    },
    air: function (ctx, game, view) {
      var state = game.encounters;
      if (!state) return;
      ctx.save();
      for (var i = 0; i < state.shots.length; i++) {
        var s = state.shots[i];
        if (!VS.World.isVisible(view, s.x, s.y, s.r)) continue;
        block(ctx, s.color, s.x - s.r, s.y - s.r, s.r * 2, s.r * 2); block(ctx, '#f5f4da', s.x - 2, s.y - 2, 4, 4);
      }
      ctx.restore();
    },
    hints: function (ctx, game, view) {
      ctx.save(); ctx.lineWidth = 2;
      for (var i = 0; i < game.enemies.list.length; i++) {
        var e = game.enemies.list[i];
        if (e.dead || !VS.World.isVisible(view, e.x, e.y, e.radius + 30)) continue;
        var s = e.traits, boss = e.encounterAI;
        if (s && s.guard) circle(ctx, e.x, e.y, e.radius + 5, '#c0eeff', 0.9);
        if (s && s.pulse > 0) circle(ctx, e.x, e.y, 155 * (1 - s.pulse / 0.35), '#adf0c2', 0.6);
        if (s && s.mode === 'windup') {
          if (e.behavior === 'bomber') circle(ctx, e.x, e.y, 65, '#ffbe74', 0.9);
          else line(ctx, { x: e.x, y: e.y, angle: s.angle, length: e.behavior === 'charger' ? 150 : 260, color: e.edge }, 2, 0.65);
        }
        if (boss && boss.windup > 0) { circle(ctx, e.x, e.y, e.radius + 12, e.edge, 0.85); label(ctx, '蓄力', e.x, e.y - e.radius - 19, e.edge); }
        if (boss && boss.stun > 0) { circle(ctx, e.x, e.y, e.radius + 9, '#a5efd8', 1); label(ctx, '核心破绽', e.x, e.y - e.radius - 20, '#b8f4d8'); }
      }
      ctx.restore();
    }
  };
  VS.register('ChapterArt', ChapterArt);
})(window.VS = window.VS || {});
