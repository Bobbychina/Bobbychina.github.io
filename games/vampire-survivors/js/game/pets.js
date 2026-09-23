/* ===========================================================
   宠物：打完第一只 Boss 后三选一
   -----------------------------------------------------------
   小精灵  ：每秒额外回复 3 点生命（直接加进玩家的 regen）
   德国的狼：每秒射出 4 颗飞弹 + 移动速度 +20%
   死亡猪神：每 2 分钟积攒一次复活；受到致命伤时自动消耗，
             回复一半生命并无敌 5 秒

   这一层只改玩家/游戏状态，不碰渲染与 DOM。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;

  function def(id) {
    var list = C.PETS;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  var Pets = {

    create: function () {
      return {
        id: null,          // 已选宠物（null = 还没选）
        x: 0, y: 0,        // 视觉位置（跟在玩家侧后方，由渲染层用）
        wolfCd: 0,         // 狼的开火计时
        pigTimer: 0,       // 猪神的充能计时
        pigCharges: 0      // 已积攒的复活次数
      };
    },

    reset: function (state) {
      state.id = null;
      state.x = 0;
      state.y = 0;
      state.wolfCd = 0;
      state.pigTimer = 0;
      state.pigCharges = 0;
    },

    def: def,
    list: function () { return C.PETS; },
    has: function (state, id) { return !!state && state.id === id; },
    chosen: function (state) { return !!(state && state.id); },

    /**
     * 选定宠物并立刻结算"一次性"效果
     * （小精灵的回复、狼的移速是常驻属性，在这里直接改玩家；
     *   狼的开火和猪神的充能是每帧逻辑，放在 update 里）
     */
    choose: function (state, id, game) {
      if (!state || state.id) return false;      // 只能选一次
      var d = def(id);
      if (!d) return false;

      state.id = id;

      var p = game.player;

      if (id === 'faerie') {
        p.regen += C.PET.FAERIE_REGEN;
      } else if (id === 'wolf') {
        p.speed *= C.PET.WOLF_SPEED_MUL;
        state.wolfCd = 0;
      } else if (id === 'pig') {
        state.pigTimer = 0;
        state.pigCharges = 1;                    // 选的时候先送一次，不然要等 2 分钟才有意义
      }

      /* 出场特效 */
      VS.Effects.burst(game.fx, p.x, p.y, d.color, 26, { speed: 200, life: 0.8, size: 3.4 });
      VS.Audio.play('level');

      var px = p.x, py = p.y;
      state.x = px - 26;
      state.y = py + 18;

      return true;
    },

    update: function (state, dt, game) {
      var p = game.player;
      if (!p) return;

      /* 宠物视觉位置：跟在玩家侧后方，和帧率无关地平滑跟随 */
      var back = 26, side = 18;
      var fx = p.facing.x, fy = p.facing.y;
      var tx = p.x - fx * back - fy * side;
      var ty = p.y - fy * back + fx * side;
      state.x = VS.Utils.damp(state.x, tx, 8, dt);
      state.y = VS.Utils.damp(state.y, ty, 8, dt);

      if (!state.id) return;

      /* --- 德国的狼：每秒 4 发飞弹（每 0.25 秒一发，打最近的敌人） --- */
      if (state.id === 'wolf') {
        state.wolfCd -= dt;
        if (state.wolfCd <= 0) {
          state.wolfCd = 1 / C.PET.WOLF_SHOTS_PER_SEC;
          if (p.alive && VS.Weapons.firePetBolt) {
            VS.Weapons.firePetBolt(game, state.x, state.y);
          }
        }
      }

      /* --- 死亡猪神：每 2 分钟攒一次复活 --- */
      if (state.id === 'pig') {
        state.pigTimer += dt;
        while (state.pigTimer >= C.PET.PIG_CHARGE_INTERVAL) {
          state.pigTimer -= C.PET.PIG_CHARGE_INTERVAL;
          if (state.pigCharges < C.PET.PIG_MAX_CHARGES) {
            state.pigCharges++;
            VS.Effects.text(game.fx, p.x, p.y - 30, '复活 +1', '#ffb4c8', { life: 1.1, size: 15 });
            if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
              game.deps.panels.showBanner('死 亡 猪 神', '攒到一次复活（共 ' + state.pigCharges + ' 次）');
            }
          }
        }
      }
    },

    /** 复活充能进度 0..1（UI 用；没选猪神返回 0） */
    pigProgress: function (state) {
      if (!state || state.id !== 'pig') return 0;
      return VS.Utils.clamp(state.pigTimer / C.PET.PIG_CHARGE_INTERVAL, 0, 1);
    },

    /**
     * 玩家血量清零时调用：有复活充能就救回来
     * @returns {boolean} 是否救活了
     */
    tryRevive: function (game) {
      var state = game.pets;
      if (!state || state.id !== 'pig' || state.pigCharges <= 0) return false;

      state.pigCharges--;

      var p = game.player;
      p.alive = true;
      p.hp = Math.max(1, Math.round(p.maxHp * C.PET.PIG_REVIVE_HP));
      p.invuln = C.PET.PIG_REVIVE_INVULN;
      p.healFlash = 0.7;

      game.shake = Math.max(game.shake || 0, 15);
      VS.Effects.explosion(game.fx, p.x, p.y, 3);
      VS.Effects.burst(game.fx, p.x, p.y, '#ffb4c8', 44, { speed: 280, life: 1.1, size: 4 });
      VS.Audio.play('level');

      if (game.deps && game.deps.panels && game.deps.panels.showBanner) {
        game.deps.panels.showBanner('死 亡 猪 神 护 佑',
          '消耗一次复活 · 回复一半生命 · 无敌 ' + C.PET.PIG_REVIVE_INVULN + ' 秒（剩 ' + state.pigCharges + ' 次）');
      }
      return true;
    },

    /** HUD 用的一行状态文字 */
    statusText: function (state) {
      if (!state || !state.id) return '';
      var d = def(state.id);
      if (!d) return '';
      if (state.id === 'pig') return d.name + ' · 复活 ' + state.pigCharges + '/' + C.PET.PIG_MAX_CHARGES;
      return d.name;
    }
  };

  VS.register('Pets', Pets);

})(window.VS = window.VS || {});
