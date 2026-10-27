/* 站内私线（2026-10-27）
 * ---------------------------------------------------------------------------
 * 只做三件事：拿会话（/api/chat/access）→ 渲染纸条 → 收发。
 * 上行全部走 REST（发消息 / 上传 / 已读 / 对方正在输入），下行走 SSE（EventSource），
 * 所以：权限与校验只有服务端一份实现；前端 SSE 挂了还能退回轮询，不会「消息卡住不更新」。
 *
 * 所有文案走 I18N.t()，语言切换时整页重绘；没有硬编码中文（除了后端返回的说明文字）。
 */
(function () {
  'use strict';

  var API = '/api/chat';
  var FILE_LIMIT = 20 * 1024 * 1024;
  var POLL_MS = 5000;

  var S = {
    allowed: false,
    me: null,
    peer: null,
    side: null,
    messages: [],
    hasMore: false,
    oldestId: null,
    newestId: null,
    online: false,
    es: null,
    pollTimer: null,
    coalesce: null,
    pendingFile: null,
    pendingChipKey: null,
    typingTimer: null,
    lastTypingAt: 0,
    unreadWhileHidden: 0,
    booted: false
  };

  var E = {};

  // ── 小工具 ──────────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function t(key, vars) { try { return window.I18N ? I18N.t(key, vars) : key; } catch (e) { return key; } }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function nowMs() { return Date.now(); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function bytesLabel(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
  }
  function extOf(name) {
    var m = String(name || '').match(/\.([A-Za-z0-9]{1,8})$/);
    return m ? m[1].toUpperCase() : 'FILE';
  }
  function isImage(mime) { return /^image\//i.test(String(mime || '')); }
  function timeLabel(d) {
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var y = new Date(now.getTime() - 86400000);
    var isYesterday = d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (sameDay) return hm;
    if (isYesterday) return t('chat.yesterday') + ' ' + hm;
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
  }
  function stampLabel(d) {
    var now = new Date();
    var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    return sameDay ? hm : timeLabel(d);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var opt = { method: method, credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    return fetch(API + path, opt).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        return { status: res.status, data: data, text: text };
      });
    });
  }

  // ── 启动 ────────────────────────────────────────────────────────────────
  function boot() {
    E.shell = $('chatShell'); E.gate = $('gate'); E.gateTitle = $('gateTitle'); E.gateText = $('gateText');
    E.gateLogin = $('gateLogin'); E.peerName = $('peerName'); E.statusText = $('statusText'); E.pulse = $('pulse');
    E.meMini = $('meNameMini'); E.thread = $('thread'); E.threadWrap = $('threadWrap'); E.empty = $('empty');
    E.more = $('btnMore'); E.typing = $('typing'); E.composer = $('composer'); E.input = $('input');
    E.send = $('btnSend'); E.composerMsg = $('composerMsg'); E.btnEmoji = $('btnEmoji'); E.btnFile = $('btnFile');
    E.btnLink = $('btnLink'); E.fileInput = $('fileInput'); E.emojiPanel = $('emojiPanel');
    E.emojiTabs = $('emojiTabs'); E.emojiGrid = $('emojiGrid'); E.pending = $('pending'); E.pendingChip = $('pendingChip');
    E.pendingX = $('pendingX'); E.linkRow = $('linkRow'); E.linkInput = $('linkInput'); E.linkSend = $('linkSend');
    E.linkCancel = $('linkCancel'); E.btnReload = $('btnReload');

    bind();
    buildEmojiPanel();
    loadAccess();
  }

  function bind() {
    E.composer.addEventListener('submit', function (ev) { ev.preventDefault(); sendCurrent(); });
    E.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
        ev.preventDefault();
        sendCurrent();
      }
    });
    E.input.addEventListener('input', function () { autoGrow(); maybeTyping(); });
    E.input.addEventListener('paste', onPaste);

    E.btnEmoji.addEventListener('click', function () { toggleEmoji(); });
    E.btnFile.addEventListener('click', function () { E.fileInput.click(); });
    E.btnLink.addEventListener('click', function () { toggleLink(); });

    E.fileInput.addEventListener('change', function () {
      var f = E.fileInput.files && E.fileInput.files[0];
      E.fileInput.value = '';
      if (f) uploadFile(f);
    });

    E.pendingX.addEventListener('click', function () {
      S.pendingFile = null;
      renderPending();
    });

    E.linkSend.addEventListener('click', submitLink);
    E.linkInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); submitLink(); }
      if (ev.key === 'Escape') { ev.preventDefault(); toggleLink(false); }
    });
    E.linkCancel.addEventListener('click', function () { toggleLink(false); });

    E.more.addEventListener('click', loadMore);
    E.btnReload.addEventListener('click', function () { location.reload(); });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        S.unreadWhileHidden = 0;
        updateTitle();
        markRead();
      }
    });

    if (window.I18N && I18N.onChange) I18N.onChange(function () { renderAll(); });
  }

  // ── 会话与门 ────────────────────────────────────────────────────────────
  function loadAccess() {
    api('GET', '/access').then(function (r) {
      if (r.status === 200 && r.data && r.data.allowed) {
        S.allowed = true;
        S.me = r.data.me;
        S.peer = r.data.peer;
        S.side = r.data.side;
        E.gate.hidden = true;
        E.shell.classList.remove('is-gated');
        renderHead();
        setOnline(!!r.data.online);
        loadMessages(true);
        connect();
        return;
      }
      showGate(r);
    }).catch(function () {
      showGate({ status: 0 });
    });
  }

  function showGate(r) {
    S.allowed = false;
    E.shell.classList.add('is-gated');
    E.gate.hidden = false;
    E.empty.hidden = true;
    E.more.hidden = true;
    E.thread.innerHTML = '';
    E.peerName.textContent = t('chat.title');
    setStatus(t('chat.status.offline'));
    if (r.status === 401) {
      E.gateTitle.textContent = t('chat.error.notLogin');
      E.gateText.textContent = t('chat.error.notLoginHint');
      E.gateLogin.hidden = false;
    } else if (r.status === 403) {
      E.gateTitle.textContent = t('chat.error.notAllowed');
      E.gateText.textContent = t('chat.error.notAllowedHint');
      E.gateLogin.hidden = true;
    } else if (r.status === 409) {
      E.gateTitle.textContent = t('chat.error.noPeer');
      E.gateText.textContent = (r.data && r.data.message) ? r.data.message : t('chat.error.noPeerHint');
      E.gateLogin.hidden = true;
    } else {
      E.gateTitle.textContent = t('chat.error.load');
      E.gateText.textContent = t('chat.error.network');
      E.gateLogin.hidden = true;
    }
    E.composer.hidden = true;
  }

  function renderHead() {
    E.peerName.textContent = (S.peer && S.peer.username) || '—';
    E.meMini.textContent = t('chat.you') + ' · ' + ((S.me && S.me.username) || '');
    setStatus(S.online ? t('chat.status.online') : t('chat.status.offline'));
  }

  function setStatus(text) {
    E.statusText.textContent = text;
  }

  function setOnline(online) {
    S.online = online;
    if (!S.allowed) return;
    E.pulse.classList.toggle('on', !!online);
    setStatus(online ? t('chat.status.online') : t('chat.status.offline'));
  }

  // ── 消息：读 ────────────────────────────────────────────────────────────
  function loadMessages(initial) {
    var q = '/messages?limit=30';
    return api('GET', q).then(function (r) {
      if (r.status !== 200 || !r.data) { showComposerMsg(t('chat.error.load')); return; }
      S.messages = r.data.messages || [];
      S.hasMore = !!r.data.hasMore;
      S.peer = r.data.peer || S.peer;
      S.me = r.data.me || S.me;
      renderAll();
      scrollToBottom(initial);
      if (initial) markRead();
    });
  }

  function loadMore() {
    if (!S.hasMore || !S.oldestId || E.more.disabled) return;
    E.more.disabled = true;
    E.more.textContent = t('chat.loadingMore');
    var before = S.oldestId;
    api('GET', '/messages?limit=30&before=' + encodeURIComponent(before)).then(function (r) {
      E.more.disabled = false;
      E.more.textContent = t('chat.more');
      if (r.status !== 200 || !r.data) return;
      var prevHeight = E.threadWrap.scrollHeight;
      var prevTop = E.threadWrap.scrollTop;
      S.messages = (r.data.messages || []).concat(S.messages);
      S.hasMore = !!r.data.hasMore;
      renderAll();
      E.threadWrap.scrollTop = E.threadWrap.scrollHeight - prevHeight + prevTop;
    });
  }

  function mergeIncoming(msg) {
    if (!msg || !msg.id) return false;
    for (var i = 0; i < S.messages.length; i++) {
      if (S.messages[i].id === msg.id) return false;
    }
    S.messages.push(msg);
    return true;
  }

  function applyRead(evt) {
    if (!evt) return;
    var changed = false;
    for (var i = 0; i < S.messages.length; i++) {
      var m = S.messages[i];
      if (m.sender && m.sender.id !== (S.me && S.me.id) && !m.readAt) {
        m.readAt = evt.at || new Date().toISOString();
        changed = true;
      }
    }
    if (changed) renderThread();
  }

  // ── 消息：渲染 ──────────────────────────────────────────────────────────
  function renderAll() {
    renderHead();
    renderThread();
    renderPending();
    updateTitle();
  }

  function renderThread() {
    if (!S.allowed) return;
    var frag = document.createDocumentFragment();
    var lastMs = 0;
    var lastDay = '';
    S.messages.forEach(function (m) {
      var ms = new Date(m.createdAt).getTime();
      var d = new Date(ms);
      var day = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
      if (!lastMs || day !== lastDay || ms - lastMs > 10 * 60 * 1000) {
        frag.appendChild(stampNode(d));
      }
      lastMs = ms;
      lastDay = day;
      frag.appendChild(messageNode(m));
    });
    E.thread.innerHTML = '';
    E.thread.appendChild(frag);
    E.empty.hidden = S.messages.length > 0;
    E.more.hidden = !S.hasMore;
    S.oldestId = S.messages.length ? S.messages[0].id : null;
    S.newestId = S.messages.length ? S.messages[S.messages.length - 1].id : null;
  }

  function stampNode(d) {
    var li = document.createElement('li');
    li.className = 'stamp';
    li.setAttribute('aria-hidden', 'true');
    li.textContent = stampLabel(d);
    return li;
  }

  function messageNode(m) {
    var mine = !!(S.me && m.sender && m.sender.id === S.me.id);
    var li = document.createElement('li');
    li.className = 'msg ' + (mine ? 'mine' : 'theirs') + ' kind-' + (m.kind || 'text');
    li.setAttribute('data-id', m.id);

    var slip = document.createElement('div');
    slip.className = 'slip';

    var head = document.createElement('div');
    head.className = 'slip-head';
    var who = document.createElement('span');
    who.className = 'who-mini';
    who.textContent = mine ? t('chat.you') : ((m.sender && m.sender.username) || (S.peer && S.peer.username) || '—');
    var when = document.createElement('span');
    when.textContent = timeLabel(new Date(m.createdAt));
    head.appendChild(who);
    head.appendChild(when);
    slip.appendChild(head);

    if (m.kind === 'file' && m.attachment) {
      if (isImage(m.attachment.mime)) {
        // 图片直接嵌在纸条里；点一下按原分辨率在新标签打开（不额外堆一张文件卡片）
        var imgLink = document.createElement('a');
        imgLink.href = m.attachment.url;
        imgLink.target = '_blank';
        imgLink.rel = 'noopener noreferrer';
        imgLink.title = (m.attachment.filename || 'image') + ' · ' + bytesLabel(m.attachment.size);
        var img = document.createElement('img');
        img.className = 'slip-img';
        img.loading = 'lazy';
        img.alt = m.attachment.filename || 'image';
        img.src = m.attachment.url;
        // 图片异步加载会改变高度：如果当时贴着底，就跟着往下走，别把最新一句挤出视口
        img.addEventListener('load', function () { scrollToBottom(false); });
        imgLink.appendChild(img);
        slip.appendChild(imgLink);
      }
      else {
        slip.appendChild(fileCard(m.attachment));
      }
    } else if (m.kind === 'link' && m.linkUrl) {
      slip.appendChild(linkCard(m.linkUrl));
    }

    if (m.text) {
      var p = document.createElement('p');
      p.className = 'slip-text';
      linkify(p, m.text);
      slip.appendChild(p);
    }

    var foot = document.createElement('div');
    foot.className = 'slip-foot';
    if (mine) {
      var tick = document.createElement('span');
      if (m.readAt) {
        tick.className = 'tick';
        tick.textContent = t('chat.read');
      } else {
        tick.className = 'tick pending';
        tick.textContent = t('chat.unread');
      }
      foot.appendChild(tick);
    }
    slip.appendChild(foot);

    li.appendChild(slip);
    return li;
  }

  function fileCard(a) {
    var a1 = document.createElement('a');
    a1.className = 'filecard';
    a1.href = a.url + '?download=1';
    a1.setAttribute('download', a.filename || 'file');
    a1.rel = 'noopener';
    var ext = document.createElement('span');
    ext.className = 'file-ext';
    ext.textContent = extOf(a.filename);
    var meta = document.createElement('span');
    meta.className = 'filecard-meta';
    var name = document.createElement('span');
    name.className = 'filecard-name';
    name.textContent = a.filename || 'file';
    var size = document.createElement('span');
    size.className = 'filecard-size';
    size.textContent = bytesLabel(a.size) + ' · ' + t('chat.file.download');
    meta.appendChild(name);
    meta.appendChild(size);
    a1.appendChild(ext);
    a1.appendChild(meta);
    return a1;
  }

  function linkCard(url) {
    var a = document.createElement('a');
    a.className = 'linkcard';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    var host = '';
    try { host = new URL(url).host; } catch (e) { host = ''; }
    var h = document.createElement('span');
    h.className = 'linkcard-host';
    h.textContent = (host || t('chat.link.from')).toUpperCase();
    var u = document.createElement('span');
    u.className = 'linkcard-url';
    u.textContent = url;
    a.appendChild(h);
    a.appendChild(u);
    return a;
  }

  function linkify(node, text) {
    var re = /(https?:\/\/[^\s<>"']+)/g;
    var last = 0;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      a.href = m[1];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = m[1];
      node.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function scrollToBottom(force) {
    if (force) {
      E.threadWrap.scrollTop = E.threadWrap.scrollHeight;
      return;
    }
    var nearBottom = E.threadWrap.scrollHeight - E.threadWrap.scrollTop - E.threadWrap.clientHeight < 120;
    if (nearBottom) E.threadWrap.scrollTop = E.threadWrap.scrollHeight;
  }

  function updateTitle() {
    var base = t('chat.title');
    document.title = S.unreadWhileHidden > 0 ? '(' + S.unreadWhileHidden + ') ' + base : base;
  }

  // ── 发消息 ──────────────────────────────────────────────────────────────
  function sendCurrent() {
    if (!S.allowed) return;
    var text = E.input.value.trim();
    if (S.pendingFile) {
      sendFileMessage(S.pendingFile, text);
      return;
    }
    if (!text) return;
    api('POST', '/messages', { kind: 'text', text: text }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.message) {
        if (r.status === 429) showComposerMsg((r.data && r.data.message) || t('chat.error.tooFast'));
        else showComposerMsg(t('chat.error.send'));
        return;
      }
      E.input.value = '';
      autoGrow();
      appendOutgoing(r.data.message);
    });
  }

  function appendOutgoing(msg) {
    mergeIncoming(msg);
    renderThread();
    scrollToBottom(true);
    E.input.focus();
  }

  function submitLink() {
    var raw = String(E.linkInput.value || '').trim();
    if (!raw) { E.linkInput.focus(); return; }
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    var caption = E.input.value.trim();
    api('POST', '/messages', { kind: 'link', linkUrl: raw, text: caption || undefined }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.message) {
        showComposerMsg(t('chat.error.send'));
        return;
      }
      E.linkInput.value = '';
      E.input.value = '';
      autoGrow();
      toggleLink(false);
      appendOutgoing(r.data.message);
    });
  }

  function sendFileMessage(file, caption) {
    if (!file.attachmentId) return;
    api('POST', '/messages', { kind: 'file', attachmentId: file.attachmentId, text: caption || undefined }).then(function (r) {
      if (r.status !== 200 || !r.data || !r.data.message) {
        showComposerMsg(t('chat.error.send'));
        return;
      }
      S.pendingFile = null;
      E.input.value = '';
      autoGrow();
      renderPending();
      appendOutgoing(r.data.message);
    });
  }

  // ── 上传 ────────────────────────────────────────────────────────────────
  function uploadFile(file) {
    if (file.size > FILE_LIMIT) {
      showComposerMsg(t('chat.error.fileTooLarge'));
      return;
    }
    var fd = new FormData();
    fd.append('file', file, file.name);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API + '/upload');
    xhr.withCredentials = true;
    var chipKey = file.name;
    S.pendingFile = { uploading: true, name: file.name, size: file.size, attachmentId: null };
    setPendingChip(t('chat.attach.uploading', { percent: 0 }) + ' · ' + file.name);
    E.pending.hidden = false;

    xhr.upload.onprogress = function (ev) {
      if (!ev.lengthComputable) return;
      var pct = Math.round((ev.loaded / ev.total) * 100);
      setPendingChip(t('chat.attach.uploading', { percent: pct }) + ' · ' + file.name);
    };
    xhr.onload = function () {
      var data = null;
      try { data = JSON.parse(xhr.responseText || 'null'); } catch (e) { data = null; }
      if (xhr.status !== 200 || !data || !data.attachment) {
        S.pendingFile = null;
        renderPending();
        showComposerMsg(xhr.status === 413 ? t('chat.error.fileTooLarge') : t('chat.error.upload'));
        return;
      }
      S.pendingFile = { uploading: false, name: data.attachment.filename, size: data.attachment.size, attachmentId: data.attachment.id, mime: data.attachment.mime };
      S.pendingChipKey = chipKey;
      renderPending();
      showComposerMsg(t('chat.attach.ready'), true);
      E.input.focus();
    };
    xhr.onerror = function () {
      S.pendingFile = null;
      renderPending();
      showComposerMsg(t('chat.error.upload'));
    };
    xhr.send(fd);
  }

  function setPendingChip(text) {
    E.pendingChip.textContent = text;
    E.pending.hidden = false;
  }

  function renderPending() {
    if (!S.pendingFile) {
      E.pending.hidden = true;
      E.pendingChip.textContent = '';
      return;
    }
    E.pending.hidden = false;
    var label = S.pendingFile.uploading
      ? t('chat.attach.uploading', { percent: '…' })
      : t('chat.attach.ready');
    E.pendingChip.textContent = label + ' · ' + S.pendingFile.name + ' · ' + bytesLabel(S.pendingFile.size);
  }

  function onPaste(ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        var f = items[i].getAsFile();
        if (f) {
          ev.preventDefault();
          uploadFile(f);
          return;
        }
      }
    }
  }

  // ── 已读 / 输入中 ───────────────────────────────────────────────────────
  function markRead() {
    if (!S.allowed) return;
    api('POST', '/read').then(function (r) {
      if (r.status !== 200 || !r.data) return;
      if (r.data.affected > 0) {
        for (var i = 0; i < S.messages.length; i++) {
          var m = S.messages[i];
          if (m.sender && m.sender.id !== (S.me && S.me.id) && !m.readAt) m.readAt = r.data.at;
        }
      }
    });
  }

  function maybeTyping() {
    if (!S.allowed) return;
    var now = nowMs();
    if (now - S.lastTypingAt < 4000) return;
    S.lastTypingAt = now;
    api('POST', '/typing').catch(function () { /* 纯提示，失败无所谓 */ });
  }

  function showTyping(info) {
    if (!info || (S.me && info.by === S.me.id)) return;
    E.typing.hidden = false;
    E.typing.textContent = t('chat.typing', { name: info.username || (S.peer && S.peer.username) || '' });
    if (S.typingTimer) clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(function () { E.typing.hidden = true; }, 3000);
  }

  // ── 实时：SSE + 轮询兜底 ────────────────────────────────────────────────
  function connect() {
    if (S.es) { try { S.es.close(); } catch (e) { /* 忽略 */ } S.es = null; }
    if (typeof EventSource === 'undefined') { startPolling(); return; }
    try {
      S.es = new EventSource(API + '/stream');
    } catch (e) {
      startPolling();
      return;
    }
    var es = S.es;
    es.addEventListener('hello', function () { stopPolling(); });
    es.addEventListener('presence', function (ev) {
      var info = parseEvent(ev);
      setOnline(!!(info && info.online));
    });
    es.addEventListener('message', function (ev) {
      var msg = parseEvent(ev);
      if (!msg) return;
      if (mergeIncoming(msg)) {
        renderThread();
        scrollToBottom(false);
        if (document.hidden) {
          S.unreadWhileHidden += 1;
          updateTitle();
        } else if (msg.sender && S.me && msg.sender.id !== S.me.id) {
          markRead();
        }
      }
    });
    es.addEventListener('read', function (ev) { applyRead(parseEvent(ev)); });
    es.addEventListener('typing', function (ev) { showTyping(parseEvent(ev)); });
    es.onerror = function () {
      setOnline(false);
      startPolling();
      // EventSource 会自己重连；这里只在用户手动刷新前保持轮询兜底
    };
  }

  function parseEvent(ev) {
    try { return JSON.parse(ev.data); } catch (e) { return null; }
  }

  function startPolling() {
    if (S.pollTimer) return;
    S.pollTimer = setInterval(pollOnce, POLL_MS);
  }
  function stopPolling() {
    if (!S.pollTimer) return;
    clearInterval(S.pollTimer);
    S.pollTimer = null;
  }

  function pollOnce() {
    if (!S.allowed || document.hidden) return;
    api('GET', '/messages?limit=30').then(function (r) {
      if (r.status !== 200 || !r.data) return;
      var list = r.data.messages || [];
      var fresh = [];
      for (var i = 0; i < list.length; i++) {
        if (mergeIncoming(list[i])) fresh.push(list[i]);
      }
      if (fresh.length) {
        renderThread();
        scrollToBottom(false);
        markRead();
      }
    }).catch(function () { /* 下一轮再试 */ });
  }

  // ── 表情面板 ────────────────────────────────────────────────────────────
  var EMOJI = {
    'chat.emoji.smile': ['😀', '😄', '😁', '😆', '😊', '🙂', '😉', '😍', '😘', '😜', '🤪', '🤔', '🤨', '😐', '😴', '😮', '😯', '😢', '😭', '😤', '😡', '🤯', '😱', '🥲', '😇', '🤗', '🤭', '🙃', '😋', '🤤', '🥱', '😪', '😵', '🤐', '🫠', '🥹'],
    'chat.emoji.gesture': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👋', '🙌', '👏', '🤝', '🙏', '💪', '👀', '👈', '👉', '👆', '👇', '✍️', '🤷', '🤦', '🤔', '🫡', '🫶'],
    'chat.emoji.thing': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '🔥', '✨', '⭐', '🌟', '💫', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '☕', '🍜', '🍰', '🍺', '🌙', '☀️', '🌧️', '🌈', '🌊', '🌲', '🐱', '🐶', '🦊', '🐼', '🐧']
  };

  function recentEmoji() {
    try {
      var raw = localStorage.getItem('chat-emoji-recent');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.slice(0, 24) : [];
    } catch (e) { return []; }
  }
  function rememberEmoji(ch) {
    try {
      var arr = recentEmoji().filter(function (c) { return c !== ch; });
      arr.unshift(ch);
      localStorage.setItem('chat-emoji-recent', JSON.stringify(arr.slice(0, 24)));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  function emojiGroups() {
    var groups = [{ key: 'chat.emoji.recent', list: recentEmoji() }];
    Object.keys(EMOJI).forEach(function (k) { groups.push({ key: k, list: EMOJI[k] }); });
    return groups.filter(function (g) { return g.list.length > 0; });
  }

  var emojiActive = 0;
  function buildEmojiPanel() {
    var groups = emojiGroups();
    if (emojiActive >= groups.length) emojiActive = 0;
    E.emojiTabs.innerHTML = '';
    E.emojiGrid.innerHTML = '';
    groups.forEach(function (g, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', idx === emojiActive ? 'true' : 'false');
      b.textContent = t(g.key);
      b.addEventListener('click', function () {
        emojiActive = idx;
        buildEmojiPanel();
      });
      E.emojiTabs.appendChild(b);
    });
    var list = (groups[emojiActive] || { list: [] }).list;
    list.forEach(function (ch) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'emoji-item';
      b.setAttribute('role', 'option');
      b.textContent = ch;
      b.addEventListener('click', function () {
        insertAtCaret(ch);
        rememberEmoji(ch);
      });
      E.emojiGrid.appendChild(b);
    });
  }

  function toggleEmoji(force) {
    var show = typeof force === 'boolean' ? force : E.emojiPanel.hidden;
    E.emojiPanel.hidden = !show;
    E.btnEmoji.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      toggleLink(false);
      buildEmojiPanel();
    }
  }

  function insertAtCaret(text) {
    var el = E.input;
    var start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    var pos = start + text.length;
    try { el.setSelectionRange(pos, pos); } catch (e) { /* 老浏览器忽略 */ }
    el.focus();
    autoGrow();
  }

  // ── 链接行 ──────────────────────────────────────────────────────────────
  function toggleLink(force) {
    var show = typeof force === 'boolean' ? force : E.linkRow.hidden;
    E.linkRow.hidden = !show;
    if (show) {
      toggleEmoji(false);
      E.linkInput.focus();
    }
  }

  // ── 输入框自适应 ────────────────────────────────────────────────────────
  function autoGrow() {
    var el = E.input;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 148) + 'px';
  }

  function showComposerMsg(text, ok) {
    E.composerMsg.textContent = text || '';
    E.composerMsg.classList.toggle('ok', !!ok);
    if (S.coalesce) clearTimeout(S.coalesce);
    S.coalesce = setTimeout(function () {
      E.composerMsg.textContent = '';
      E.composerMsg.classList.remove('ok');
    }, 4000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
