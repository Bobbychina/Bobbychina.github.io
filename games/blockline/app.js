'use strict';
(() => {
  const $ = (s) => document.querySelector(s),
    { esc, icon, color, itemIcon } = UI,
    { types, dirs, key, make, demo, fresh, tick, log } = StudioSim;
  const tint = { impulse: '#eab47d', chain: '#82cfac', repeat: '#bb9de4' },
    dirArrow = { east: '→', south: '↓', west: '←', north: '↑' };
  const $board = $('#board'),
    $out = $('#out'),
    $prop = $('#properties');
  const storageKey = 'blockline.project.v1';
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
  } catch {}
  let ed = saved.ed === 'BE' ? 'BE' : 'JE',
    project = 'intro',
    blocks = [],
    selected = null,
    w,
    tool = 'select',
    activeTab = 'preview',
    viewer = 'Steve',
    running = false,
    timer = null,
    demoPreview = false,
    toastTimer,
    tip,
    commandDraft = '';
  let zoom = 1,
    centerX = 0,
    centerZ = 0,
    drag = null;
  const tabs = {
    preview: ['screen', '玩家预览'],
    inventory: ['bag', '物品栏'],
    scores: ['score', '计分板'],
    logs: ['terminal', '日志'],
    world: ['globe', '世界'],
  };
  const quick = {
    give: 'gift',
    scoreboard: 'score',
    title: 'text',
    execute: 'branch',
    summon: 'entity',
    setblock: 'layers',
  };
  const cellX = 122,
    cellZ = 108;
  const tell = (s) => {
    clearTimeout(toastTimer);
    $('#toast').textContent = s;
    toastTimer = setTimeout(() => ($('#toast').textContent = ''), 2300);
  };
  function save() {
    saved.ed = ed;
    saved.projects ??= {};
    saved.last ??= {};
    saved.projects[ed + '/' + project] = blocks;
    saved.last[ed] = project;
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
      $('#saveState').textContent = '已保存到本机';
    } catch {
      $('#saveState').textContent = '当前浏览器无法保存';
    }
  }
  const valid = (b) =>
    b &&
    Number.isSafeInteger(b.x) &&
    Number.isSafeInteger(b.z) &&
    Math.abs(b.x) <= 10000 &&
    Math.abs(b.z) <= 10000 &&
    Object.hasOwn(types, b.type) &&
    Object.hasOwn(dirs, b.dir) &&
    typeof b.cmd === 'string' &&
    b.cmd.length <= 32768 &&
    Number.isInteger(b.delay) &&
    b.delay >= 0;
  function loadProject(p, first = false) {
    stop();
    project = ['intro', 'clock', 'empty'].includes(p) ? p : 'intro';
    const stored = saved.projects?.[ed + '/' + project];
    blocks =
      Array.isArray(stored) &&
      stored.length <= 1024 &&
      stored.every(valid) &&
      new Set(stored.map(key)).size === stored.length
        ? structuredClone(stored)
        : demo(ed, project);
    selected = blocks[0] || null;
    w = fresh(ed, blocks);
    demoPreview = !stored && project !== 'empty';
    if (demoPreview) tick(w, blocks);
    viewer = 'Steve';
    activeTab = 'preview';
    setTool('select');
    $('#project').value = project;
    document.querySelectorAll('[data-ed]').forEach((b) => {
      b.classList.toggle('active', b.dataset.ed === ed);
      b.setAttribute('aria-pressed', String(b.dataset.ed === ed));
    });
    $('#baseline').textContent = ed === 'JE' ? 'Java 1.21.5' : 'Bedrock 1.21.80';
    fit();
    properties();
    renderBoard();
    output();
    status();
    if (!first) save();
  }
  function stop() {
    running = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    $('#run').innerHTML = icon('play') + '<span>运行模拟</span>';
    $('#runLight').classList.remove('running');
  }
  function status() {
    $('#runLight').classList.toggle('running', running);
    $('#simState').textContent = running ? '运行中' : w.tick ? '已暂停' : '就绪';
    $('#blockCount').textContent = blocks.length + ' 个方块';
    $('#tickState').textContent = 'TICK ' + String(w.tick).padStart(4, '0') + (running ? '  ·  20 TPS' : '');
  }
  function simTick() {
    if (demoPreview) {
      demoPreview = false;
      w = fresh(ed, blocks);
    }
    tick(w, blocks);
    if (!running || w.tick % 4 === 0) {
      renderBoard();
      lastResult();
      output(false);
      status();
    }
  }
  function fit() {
    if (!blocks.length) {
      centerX = centerZ = 0;
      zoom = 1;
      return;
    }
    const xs = blocks.map((b) => b.x),
      zs = blocks.map((b) => b.z),
      minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs);
    centerX = (minX + maxX) / 2;
    centerZ = (minZ + maxZ) / 2;
    zoom = Math.max(
      0.12,
      Math.min(
        1.25,
        ($board.clientWidth - 28) / ((maxX - minX) * cellX + 115),
        ($board.clientHeight - 87) / ((maxZ - minZ) * cellZ + 87),
      ),
    );
  }
  const screen = (x, z) => [
    Math.round($board.clientWidth / 2 + (x - centerX) * cellX * zoom),
    Math.round($board.clientHeight / 2 + 4 + (z - centerZ) * cellZ * zoom),
  ];
  function pointerCell(event) {
    const r = $board.getBoundingClientRect();
    return [
      Math.round((event.clientX - r.left - $board.clientWidth / 2) / (cellX * zoom) + centerX),
      Math.round((event.clientY - r.top - $board.clientHeight / 2 - 4) / (cellZ * zoom) + centerZ),
    ];
  }
  const at = (x, z) => blocks.find((b) => b.x === x && b.z === z);
  const cmdHead = (b) => b.cmd.trim().replace(/^\//, '').split(/\s/)[0] || '空指令';
  function renderBoard() {
    const lookup = new Map(blocks.map((b) => [key(b), b]));
    let wires = '',
      nodes = '';
    for (const b of blocks) {
      const [x, y] = screen(b.x, b.z),
        [dx, dz] = dirs[b.dir],
        next = lookup.get(b.x + dx + ',' + (b.z + dz)),
        scale = zoom;
      const col = next?.type === 'chain' ? '#679b86' : '#52696b',
        len = (dx ? cellX : cellZ) * zoom;
      const start = (dx ? 35 : 39) * zoom,
        end = next?.type === 'chain' ? len - (dx ? 43 : 44) * zoom : (dx ? 52 : 51) * zoom;
      const x1 = x + dx * start,
        y1 = y + dz * start,
        x2 = x + dx * end,
        y2 = y + dz * end;
      wires +=
        '<path d="M' +
        x1 +
        ' ' +
        y1 +
        'L' +
        x2 +
        ' ' +
        y2 +
        '" stroke="' +
        col +
        '" stroke-width="' +
        2 * scale +
        '" fill="none"/><path d="M' +
        (x2 - dx * 5 * scale + dz * 3 * scale) +
        ' ' +
        (y2 - dz * 5 * scale - dx * 3 * scale) +
        'L' +
        x2 +
        ' ' +
        y2 +
        'L' +
        (x2 - dx * 5 * scale - dz * 3 * scale) +
        ' ' +
        (y2 - dz * 5 * scale + dx * 3 * scale) +
        '" stroke="' +
        col +
        '" fill="none" stroke-width="' +
        2 * scale +
        '"/>';
      const r = w.last.get(key(b));
      nodes +=
        '<button class="node ' +
        (b === selected ? 'selected' : '') +
        '" data-node="' +
        key(b) +
        '" aria-label="' +
        esc(types[b.type].name + '方块 ' + key(b) + ' ' + cmdHead(b)) +
        '" title="' +
        esc(b.cmd || '空指令') +
        '" style="left:' +
        x +
        'px;top:' +
        y +
        'px;--tint:' +
        tint[b.type] +
        ';transform:translate(-50%,-50%) scale(' +
        scale +
        ')"><img draggable="false" src="assets/' +
        b.type +
        '.png" alt=""><span class="node-label">/' +
        esc(cmdHead(b)) +
        '</span>' +
        (r && !r.ok ? '<span class="fail">!</span>' : '') +
        '</button>';
    }
    $('#wires').innerHTML = wires;
    $('#nodes').innerHTML = nodes || '<div class="empty-board">从左侧选择方块，再点击画布放置</div>';
    $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
    $board.style.backgroundPosition = screen(0, 0)
      .map((v) => v + 'px')
      .join(' ');
  }
  function setTool(value) {
    tool = value;
    $board.className = types[tool] ? 'place' : tool;
    document.querySelectorAll('[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
      b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    });
    $('#ghost').hidden = true;
    const hint = $('#boardHint');
    hint.hidden = !Object.hasOwn(types, tool) && tool !== 'erase';
    hint.textContent = types[tool]
      ? '点击放置' + types[tool].name + '方块 · Esc 退出'
      : '点击移除方块 · Esc 退出';
  }
  function selectBlock(b) {
    selected = b;
    properties();
    renderBoard();
  }
  function remove(b) {
    if (!b) return;
    MC.setBlock(w, [b.x, 64, b.z], 'overworld', 'air');
    w.power.delete(key(b));
    w.pendingChains?.delete(key(b));
    w.last.delete(key(b));
    blocks = blocks.filter((x) => x !== b);
    selectBlock(selected === b ? blocks[0] || null : selected);
    save();
    status();
  }
  function modify(b, field, value) {
    b[field] = value;
    if (!running && ['cmd', 'type', 'dir', 'conditional', 'delay'].includes(field)) w.power.clear();
    if (field === 'type') {
      MC.setBlock(w, [b.x, 64, b.z], 'overworld', types[b.type].block);
      w.power.delete(key(b));
    }
    w.last.delete(key(b));
    save();
    renderBoard();
    if (field !== 'cmd') properties();
    else lastResult();
  }
  function addAt(x, z) {
    $('#ghost').hidden = true;
    if (blocks.length >= 1024) {
      tell('每张画布最多放置 1024 个方块');
      return;
    }
    if (Math.abs(x) > 10000 || Math.abs(z) > 10000) {
      tell('坐标超出画布范围');
      return;
    }
    const b = make(x, z, tool);
    blocks.push(b);
    MC.setBlock(w, [x, 64, z], 'overworld', types[b.type].block);
    selectBlock(b);
    save();
    status();
  }
  function shiftZoom(factor) {
    zoom = Math.max(0.12, Math.min(2.2, zoom * factor));
    renderBoard();
  }
  function move(b, x, z) {
    if (at(x, z) || Math.abs(x) > 10000 || Math.abs(z) > 10000) return;
    w.pendingChains?.delete(key(b));
    w.last.delete(key(b));
    w.power.delete(key(b));
    MC.setBlock(w, [b.x, 64, b.z], 'overworld', 'air');
    b.x = x;
    b.z = z;
    MC.setBlock(w, [x, 64, z], 'overworld', types[b.type].block);
    selectBlock(b);
    save();
  }
  function lastResult() {
    const label = $('#last');
    if (!label || !selected) return;
    const r = w.last.get(key(selected));
    label.classList.toggle('error', !!r && !r.ok);
    label.innerHTML =
      '<small>上次输出' + (r ? ' · TICK ' + r.tick : '') + '</small>' + esc(r?.message || '等待执行');
  }
  function properties() {
    const b = selected;
    $('#delete').disabled = !b;
    if (!b) {
      $prop.innerHTML = '<div class="empty">选择画布上的方块以编辑属性</div>';
      return;
    }
    const sw = (field, label) =>
      '<label class="switch-row">' +
      label +
      '<span class="switch"><input type="checkbox" data-field="' +
      field +
      '" ' +
      (b[field] ? 'checked' : '') +
      '><b></b></span></label>';
    $prop.innerHTML =
      '<div class="selected-card"><div class="selected-art"><img src="assets/' +
      b.type +
      '.png" alt=""></div><div><h3>' +
      types[b.type].name +
      '命令方块</h3><code>X ' +
      b.x +
      ' &nbsp; Y 64 &nbsp; Z ' +
      b.z +
      '</code></div></div><label class="editor-label" for="code">命令输入 <code>/ COMMAND</code></label><div class="editor"><span class="line-number">1</span><textarea id="code" maxlength="32768" spellcheck="false" autocomplete="off" placeholder="输入 Minecraft 指令"></textarea></div><label class="field-title" for="blockType">方块类型</label><select class="field-select" id="blockType" data-field="type">' +
      Object.entries(types)
        .map(
          ([k, t]) =>
            '<option value="' +
            k +
            '" ' +
            (k === b.type ? 'selected' : '') +
            '>' +
            t.name +
            '命令方块</option>',
        )
        .join('') +
      '</select><div class="field-title">执行朝向</div><div class="dir-group">' +
      ['north', 'east', 'south', 'west']
        .map(
          (d) =>
            '<button data-dir="' +
            d +
            '" class="' +
            (b.dir === d ? 'active' : '') +
            '">' +
            dirArrow[d] +
            ' ' +
            StudioSim.directionNames[d] +
            '</button>',
        )
        .join('') +
      '</div><div class="toggles">' +
      sw('conditional', '有条件执行') +
      sw('always', '始终活动') +
      (!b.always ? sw('powered', '红石供电') : '') +
      '</div>' +
      (ed === 'BE'
        ? '<label class="field-title" for="delay">延迟（游戏刻）</label><input class="number-input" id="delay" data-field="delay" type="number" min="0" max="24000" value="' +
          b.delay +
          '">'
        : '') +
      '<button id="testBlock" class="test-btn">' +
      icon('bolt') +
      '单独执行此方块</button><div id="last" class="result-box"></div>';
    $('#code').value = b.cmd;
    lastResult();
  }
  function runSelected() {
    if (!selected) return;
    demoPreview = false;
    const b = selected,
      r = MC.execute(w, b.cmd, { ...MC.origin, pos: [b.x, 64, b.z] });
    w.last.set(key(b), { ...r, tick: w.tick });
    log(w, key(b), b.cmd, r);
    lastResult();
    renderBoard();
    output(false);
    status();
  }
  function setCmd(example) {
    if (!selected) {
      tell('先在画布上放置或选择一个方块');
      return;
    }
    modify(selected, 'cmd', example);
    $('#code').value = example;
    $('#code').focus();
  }
  function player() {
    return w.entities.find((e) => e.name === viewer && e.type === 'player');
  }
  function slot(item, index) {
    return (
      '<button class="slot" ' +
      (item
        ? 'data-item="' + index + '" aria-label="' + esc(Items.describe(item, w).name) + '"'
        : 'disabled aria-label="空槽位"') +
      '>' +
      (item ? itemIcon(item, 20) + (item.count > 1 ? '<small>' + item.count + '</small>' : '') : '') +
      '</button>'
    );
  }
  function stage(e) {
    if (!e) return '<div class="empty">没有可预览的玩家</div>';
    const t = e.title,
      show = t.until > w.tick,
      hide = (k) => e.hidden?.has('all') || e.hidden?.has(k);
    const alpha = running
      ? Math.max(
          0,
          Math.min(
            1,
            (w.tick - (t.start || 0) + 1) / Math.max(1, t.times[0]),
            (t.until - w.tick) / Math.max(1, t.times[2]),
          ),
        )
      : 1;
    const sb = w.scores.get(w.slots.get('sidebar')),
      scores = sb
        ? [...sb.values]
            .filter(([n]) => !n.startsWith('#'))
            .sort((a, b) => (sb.order === 'ascending' ? a[1] - b[1] : b[1] - a[1]))
            .slice(0, 15)
        : [];
    const bar = [...w.bars.values()].find((v) => v.visible && v.players.includes(e.uid)),
      msg = w.chat.filter((m) => (!m.to || m.to.includes(e.name)) && w.tick - m.tick < 120).at(-1);
    return (
      '<div class="stage-wrap"><div class="stage ' +
      (w.time % 24000 >= 12500 && w.time % 24000 <= 23500 ? 'night ' : '') +
      (w.weather !== 'clear' ? 'rain ' : '') +
      (e.shake > w.tick ? 'shake' : '') +
      '"><div class="scenery"></div><span class="preview-label">' +
      esc(e.name) +
      ' · ' +
      esc(e.dimension) +
      '</span>' +
      (!hide('crosshair') ? '<div class="cross">+</div>' : '') +
      (show
        ? '<div class="mc-title" style="opacity:' +
          alpha +
          '"><strong style="color:' +
          color(t.titleColor) +
          '">' +
          UI.formatted(t.titleParts || [{ text: t.title }]) +
          '</strong><small style="color:' +
          color(t.subtitleColor) +
          '">' +
          UI.formatted(t.subtitleParts || [{ text: t.subtitle }]) +
          '</small></div>'
        : '') +
      (sb
        ? '<div class="mc-score"><strong>' +
          esc(sb.name) +
          '</strong>' +
          scores.map(([n, v]) => '<div>' + esc(n) + '<b>' + v + '</b></div>').join('') +
          '</div>'
        : '') +
      (bar
        ? '<div class="boss">' +
          esc(bar.name) +
          '<progress style="accent-color:' +
          color(bar.color) +
          '" max="' +
          bar.max +
          '" value="' +
          bar.value +
          '"></progress></div>'
        : '') +
      (t.actionUntil > w.tick
        ? '<div class="actionbar" style="color:' +
          color(t.actionbarColor) +
          '">' +
          UI.formatted(t.actionbarParts || [{ text: t.actionbar }]) +
          '</div>'
        : '') +
      (msg ? '<div class="chatline">' + esc(msg.msg) + '</div>' : '') +
      (!hide('hotbar')
        ? '<div class="hud">' +
          (!hide('health')
            ? '<div class="hearts">' + '♥'.repeat(Math.min(10, Math.ceil(e.hp / 2))) + '</div>'
            : '') +
          '<div class="hotbar">' +
          Array.from({ length: 9 }, (_, i) => slot(e.inventory[i], i)).join('') +
          '</div></div>'
        : '') +
      (w.events.some(
        (v) =>
          v.type === 'particle' && w.tick - v.tick < 16 && (!v.entity.length || v.entity.includes(e.name)),
      )
        ? '<span class="particle-dot">·</span>'
        : '') +
      '</div></div>'
    );
  }
  const empty = (msg) => '<div class="empty">' + esc(msg) + '</div>';
  const row = (label, val) =>
    '<div class="data-row"><strong>' + esc(label) + '</strong><span>' + esc(val) + '</span></div>';
  function inventory(e) {
    if (!e) return empty('没有可预览的玩家');
    const entries = [
      ...e.inventory.map((v, i) => [String(i), v]),
      ...Object.entries(e.equipment).map(([k, v]) => ['eq:' + k, v]),
    ];
    if (!entries.length) return empty('背包为空。执行 /give 后可查看物品属性。');
    return (
      '<div class="panel-data"><p class="section-label">' +
      esc(e.name) +
      ' 的物品 · 悬停或点击查看属性</p>' +
      entries
        .map(
          ([k, v]) =>
            '<button class="data-row inventory-item" data-item="' +
            esc(k) +
            '">' +
            itemIcon(v) +
            '<strong>' +
            esc(Items.describe(v, w).name) +
            '</strong><span>× ' +
            v.count +
            (k.startsWith('eq:') ? ' · ' + esc(k.slice(3)) : '') +
            '</span></button>',
        )
        .join('') +
      '</div>'
    );
  }
  function scorePanel() {
    if (!w.scores.size) return empty('还没有计分项。使用 scoreboard objectives add 创建。');
    return (
      '<div class="panel-data">' +
      [...w.scores]
        .map(
          ([k, o]) =>
            '<p class="section-label">' +
            esc(o.name) +
            ' · ' +
            esc(k) +
            ' · ' +
            esc(
              [...w.slots]
                .filter(([, v]) => v === k)
                .map(([s]) => s)
                .join('/') || '未设置显示位置',
            ) +
            '</p>' +
            ([...o.values].map(([h, v]) => row(h, v)).join('') || row('尚无分数', '—')),
        )
        .join('') +
      '</div>'
    );
  }
  function worldPanel() {
    return (
      '<div class="panel-data">' +
      row('时间 / 天气 / 难度', w.time + ' / ' + w.weather + ' / ' + w.difficulty) +
      row('世界出生点', w.spawn.join(' ')) +
      row('虚拟方块', w.blocks.size) +
      (w.drops || [])
        .map((d) => row('掉落 · ' + d.pos.join(' '), Items.label(d.item) + ' × ' + d.item.count))
        .join('') +
      [...w.blocks]
        .slice(0, 20)
        .map(([k, v]) => row(k, v))
        .join('') +
      '<p class="section-label">实体 · ' +
      w.entities.length +
      '</p>' +
      w.entities
        .map((e) =>
          row(
            e.name,
            e.type +
              ' · ' +
              e.pos.map((n) => Math.round(n * 10) / 10).join(' ') +
              ' · HP ' +
              e.hp +
              ' · ' +
              e.mode +
              (e.tags.length ? ' · ' + e.tags.join(',') : '') +
              (Object.keys(e.effects).length ? ' · ' + Object.keys(e.effects).join(',') : '') +
              (e.type === 'player' ? ' · Lv ' + e.level + ' / XP ' + e.xp : '') +
              (e.camera ? ' · ' + e.camera : ''),
          ),
        )
        .join('') +
      (w.events.length
        ? '<p class="section-label">预览事件</p>' +
          w.events
            .slice(-20)
            .reverse()
            .map((ev) => row(ev.type, ev.detail))
            .join('')
        : '') +
      '</div>'
    );
  }
  function logRows() {
    return (
      w.logs
        .slice(-120)
        .reverse()
        .map(
          (r) =>
            '<div class="log-row ' +
            (!r.ok ? 'error' : '') +
            '"><span>#' +
            r.tick +
            '</span><span>' +
            esc(r.where) +
            '</span><code>' +
            esc(r.cmd) +
            '<small>' +
            esc(r.message) +
            '</small></code></div>',
        )
        .join('') || empty('运行命令链或在上方直接输入指令')
    );
  }
  function output(force = true) {
    const people = w.entities.filter((e) => e.type === 'player');
    if (!people.some((e) => e.name === viewer)) viewer = people[0]?.name || '';
    const choices = people
      .map((e) => '<option ' + (e.name === viewer ? 'selected' : '') + '>' + esc(e.name) + '</option>')
      .join('');
    const vs = $('#viewer');
    if (vs.dataset.last !== choices) {
      vs.innerHTML = choices;
      vs.dataset.last = choices;
    }
    if (force) {
      $('#tabs').innerHTML = Object.entries(tabs)
        .map(
          ([k, [i, n]]) =>
            '<button role="tab" aria-selected="' +
            (k === activeTab) +
            '" data-tab="' +
            k +
            '" class="tab ' +
            (k === activeTab ? 'active' : '') +
            '">' +
            icon(i) +
            n +
            '</button>',
        )
        .join('');
      hideTip();
    }
    if (activeTab === 'logs') {
      if (force || !$('#console')) {
        $out.innerHTML =
          '<div class="panel-data"><form class="console-form"><input id="console" aria-label="控制台指令" placeholder="/ 在此直接执行指令" autocomplete="off" spellcheck="false" maxlength="32768"><button>执行</button></form><div id="logRows"></div></div>';
        $('#console').value = commandDraft;
      }
      const html = logRows();
      if ($('#logRows').innerHTML !== html) $('#logRows').innerHTML = html;
      return;
    }
    const e = player(),
      html =
        activeTab === 'preview'
          ? stage(e)
          : activeTab === 'inventory'
            ? inventory(e)
            : activeTab === 'scores'
              ? scorePanel()
              : worldPanel();
    if (force || $out.dataset.html !== html) {
      $out.innerHTML = html;
      $out.dataset.html = html;
    }
  }
  function hideTip() {
    tip?.remove();
    tip = null;
  }
  function showTip(el) {
    const e = player(),
      k = el.dataset.item,
      v = k.startsWith('eq:') ? e?.equipment[k.slice(3)] : e?.inventory[Number(k)];
    if (!v) return;
    hideTip();
    const d = Items.describe(v, w);
    tip = document.createElement('div');
    tip.className = 'tipbox';
    tip.setAttribute('role', 'tooltip');
    tip.innerHTML =
      '<strong>' +
      esc(d.name) +
      '</strong>' +
      d.lines.map(([k, s]) => '<div class="' + k + '">' + esc(s) + '</div>').join('') +
      '<small>minecraft:' +
      esc(v.id) +
      '</small>';
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    tip.style.left = Math.max(5, Math.min(innerWidth - tip.offsetWidth - 5, r.left)) + 'px';
    tip.style.top = Math.max(5, r.top - tip.offsetHeight - 6) + 'px';
  }
  function manual() {
    const entries = Catalog.list(ed),
      supported = entries.filter((v) => v.done).length;
    $('#manualInfo').textContent =
      (ed === 'JE' ? 'Java 1.21.5' : '基岩 1.21.80') +
      ' · ' +
      supported +
      ' / ' +
      entries.length +
      ' 个入口含可执行示例（含别名）';
    const s = $('#search').value.toLowerCase().replace(/^\//, '').trim();
    $('#commandList').innerHTML =
      entries
        .filter((v) => (v.name + v.label).toLowerCase().includes(s))
        .map(
          (v) =>
            '<button class="manual-row" ' +
            (v.done ? 'data-example="' + esc(v.name) + '"' : 'disabled') +
            '><code>/' +
            esc(v.name) +
            '</code><span>' +
            esc(v.label) +
            '</span>' +
            (v.done ? '<small>' + esc(v.example) + '</small>' : '') +
            '</button>',
        )
        .join('') || empty('没有匹配的指令');
  }
  function openManual() {
    $('#search').value = '';
    manual();
    $('#manual').showModal();
    $('#search').focus();
  }
  UI.icons();
  $('#palette').innerHTML = Object.entries(types)
    .map(
      ([k, t], i) =>
        '<button draggable="true" data-tool="' +
        k +
        '" class="palette-card" style="--tint:' +
        tint[k] +
        '" title="' +
        t.name +
        '方块"><img draggable="false" src="assets/' +
        k +
        '.png" alt=""><span><strong>' +
        t.name +
        '方块</strong><small>' +
        t.hint +
        '</small></span><kbd>' +
        (i + 1) +
        '</kbd></button>',
    )
    .join('');
  $('#quick').innerHTML = Object.entries(quick)
    .map(
      ([name, i]) =>
        '<button class="quick-btn" data-quick="' +
        name +
        '" title="填入 /' +
        name +
        ' 示例"><i>' +
        icon(i) +
        '</i><span><code>/' +
        name +
        '</code><small>' +
        Catalog.get(name, 'JE').label +
        '</small></span></button>',
    )
    .join('');
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.ed && b.dataset.ed !== ed) {
      save();
      ed = b.dataset.ed;
      loadProject(saved.last?.[ed] || 'intro');
    } else if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.tab) {
      activeTab = b.dataset.tab;
      output();
    } else if (b.dataset.quick) setCmd(Catalog.get(b.dataset.quick, ed).example);
    else if (b.dataset.dir && selected) modify(selected, 'dir', b.dataset.dir);
    else if (b.dataset.example) {
      $('#manual').close();
      setCmd(Catalog.get(b.dataset.example, ed).example);
    } else if (b.id === 'guide' || b.id === 'allCmd') openManual();
    else if (b.id === 'closeManual') $('#manual').close();
    else if (b.id === 'testBlock') runSelected();
    else if (b.id === 'delete') remove(selected);
    else if (b.id === 'fit') {
      fit();
      renderBoard();
    } else if (b.id === 'zoomOut') shiftZoom(1 / 1.2);
    else if (b.id === 'zoomIn') shiftZoom(1.2);
    else if (b.id === 'zoomLabel') {
      zoom = 1;
      renderBoard();
    } else if (b.id === 'reset') {
      stop();
      demoPreview = false;
      w = fresh(ed, blocks);
      renderBoard();
      lastResult();
      output();
      status();
      tell('模拟状态已重置');
    } else if (b.id === 'step') {
      stop();
      simTick();
    } else if (b.id === 'run') {
      if (running) {
        stop();
        output(false);
        lastResult();
      } else {
        running = true;
        $('#run').innerHTML = icon('pause') + '<span>暂停模拟</span>';
        simTick();
        timer = setInterval(simTick, 50);
      }
      status();
    } else if (b.hasAttribute('data-item')) showTip(b);
  });
  $('#project').onchange = (ev) => {
    const next = ev.target.value;
    save();
    loadProject(next);
  };
  $('#viewer').onchange = (ev) => {
    viewer = ev.target.value;
    output();
  };
  $prop.addEventListener('input', (ev) => {
    if (ev.target.id === 'code' && selected) modify(selected, 'cmd', ev.target.value);
  });
  $prop.addEventListener('change', (ev) => {
    const el = ev.target,
      f = el.dataset.field;
    if (!f || !selected) return;
    modify(
      selected,
      f,
      el.type === 'checkbox'
        ? el.checked
        : f === 'delay'
          ? Math.max(0, Math.min(24000, Math.trunc(Number(el.value)) || 0))
          : el.value,
    );
  });
  $out.addEventListener('input', (ev) => {
    if (ev.target.id === 'console') commandDraft = ev.target.value;
  });
  $out.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const cmd = $('#console').value.trim();
    if (!cmd) return;
    demoPreview = false;
    const r = MC.execute(w, cmd);
    log(w, '控制台', cmd, r);
    commandDraft = '';
    $('#console').value = '';
    output(false);
    status();
  });
  $out.addEventListener('pointerover', (ev) => {
    const el = ev.target.closest('[data-item]');
    if (el) showTip(el);
  });
  $out.addEventListener('pointerout', (ev) => {
    if (ev.target.closest('[data-item]') !== ev.relatedTarget?.closest?.('[data-item]')) hideTip();
  });
  $out.addEventListener('focusin', (ev) => {
    const el = ev.target.closest('[data-item]');
    if (el) showTip(el);
  });
  $out.addEventListener('focusout', hideTip);
  $('#search').oninput = manual;
  $('#manual').addEventListener('click', (ev) => {
    if (ev.target === $('#manual') && ev.clientX < $('#manual').getBoundingClientRect().left)
      $('#manual').close();
  });
  $('#palette').addEventListener('dragstart', (ev) => {
    const t = ev.target.closest('[data-tool]')?.dataset.tool;
    if (t) {
      ev.dataTransfer.setData('text/blockline', t);
      setTool(t);
    }
  });
  $board.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer.types.includes('text/blockline')) ev.preventDefault();
  });
  $board.addEventListener('drop', (ev) => {
    ev.preventDefault();
    const t = ev.dataTransfer.getData('text/blockline');
    if (!Object.hasOwn(types, t)) return;
    setTool(t);
    const [x, z] = pointerCell(ev);
    if (!at(x, z)) addAt(x, z);
  });
  $board.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.canvas-caption,.canvas-foot') || ev.button > 1) return;
    const node = ev.target.closest('[data-node]'),
      b = node ? blocks.find((x) => key(x) === node.dataset.node) : null;
    drag = {
      x: ev.clientX,
      y: ev.clientY,
      cx: centerX,
      cz: centerZ,
      b,
      pan: ev.button === 1 || tool === 'pan',
      moved: false,
    };
    $board.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    $board.focus({ preventScroll: true });
  });
  $board.addEventListener('pointerleave', () => ($('#ghost').hidden = true));
  $board.addEventListener('pointermove', (ev) => {
    const ghost = $('#ghost');
    ghost.hidden = true;
    if (!drag && Object.hasOwn(types, tool) && !ev.target.closest('.canvas-caption,.canvas-foot')) {
      const [x, z] = pointerCell(ev);
      if (!at(x, z)) {
        const [sx, sy] = screen(x, z);
        ghost.hidden = false;
        ghost.style.left = sx + 'px';
        ghost.style.top = sy + 'px';
        ghost.style.transform = 'translate(-50%,-50%) scale(' + zoom + ')';
        ghost.innerHTML = '<img src="assets/' + tool + '.png" alt=""><span>' + x + ', ' + z + '</span>';
      }
    }
    if (!drag) return;
    const dx = ev.clientX - drag.x,
      dz = ev.clientY - drag.y;
    if (Math.hypot(dx, dz) > 4) drag.moved = true;
    if (drag.pan || (tool === 'select' && !drag.b && drag.moved)) {
      centerX = drag.cx - dx / (zoom * cellX);
      centerZ = drag.cz - dz / (zoom * cellZ);
      renderBoard();
    }
  });
  $board.addEventListener('pointerup', (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.pan) return;
    const [x, z] = pointerCell(ev);
    if (d.moved) {
      if (d.b && tool === 'select') move(d.b, x, z);
      return;
    }
    if (d.b) {
      if (tool === 'erase') remove(d.b);
      else selectBlock(d.b);
    } else if (Object.hasOwn(types, tool) && !at(x, z)) addAt(x, z);
  });
  $board.addEventListener('pointercancel', () => (drag = null));
  $board.addEventListener('click', (ev) => {
    if (ev.detail === 0) {
      const el = ev.target.closest('[data-node]');
      if (el) selectBlock(blocks.find((b) => key(b) === el.dataset.node));
    }
  });
  $board.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      shiftZoom(ev.deltaY < 0 ? 1.08 : 1 / 1.08);
    },
    { passive: false },
  );
  document.addEventListener('keydown', (ev) => {
    if ($('#manual').open) return;
    if (ev.target.closest('input,textarea,select')) {
      if (ev.ctrlKey && ev.key === 'Enter' && ev.target.id === 'code') {
        ev.preventDefault();
        runSelected();
      }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const keys = {
      v: 'select',
      h: 'pan',
      x: 'erase',
      1: 'impulse',
      2: 'chain',
      3: 'repeat',
      Escape: 'select',
    };
    if (keys[ev.key]) setTool(keys[ev.key]);
    if (ev.key === 'Delete') {
      ev.preventDefault();
      remove(selected);
    }
  });
  loadProject(saved.last?.[ed] || 'intro', true);
  new ResizeObserver(() => {
    fit();
    renderBoard();
  }).observe($board);
})();
