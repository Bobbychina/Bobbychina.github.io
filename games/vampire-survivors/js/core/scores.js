/* ===========================================================
   本机个人纪录：战役与无尽分别保留 top5。
   =========================================================== */
(function (VS) {
  'use strict';

  var MAX = 5;

  function key(r) { return [Math.round(r.time || 0), r.kills || 0, r.level || 1].join('/'); }

  function clean(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (r) {
      if (!r || typeof r !== 'object') return;
      var time = Number(r.time) || 0;
      if (time <= 0) return;
      var item = { time: time, kills: Number(r.kills) || 0, level: Number(r.level) || 1, wave: Number(r.wave) || 1, at: String(r.at || '') };
      var k = key(item);
      if (seen[k]) return;
      seen[k] = 1;
      out.push(item);
    });
    out.sort(function (a, b) { return b.time - a.time; });
    return out.slice(0, MAX);
  }

  var Scores = {

    MAX: MAX,

    /** 本机前 5（读的时候顺手清洗一遍，别让手改的存档把界面搞崩） */
    list: function (mode) {
      var data = VS.Save.load();
      return clean(VS.Save.profile(data, mode).top);
    },

    /** 记一局；返回 { rank, isTop } —— rank 从 1 开始，0 表示没进前 5 */
    add: function (run) {
      var data = VS.Save.load();
      var stats = VS.Save.profile(data, run.mode);
      var before = clean(stats.top);
      var next = clean(before.concat([{
        time: Math.max(0, run.time || 0),
        kills: run.kills || 0,
        level: run.level || 1,
        wave: run.wave || 1,
        at: run.at || new Date().toISOString()
      }]));
      stats.top = next;
      VS.Save.persist(data);
      if (VS.Game && VS.Game.current) VS.Game.current.data = data;

      var k = key({ time: run.time || 0, kills: run.kills || 0, level: run.level || 1 });
      var rank = 0;
      for (var i = 0; i < next.length; i++) if (key(next[i]) === k) { rank = i + 1; break; }
      return { rank: rank, isTop: rank > 0 && rank <= MAX, count: next.length };
    },

    /** 界面用的一行文案 */
    line: function (r, i) {
      var t = VS.Utils && VS.Utils.formatTime ? VS.Utils.formatTime(r.time) : String(Math.round(r.time)) + 's';
      var d = r.at ? String(r.at).slice(5, 10) : '';
      return '#' + (i + 1) + '  ' + t + '  ·  击杀 ' + r.kills + '  ·  Lv.' + r.level + (d ? '  ·  ' + d : '');
    }
  };

  VS.register('Scores', Scores);

})(window.VS = window.VS || {});
