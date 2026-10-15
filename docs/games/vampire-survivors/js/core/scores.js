/* ===========================================================
   个人纪录榜（跨设备）：本机存一份 top5，跟着云存档一起走
   —— 数据就是 VS.Save 里追加的 top 字段（Alan 的 agent 确认过「只在末尾加字段」没问题）：
        data.top = [{ time, kills, level, wave, at }, …]   按 time 降序，最多 5 条
   —— 合并口径：本机 ∪ 云端，按「时间+击杀+等级」去重，取前 5（VS.Cloud.merge 里调用 union）
   —— 不上传任何身份信息，也不引第三方服务：走的就是账号库那份私有 Gist。
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
    list: function () {
      var data = VS.Save.load();
      return clean(data.top);
    },

    /** 记一局；返回 { rank, isTop } —— rank 从 1 开始，0 表示没进前 5 */
    add: function (run) {
      var data = VS.Save.load();
      var before = clean(data.top);
      var next = clean(before.concat([{
        time: Math.max(0, run.time || 0),
        kills: run.kills || 0,
        level: run.level || 1,
        wave: run.wave || 1,
        at: run.at || new Date().toISOString()
      }]));
      data.top = next;
      VS.Save.persist(data);
      if (VS.Game && VS.Game.current) VS.Game.current.data = data;

      var k = key({ time: run.time || 0, kills: run.kills || 0, level: run.level || 1 });
      var rank = 0;
      for (var i = 0; i < next.length; i++) if (key(next[i]) === k) { rank = i + 1; break; }
      return { rank: rank, isTop: rank > 0 && rank <= MAX, count: next.length };
    },

    /** 两份榜取并集再截前 5（云存档合并用） */
    union: function (a, b) { return clean(clean(a).concat(clean(b))); },

    /** 界面用的一行文案 */
    line: function (r, i) {
      var t = VS.Utils && VS.Utils.formatTime ? VS.Utils.formatTime(r.time) : String(Math.round(r.time)) + 's';
      var d = r.at ? String(r.at).slice(5, 10) : '';
      return '#' + (i + 1) + '  ' + t + '  ·  击杀 ' + r.kills + '  ·  Lv.' + r.level + (d ? '  ·  ' + d : '');
    }
  };

  VS.register('Scores', Scores);

})(window.VS = window.VS || {});
