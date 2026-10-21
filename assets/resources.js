/* 共享资源页 —— /api/resources → 编辑式列表（零依赖，2026-10-21）
 * 接口失败或返回空列表时，用页面内置 FALLBACK（契约 §3 的唯一一条）兜底，
 * 并显示低调的「离线内容」提示；筛选与搜索全部在前端完成。 */
(() => {
  'use strict';

  const FALLBACK = [{
    id: 0,
    title: 'DeepSeek Harness 桌面版（Windows 安装包）',
    description: '免装 Node/pnpm，装完即用；首次启动可能要联网初始化（带 _Bundle 后缀的是离线捆绑包，体积大得多）。这是社区用 Tauri 打包的桌面外壳，不是 DeepSeek 官方发布的安装包，内核与官方 @deepseek-ai/dsh 同版本。macOS 与 Linux 安装包、历史版本见 GitHub releases；官方命令行路线：npm i -g @deepseek-ai/dsh，然后 dsh web。',
    url: 'https://github.com/dsh-tauri/deepseek-harness-desktop/releases/download/v0.24.5/Deepseek.Harness.Desktop_0.24.5_x64-setup.exe',
    tags: ['桌面端', '工具'],
    kind: 'link',
    fileName: null,
    fileSize: null,
    updatedAt: null
  }];

  const el = (id) => document.getElementById(id);
  const listEl = el('res-list');
  const chipsEl = el('res-chips');
  const searchEl = el('res-search');
  const statusEl = el('res-status');
  const offlineEl = el('res-offline');
  const retryEl = el('res-retry');
  const emptyEl = el('res-empty');

  let items = [];
  let source = 'api';       // api | fallback
  let activeTag = '*';
  let query = '';
  let loaded = false;
  let failed = false;
  let animated = false;
  let requestId = 0;

  const t = (key, vars) => I18N.t('resources.' + key, vars);

  function validUrl(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    if (/^\/(?!\/)/.test(raw)) return raw;                    // 站内相对地址，如 /api/resources/file/<key>
    try {
      const url = new URL(raw, location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (e) { /* 非法地址走下面的 null */ }
    return null;
  }

  function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1).replace(/\.0$/, '') + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const url = validUrl(raw.url);
    if (!title || !url) return null;
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim()).slice(0, 12)
      : [];
    const size = Number(raw.fileSize);
    return {
      id: raw.id,
      title: title.slice(0, 200),
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      url,
      tags,
      kind: raw.kind === 'file' ? 'file' : 'link',
      fileName: typeof raw.fileName === 'string' ? raw.fileName.trim().slice(0, 200) : '',
      fileSize: Number.isFinite(size) && size > 0 ? size : null,
      updatedAt: typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : null
    };
  }

  function dataset(raw) {
    return (Array.isArray(raw) ? raw : []).map(normalize).filter(Boolean);
  }

  function tagsOf() {
    const seen = new Set();
    for (const item of items) for (const tag of item.tags) seen.add(tag);
    return [...seen].slice(0, 24);
  }

  function renderChips() {
    chipsEl.replaceChildren();
    const make = (value, label) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'res-chip';
      button.textContent = label;
      button.dataset.tag = value;
      button.setAttribute('aria-pressed', String(activeTag === value));
      button.addEventListener('click', () => {
        activeTag = value;
        renderChips();
        renderList();
      });
      chipsEl.append(button);
    };
    make('*', t('all'));
    for (const tag of tagsOf()) make(tag, tag);
  }

  function matches(item) {
    if (activeTag !== '*' && !item.tags.includes(activeTag)) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (item.title + ' ' + item.description + ' ' + item.tags.join(' ')).toLowerCase().includes(q);
  }

  function renderList() {
    listEl.replaceChildren();
    const visible = items.filter(matches);
    const empty = loaded && visible.length === 0;
    emptyEl.hidden = !empty;
    listEl.hidden = !loaded || empty;
    offlineEl.hidden = !(source === 'fallback');
    statusEl.textContent = failed ? t('error') : '';
    if (!loaded || empty) return;

    const fragment = document.createDocumentFragment();
    visible.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'res-row';

      const num = document.createElement('span');
      num.className = 'res-num';
      num.setAttribute('aria-hidden', 'true');

      const body = document.createElement('div');
      body.className = 'res-body';

      const heading = document.createElement('h3');
      heading.className = 'res-title';
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = item.title;
      heading.append(link);
      body.append(heading);

      if (item.description) {
        const desc = document.createElement('p');
        desc.className = 'res-desc';
        desc.textContent = item.description;
        body.append(desc);
      }

      const meta = document.createElement('p');
      meta.className = 'res-meta';
      const kind = document.createElement('span');
      kind.className = 'res-kind';
      kind.textContent = item.kind === 'file' ? t('file') : t('link');
      meta.append(kind);

      const size = formatSize(item.fileSize);
      if (size) {
        const span = document.createElement('span');
        span.className = 'res-size';
        span.textContent = t('size') + ' ' + size;
        meta.append(span);
      }
      if (item.updatedAt) {
        let dateText = '';
        try { dateText = I18N.date(item.updatedAt, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { /* 忽略 */ }
        if (dateText) {
          const span = document.createElement('span');
          span.className = 'res-updated';
          span.textContent = t('updated', { date: dateText });
          meta.append(span);
        }
      }
      if (item.tags.length) {
        const tags = document.createElement('span');
        tags.className = 'res-tags';
        for (const tag of item.tags) {
          const span = document.createElement('span');
          span.className = 'res-tag';
          span.textContent = '#' + tag;
          tags.append(span);
        }
        meta.append(tags);
      }
      body.append(meta);

      const action = document.createElement('div');
      action.className = 'res-action';
      const act = document.createElement('a');
      act.className = 'res-act';
      act.href = item.url;
      act.target = '_blank';
      act.rel = 'noopener';
      act.textContent = item.kind === 'file' ? t('download') : t('open');
      act.setAttribute('aria-label', act.textContent + ' ' + item.title);
      if (item.kind === 'file') act.setAttribute('download', item.fileName || '');
      action.append(act);

      row.append(num, body, action);
      fragment.append(row);
    });
    listEl.append(fragment);
  }

  function render() {
    renderChips();
    renderList();
    document.title = t('title') + ' · Bobbychina';
    if (!animated && loaded && items.length && !listEl.hidden) {
      animated = true;
      listEl.classList.add('res-anim');
      setTimeout(() => listEl.classList.remove('res-anim'), 450);
    }
  }

  async function load() {
    const id = ++requestId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
    let next = null;
    failed = false;
    try {
      const response = await fetch('/api/resources', {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (!data || !Array.isArray(data.items)) throw new Error('Invalid payload');
      next = dataset(data.items);
    } catch (e) {
      if (id !== requestId) return;
      if (timer) clearTimeout(timer);
      source = 'fallback';
      failed = true;
      loaded = true;
      items = dataset(FALLBACK);
      render();
      return;
    }
    if (timer) clearTimeout(timer);
    if (id !== requestId) return;
    if (next.length) {
      source = 'api';
      items = next;
    } else {
      source = 'fallback';
      items = dataset(FALLBACK);
    }
    loaded = true;
    render();
  }

  searchEl.addEventListener('input', () => {
    query = searchEl.value;
    renderList();
  });
  retryEl.addEventListener('click', load);
  if (window.I18N && typeof I18N.onChange === 'function') I18N.onChange(render);

  render();
  load();
})();
