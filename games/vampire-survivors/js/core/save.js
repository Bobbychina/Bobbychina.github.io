/* ===========================================================
   本地存档：最高存活时间 / 击杀 / 等级
   所有 localStorage 访问都被 try/catch 包住 ——
   file:// 限制、无 allow-same-origin 的 iframe、隐私模式下
   localStorage 会抛 SecurityError，绝不能让存档把游戏搞崩。
   =========================================================== */
(function (VS) {
  'use strict';

  var KEY = 'vampire_survivors_save_v1';

  function defaults() {
    return {
      bestTime: 0,
      bestKills: 0,
      bestLevel: 1,
      runs: 0,
      totalKills: 0,
      muted: false
    };
  }

  function readRaw() {
    try {
      if (!window.localStorage) return null;
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) {
      return null;
    }
  }

  function writeRaw(obj) {
    try {
      if (!window.localStorage) return false;
      window.localStorage.setItem(KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      return false;
    }
  }

  var Save = {

    KEY: KEY,

    /** 存档是否真的可用（不可用时游戏照常玩，只是不记纪录） */
    available: function () {
      try { return !!window.localStorage; } catch (e) { return false; }
    },

    /** 读取存档，字段缺失/类型不符时回落到默认值 */
    load: function () {
      var def = defaults();
      var raw = readRaw();
      if (!raw) return def;
      for (var k in def) {
        if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
        if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
        if (typeof raw[k] === typeof def[k] && isFinite(raw[k])) def[k] = raw[k];
      }
      return def;
    },

    /** 写回整个存档对象 */
    persist: function (data) {
      return writeRaw(data);
    },

    /**
     * 提交一局战绩
     * @param {{time:number,kills:number,level:number,wave:number}} run
     * @param {object} data 由 load() 得到的存档对象（会被就地修改并写回）
     * @returns {boolean} 是否刷新了最高存活时间
     */
    submit: function (run, data) {
      var time = Math.max(0, run.time || 0);
      var isNewBest = time > (data.bestTime || 0);

      data.runs = (data.runs || 0) + 1;
      data.totalKills = (data.totalKills || 0) + (run.kills || 0);

      if (isNewBest) data.bestTime = time;
      if ((run.kills || 0) > (data.bestKills || 0)) data.bestKills = run.kills || 0;
      if ((run.level || 1) > (data.bestLevel || 1)) data.bestLevel = run.level || 1;

      writeRaw(data);
      return isNewBest;
    },

    /** 只改静音状态 */
    setMuted: function (data, muted) {
      data.muted = !!muted;
      writeRaw(data);
      return data.muted;
    },

    reset: function () {
      var def = defaults();
      writeRaw(def);
      return def;
    }
  };

  VS.register('Save', Save);

})(window.VS = window.VS || {});
