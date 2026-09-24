/* ===========================================================
   关卡：一次"跑图"由若干关组成，每关有自己的时长、难度乘区、
   怪物解锁速度、Boss 时间表与地面配色。
   -----------------------------------------------------------
   设计原则：
   - 关卡表全部放在 config.js 的 C.LEVELS（数值是数值，逻辑是逻辑）
   - 这一层只负责"查表 + 提供乘区"，不碰 DOM、不碰渲染
   - 时间口径：
       game.time      本关内的时间（阶段推进、Boss 时间表、难度曲线都按它）
       game.totalTime 已经打完的关卡时长之和
       一局的总时长 = totalTime + time（存档 / 排行用这个）
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;

  /** 关卡总数 */
  function count() {
    return (C.LEVELS && C.LEVELS.length) || 1;
  }

  /** 取关卡定义；下标越界会被夹到合法范围（负数当 0，超出的当最后一关） */
  function def(index) {
    var list = C.LEVELS || [];
    if (!list.length) return null;
    var i = Math.floor(index || 0);
    if (i < 0) i = 0;
    if (i >= list.length) i = list.length - 1;
    return list[i];
  }

  /** 这一关的 Boss 时间表（没有单独配就退回第一关那份） */
  function bosses(index) {
    var d = def(index);
    return (d && d.bosses) || C.BOSS.SCHEDULE;
  }

  /** 是不是最后一关（打完就通关） */
  function isLast(index) {
    return index >= count() - 1;
  }

  /** 难度乘区：怪物生成时会乘上去（血量 / 伤害 / 速度） */
  function statMul(index) {
    var d = def(index) || {};
    return {
      hp: d.hpMul === undefined ? 1 : d.hpMul,
      dmg: d.dmgMul === undefined ? 1 : d.dmgMul,
      speed: d.speedMul === undefined ? 1 : d.speedMul
    };
  }

  /** 刷怪间隔倍率（小于 1 = 刷得更密） */
  function spawnMul(index) {
    var d = def(index);
    return d && d.spawnMul !== undefined ? d.spawnMul : 1;
  }

  /** 怪物解锁时间的倍率（小于 1 = 强力怪更早出现） */
  function unlockMul(index) {
    var d = def(index);
    return d && d.unlockMul !== undefined ? d.unlockMul : 1;
  }

  /** 这一关额外偏置的怪物权重，例如第二关更爱出暗影/巨魔 */
  function typeBias(index, typeId) {
    var d = def(index);
    var b = d && d.typeBias;
    if (!b) return 1;
    return b[typeId] !== undefined ? b[typeId] : 1;
  }

  /** 地面精灵名（每关换一张底图，零每帧开销） */
  function ground(index) {
    var d = def(index);
    return (d && d.ground) || 'ground';
  }

  /** 这一关是不是"从 1 级重新开始"（不带上一关的构筑） */
  function isFresh(index) {
    var d = def(index);
    return !!(d && d.fresh);
  }

  /** 只在某些关卡出现的东西：`entry.onlyFromLevel` 是关卡下标（0 起），没写就是哪关都能出 */
  function allows(index, entry) {
    if (!entry || entry.onlyFromLevel === undefined || entry.onlyFromLevel === null) return true;
    return index >= entry.onlyFromLevel;
  }

  /** 这一关对某件武器的额外倍率（例如第二关的环绕骨刃 / 腐化光环 ×1.5） */
  function weaponMul(index, id) {
    var d = def(index);
    var m = d && d.weaponMul;
    if (!m) return 1;
    return m[id] === undefined ? 1 : m[id];
  }

  /** 这一关的地图机制（柠檬酸池之类）；没有就返回 null */
  function hazards(index) {
    var d = def(index);
    return (d && d.hazards) || null;
  }

  /** UI 用的一行名字，例如「第一关 · 血色荒野」 */
  function label(index) {
    var d = def(index);
    if (!d) return '';
    return d.name + (d.subtitle ? ' · ' + d.subtitle : '');
  }

  var Levels = {
    count: count,
    def: def,
    bosses: bosses,
    isLast: isLast,
    statMul: statMul,
    spawnMul: spawnMul,
    unlockMul: unlockMul,
    typeBias: typeBias,
    ground: ground,
    isFresh: isFresh,
    allows: allows,
    weaponMul: weaponMul,
    hazards: hazards,
    label: label,
    list: function () { return C.LEVELS || []; }
  };

  VS.register('Levels', Levels);

})(window.VS = window.VS || {});
