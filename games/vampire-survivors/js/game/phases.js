/* ===========================================================
   阶段系统：按存活时间划分游戏节奏
   -----------------------------------------------------------
   0:00 - 2:00  正常      —— 平稳打怪升级
   2:00 - 4:00  尸潮      —— 僵尸数量暴增（刷怪间隔缩短、每波数量翻倍）
   4:00 - 5:00  休整      —— 怪物大幅减少，专心捡经验升级
   5:00 以后    首领      —— 超大僵尸登场，并周期性再来更强的

   这里只做"读时间给出阶段与倍率"的纯计算，不碰实体，
   方便单独测试，也让刷怪逻辑保持干净。
   =========================================================== */
(function (VS) {
  'use strict';

  var C = VS.Config;

  /** 取某个时刻所处的阶段对象 */
  function at(t) {
    var list = C.PHASES;
    for (var i = list.length - 1; i >= 0; i--) {
      if (t >= list[i].from) return list[i];
    }
    return list[0];
  }

  /** 阶段下标，UI 用 */
  function indexOf(t) {
    var ph = at(t);
    for (var i = 0; i < C.PHASES.length; i++) {
      if (C.PHASES[i] === ph) return i;
    }
    return 0;
  }

  /** 从 fromT 走到 toT 之间是否跨入了新阶段；跨了就返回新阶段，否则 null */
  function crossed(fromT, toT) {
    var a = at(fromT);
    var b = at(toT);
    return a === b ? null : b;
  }

  /** 关键帧曲线插值 */
  function curve(list, t) {
    if (!list || !list.length) return 1;
    if (t <= list[0].at) return list[0].mult;

    var last = list[list.length - 1];
    if (t >= last.at) return last.mult;

    for (var i = 1; i < list.length; i++) {
      if (t <= list[i].at) {
        var p = list[i - 1];
        var q = list[i];
        var span = q.at - p.at;
        var k = span > 0 ? (t - p.at) / span : 0;
        return p.mult + (q.mult - p.mult) * k;
      }
    }
    return last.mult;
  }

  var Phases = {

    at: at,
    indexOf: indexOf,
    crossed: crossed,
    curve: curve,

    list: function () { return C.PHASES; },

    /** 当前阶段的刷怪间隔倍率 */
    spawnMul: function (t) { return at(t).spawnMul; },

    /** 当前阶段每波数量的倍率 */
    batchMul: function (t) { return at(t).batchMul; },

    /** 当前阶段是否完全不刷怪（休整阶段） */
    noSpawn: function (t) { return !!at(t).noSpawn; },

    /** 当前阶段对某类怪的权重加成（1 表示不加成） */
    typeBias: function (t, typeId) {
      var bias = at(t).typeBias;
      if (!bias) return 1;
      return bias[typeId] !== undefined ? bias[typeId] : 1;
    },

    /** 怪物血量倍率 */
    hpMult: function (t) { return curve(C.SPAWN.HP_CURVE, t); },

    /** 怪物伤害倍率 */
    dmgMult: function (t) { return curve(C.SPAWN.DMG_CURVE, t); },

    /**
     * 怪物速度倍率。
     * 走关键帧曲线（见 C.SPAWN.SPEED_CURVE）：0–5:00 与旧的线性公式一致，
     * 打完第一只 Boss 之后松手并封顶 —— 不然 10 分钟时暗影会比玩家还快。
     */
    speedMult: function (t) { return curve(C.SPAWN.SPEED_CURVE, t); },

    /** 距离下一个阶段还有多少秒（没有下一阶段返回 null） */
    secondsToNext: function (t) {
      var list = C.PHASES;
      for (var i = 0; i < list.length; i++) {
        if (t < list[i].from) return list[i].from - t;
      }
      return null;
    },

    /** 是否已进入 Boss 阶段 */
    isBossPhase: function (t) { return at(t).id === 'boss'; }
  };

  VS.register('Phases', Phases);

})(window.VS = window.VS || {});
