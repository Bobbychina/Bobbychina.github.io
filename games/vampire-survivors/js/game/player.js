/* ===========================================================
   玩家：移动、击退、血量/无敌帧/回血、经验与升级、增益应用
   只负责"玩家自己的状态与演化"，不碰渲染和 DOM。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;
  var U = VS.Utils;

  /** 从 level 升到 level+1 所需经验 */
  function xpForLevel(level) {
    return Math.round(C.XP.BASE * Math.pow(C.XP.GROWTH, level - 1));
  }

  var Player = {

    xpForLevel: xpForLevel,

    create: function (world) {
      return {
        x: world.w / 2,
        y: world.h / 2,
        radius: C.PLAYER.RADIUS,

        /* 击退产生的额外速度（与操作移动分开结算） */
        kx: 0,
        ky: 0,

        baseSpeed: C.PLAYER.SPEED,
        speed: C.PLAYER.SPEED,

        hp: C.PLAYER.MAX_HP,
        maxHp: C.PLAYER.MAX_HP,
        regen: C.PLAYER.REGEN,
        armor: C.PLAYER.ARMOR,
        pickupRadius: C.PLAYER.PICKUP_RADIUS,

        invuln: 0,
        hurtFlash: 0,
        healFlash: 0,

        level: 1,
        xp: 0,
        xpNeeded: xpForLevel(1),

        kills: 0,
        damageDealt: 0,
        alive: true,

        facing: { x: 1, y: 0 },
        moving: false,

        /* 增益带来的乘区 */
        damageMul: 1,
        attackSpeedMul: 1,
        areaMul: 1,
        projBonus: 0,
        luck: 1,
        critChance: 0,

        upgrades: {},           // 增益 id -> 已叠加层数
        weapons: []             // [{ id, level, cd }]
      };
    },

    /** 每帧更新；axis 由输入模块提供 */
    update: function (p, dt, world, axis) {
      if (!p.alive) return;

      /* --- 操作移动 --- */
      var ax = axis ? axis.x : 0;
      var ay = axis ? axis.y : 0;

      p.moving = (ax !== 0 || ay !== 0);

      if (p.moving) {
        p.x += ax * p.speed * dt;
        p.y += ay * p.speed * dt;

        var alen = Math.sqrt(ax * ax + ay * ay);
        if (alen > 0.001) {
          p.facing.x = ax / alen;
          p.facing.y = ay / alen;
        }
      }

      /* --- 击退位移 + 阻尼 --- */
      if (p.kx !== 0 || p.ky !== 0) {
        p.x += p.kx * dt;
        p.y += p.ky * dt;
        var damp = Math.exp(-C.PLAYER.PUSH_DAMP * dt);
        p.kx *= damp;
        p.ky *= damp;
        if (Math.abs(p.kx) < 1 && Math.abs(p.ky) < 1) { p.kx = 0; p.ky = 0; }
      }

      /* --- 地图边界 --- */
      VS.World.clampEntity(world, p);

      /* --- 生命回复 --- */
      if (p.hp < p.maxHp && p.regen > 0) {
        p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);
      }

      /* --- 计时器 --- */
      if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
      if (p.hurtFlash > 0) p.hurtFlash = Math.max(0, p.hurtFlash - dt);
      if (p.healFlash > 0) p.healFlash = Math.max(0, p.healFlash - dt);
    },

    /**
     * 受伤：扣血 + 无敌帧 + 击退
     * @returns {number} 实际扣掉的血量（0 表示被无敌帧挡下）
     */
    takeDamage: function (p, amount, game, srcX, srcY) {
      if (!p.alive || p.invuln > 0) return 0;

      var dmg = Math.max(1, amount - p.armor);
      p.hp -= dmg;
      p.invuln = C.PLAYER.INVULN;
      p.hurtFlash = 0.28;

      /* 击退：从伤害来源指向玩家 */
      if (srcX !== undefined && srcY !== undefined) {
        var dx = p.x - srcX, dy = p.y - srcY;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.001) {
          p.kx += (dx / len) * C.PLAYER.KNOCKBACK;
          p.ky += (dy / len) * C.PLAYER.KNOCKBACK;
        }
      }

      if (game) {
        VS.Audio.play('hurt');
        VS.Effects.burst(game.fx, p.x, p.y, '#ff6b6b', 10, { speed: 150, life: 0.4, size: 3 });
      }

      if (p.hp <= 0) {
        p.hp = 0;
        p.alive = false;
      }
      return dmg;
    },

    /** 回血（红心等） */
    heal: function (p, amount, game) {
      if (!p.alive) return 0;
      var before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + amount);
      var gained = p.hp - before;
      if (gained > 0) {
        p.healFlash = 0.35;
        if (game) {
          VS.Audio.play('heal');
          VS.Effects.burst(game.fx, p.x, p.y, '#7ee787', 8, { speed: 70, life: 0.5, size: 2.6 });
        }
      }
      return gained;
    },

    /**
     * 获得经验，返回本次升了几级
     * （一次吃一大把经验石可能连升多级，升级面板要排队处理）
     */
    gainXp: function (p, amount) {
      if (amount <= 0) return 0;
      if (p.level >= C.XP.MAX_LEVEL) return 0;

      p.xp += amount;
      var levels = 0;

      while (p.xp >= p.xpNeeded && p.level < C.XP.MAX_LEVEL) {
        p.xp -= p.xpNeeded;
        p.level++;
        levels++;
        p.xpNeeded = xpForLevel(p.level);
      }

      if (p.level >= C.XP.MAX_LEVEL) {
        p.xp = 0;
        p.xpNeeded = Infinity;
      }

      return levels;
    },

    /** 经验条进度 0..1 */
    xpProgress: function (p) {
      if (!isFinite(p.xpNeeded) || p.xpNeeded <= 0) return 1;
      return U.clamp(p.xp / p.xpNeeded, 0, 1);
    },

    hpProgress: function (p) {
      return p.maxHp > 0 ? U.clamp(p.hp / p.maxHp, 0, 1) : 0;
    },

    /**
     * 应用一个增益
     * @param {object} p
     * @param {object} up 配置里的增益对象（含 apply）
     */
    applyUpgrade: function (p, up) {
      p.upgrades[up.id] = (p.upgrades[up.id] || 0) + 1;
      up.apply(p);
      return p.upgrades[up.id];
    },

    /** 某个增益已经叠了几层 */
    upgradeLevel: function (p, id) {
      return p.upgrades[id] || 0;
    }
  };

  VS.register('Player', Player);

})(window.VS = window.VS || {});
