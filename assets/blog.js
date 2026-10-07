/* 博客的浏览量 + 评论区（2026-09-29）
 *
 * 为什么单独一个文件、而不是塞进 build.mjs 的内联脚本：
 *   · 文章页是静态产物，脚本要能改完立即生效而不用重建全站（走 /assets/blog.js?v=…，?v 变了 CF 才会重新取）；
 *   · 这一份同时服务「文章页」和「文章列表页」两种页面，靠 body 上的 data-* 区分。
 *
 * 契约（后端见 backend/src/modules/blog-public）：
 *   POST /api/blog/view            {slug}            → {slug, views}
 *   GET  /api/blog/views?slugs=a,b                   → {views:{a:1,b:2}}
 *   GET  /api/blog/comments?slug=…                   → {total, comments:[{id,author,body,createdAt}]}
 *   POST /api/blog/comments        {slug,body,author,cfToken} → {comment}（401 = 没登录）
 *
 * 安全：评论一律用 textContent 渲染，绝不拼 innerHTML —— 后端存的是原文（没做 HTML 转义）。
 */
(function () {
  var SK = '0x4AAAAAAFG_gA9qpBv-0gsz';         // Turnstile site key（公开值）
  var API = '/api/blog';
  var body = document.body;
  var slug = body.getAttribute('data-slug') || '';
  var isList = body.getAttribute('data-bloglist') === '1';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function postJSON(url, data) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, data: d }; }); });
  }

  /* ───────────── 浏览量 ───────────── */
  function initViews() {
    if (isList) {
      var spans = document.querySelectorAll('[data-pv]');
      var slugs = [];
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i].getAttribute('data-pv');
        if (s && slugs.indexOf(s) < 0) slugs.push(s);
      }
      if (!slugs.length) return;
      getJSON(API + '/views?slugs=' + encodeURIComponent(slugs.join(',')))
        .then(function (d) {
          var v = (d && d.views) || {};
          for (var j = 0; j < spans.length; j++) {
            var k = spans[j].getAttribute('data-pv');
            var n = v[k];
            spans[j].textContent = n ? n + ' 次浏览' : '';
          }
        })
        .catch(function () { /* 计数挂了不影响读文章，静默 */ });
      return;
    }
    if (!slug) return;
    var pv = $('#pv'), pc = $('#pc');
    postJSON(API + '/view', { slug: slug })
      .then(function (r) {
        if (pv && r.data && typeof r.data.views === 'number') pv.textContent = r.data.views;
      })
      .catch(function () {});
    if (pc) pc.textContent = '';   // 评论数在评论加载完后填
  }

  /* ───────────── 目录（侧栏） ───────────── */
  function initToc() {
    var toc = $('#toc');
    if (!toc) return;
    var hs = document.querySelectorAll('#post h2, #post h3');
    if (!hs.length) { toc.parentNode.hidden = true; return; }
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      if (!h.id) h.id = 'h-' + i;
      var a = el('a', h.tagName === 'H3' ? 'lv3' : '', h.textContent.trim());
      a.href = '#' + h.id;
      toc.appendChild(a);
    }
  }

  /* ───────────── 评论 ───────────── */
  var tsWidget = null, tsLoading = false;

  function loadTurnstile(cb) {
    if (window.turnstile) { cb(); return; }
    if (tsLoading) { setTimeout(function () { loadTurnstile(cb); }, 300); return; }
    tsLoading = true;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true;
    s.onload = function () { cb(); };
    document.head.appendChild(s);
  }

  function renderComments(list, box) {
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'empty', '还没有评论。')); return; }
    list.forEach(function (c) {
      var item = el('div', 'cmt');
      var head = el('div', 'cmt-head');
      head.appendChild(el('b', null, c.author));
      head.appendChild(el('span', 'when', fmt(c.createdAt)));
      item.appendChild(head);
      var b = el('div', 'cmt-body');
      var parts = String(c.body || '').split('\n');
      for (var i = 0; i < parts.length; i++) b.appendChild(el('p', null, parts[i] || ' '));
      item.appendChild(b);
      box.appendChild(item);
    });
  }

  function buildForm(container, reload) {
    var form = el('form', 'cmt-form');
    var name = el('input', 'cmt-name');
    name.type = 'text'; name.maxLength = 40; name.placeholder = '昵称（可留空）';
    try { name.value = localStorage.getItem('bobbycn.cmt.name') || ''; } catch (e) {}
    var ta = el('textarea', 'cmt-text');
    ta.rows = 4; ta.maxLength = 2000; ta.placeholder = '说点什么…（支持换行；不支持 HTML）';
    var cf = el('div', 'cmt-cf');
    var row = el('div', 'cmt-row');
    var btn = el('button', 'cmt-send', '发表');
    btn.type = 'submit';
    var msg = el('span', 'cmt-msg', '');
    row.appendChild(btn); row.appendChild(msg);
    form.appendChild(name); form.appendChild(ta); form.appendChild(cf); form.appendChild(row);
    container.appendChild(form);

    function ensureWidget() {
      if (tsWidget || !window.turnstile) return;
      tsWidget = window.turnstile.render(cf, { sitekey: SK, action: 'comment', theme: 'dark', language: 'zh-CN' });
    }
    loadTurnstile(ensureWidget);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var text = ta.value.trim();
      if (text.length < 1) { msg.textContent = '先写点内容'; msg.className = 'cmt-msg err'; return; }
      var token = '';
      try { token = (tsWidget !== null && window.turnstile) ? (window.turnstile.getResponse(tsWidget) || '') : ''; } catch (e) {}
      if (!token) { msg.textContent = '请先完成人机验证'; msg.className = 'cmt-msg err'; return; }
      btn.disabled = true; msg.textContent = '发送中…'; msg.className = 'cmt-msg';
      try { localStorage.setItem('bobbycn.cmt.name', name.value.trim()); } catch (e) {}
      postJSON(API + '/comments', { slug: slug, body: text, author: name.value.trim(), cfToken: token })
        .then(function (r) {
          btn.disabled = false;
          if (r.ok) {
            ta.value = ''; msg.textContent = '已发表'; msg.className = 'cmt-msg ok';
            try { if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget); } catch (e) {}
            reload();
            return;
          }
          msg.textContent = (r.data && r.data.message) || ('发送失败（' + r.status + '）');
          msg.className = 'cmt-msg err';
          try { if (tsWidget !== null && window.turnstile) window.turnstile.reset(tsWidget); } catch (e) {}
        })
        .catch(function () { btn.disabled = false; msg.textContent = '网络错误，稍后再试'; msg.className = 'cmt-msg err'; });
    });
  }

  function initComments() {
    var box = $('#cmt-list'), holder = $('#cmt-form');
    if (!box || !slug) return;
    var pc = $('#pc');

    function reload() {
      getJSON(API + '/comments?slug=' + encodeURIComponent(slug))
        .then(function (d) {
          var list = (d && d.comments) || [];
          renderComments(list, box);
          if (pc) pc.textContent = (d && d.total) || list.length;
          var n = $('#cmt-count');
          if (n) n.textContent = (d && d.total) || 0;
        })
        .catch(function () { box.textContent = ''; box.appendChild(el('p', 'empty', '评论加载失败。')); });
    }
    reload();

    // 登录态决定显示表单还是「登录后评论」
    getJSON('/api/auth/identity/me')
      .then(function () { buildForm(holder, reload); })
      .catch(function () {
        holder.textContent = '';
        var p = el('p', 'cmt-login');
        p.appendChild(document.createTextNode('想说的话挺多？'));
        var a = el('a', null, '登录');
        var next = encodeURIComponent(location.pathname);
        a.href = '/login/?next=' + next;
        p.appendChild(a);
        p.appendChild(document.createTextNode('后就能评论（全站一个账号）。'));
        holder.appendChild(p);
      });
  }

  function init() {
    initViews();
    if (slug) { initToc(); initComments(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
