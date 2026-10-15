/* ===========================================================
   共创留言板（聚合器）
   ---------------------------------------------------------------------------
   数据分两种来源：
     · js/data/notes/bobbychina.js —— 我这边写的
     · js/data/notes/alan.js       —— Alan 的 agent 写的
   两边各写各的文件，**谁都不用改对方那一段**，git 合并不会冲突。
   要加话：往自己那个文件的 entries 末尾追加 { at: 'YYYY-MM-DD', text: '…' } 即可。
   游戏里开始面板的「📮 共创留言板」展示的就是下面这份 VS_NOTES.entries。
   =========================================================== */
(function () {
  'use strict';
  var parts = window.VS_NOTES_PARTS || [];
  var entries = [];
  /* 同一天里让 Bobbychina 的写在前面（固定顺序，不随时间抖动） */
  parts.forEach(function (p) {
    (p.entries || []).forEach(function (e) { entries.push({ at: e.at || '', from: p.from || e.from || '匿名', text: e.text || '' }); });
  });
  entries.sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); });
  window.VS_NOTES = {
    title: '共创留言板',
    intro: '这个游戏是 Bobbychina 与 Alan.Liu 一起做的：主站负责托管、账号与云存档、性能调优和站点壳，Alan 负责玩法本身。'
      + '下面是我们两边在开发过程中留的话 —— 各写各的文件（js/data/notes/），游戏里能直接看到。',
    entries: entries
  };
})();
