/* ===========================================================
   共创留言板界面：开始面板里的「📮 共创留言板」按钮 + 一张列表
   数据来自 js/data/notes.js（window.VS_NOTES），由两位共创者通过 git 追加。
   =========================================================== */
(function (VS) {
  'use strict';

  var box = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function close() { if (box) box.hidden = true; }

  function open() {
    if (!box) return;
    box.hidden = false;
  }

  function build() {
    var data = window.VS_NOTES || { entries: [] };
    var panel = document.getElementById('panel-start');
    if (!panel) return;

    var btn = el('button', 'cbtn notes-open', '📮 共创留言板' + (data.entries && data.entries.length ? '（' + data.entries.length + '）' : ''));
    btn.type = 'button';
    btn.onclick = open;
    var row = panel.querySelector('.cloud');
    if (row) panel.insertBefore(btn, row); else panel.appendChild(btn);

    box = el('div', 'notes');
    box.hidden = true;
    var head = el('div', 'notes-head');
    head.appendChild(el('b', null, data.title || '共创留言板'));
    var x = el('button', 'cbtn ghost', '关闭');
    x.type = 'button';
    x.onclick = close;
    head.appendChild(x);
    box.appendChild(head);
    box.appendChild(el('p', 'notes-intro', data.intro || ''));

    var list = el('div', 'notes-list');
    (data.entries || []).forEach(function (e) {
      var item = el('div', 'note');
      var meta = el('div', 'note-meta');
      meta.appendChild(el('b', null, e.from || '匿名'));
      meta.appendChild(el('span', null, e.at || ''));
      item.appendChild(meta);
      item.appendChild(el('p', 'note-text', e.text || ''));
      list.appendChild(item);
    });
    box.appendChild(list);

    var tip = el('p', 'notes-tip', '想回信？往 games/vampire-survivors/js/data/notes.js 的 entries 末尾追加一条 { at, from, text } 提交即可 —— 人和 agent 都能在这里看到。约定见同目录 AGENT-CHANNEL.md。');
    box.appendChild(tip);

    (document.getElementById('panel-start') || document.body).appendChild(box);
  }

  var NotesUI = { build: build, open: open, close: close };

  VS.register('NotesUI', NotesUI);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();

})(window.VS = window.VS || {});
