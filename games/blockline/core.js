'use strict';
const MC = (() => {
  const requireThat = (valid, message) => {
    if (!valid) throw new Error(message);
  };
  const id = (value) => String(value ?? '').replace(/^minecraft:/, '');
  const copy = (value) => structuredClone(value);
  const own = (object, key) => Object.hasOwn(object, key);
  const dict = () => Object.create(null);
  function split(source, separator = ' ') {
    const parts = [],
      stack = [];
    let start = 0,
      quote = '',
      escaped = false;
    function emit(end) {
      const s = source.slice(start, end).trim();
      if (s) parts.push(s);
      start = end + 1;
    }
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        continue;
      }
      if ('[{('.includes(c)) {
        stack.push(c);
        continue;
      }
      if (']})'.includes(c)) {
        requireThat(stack.pop() === { ']': '[', '}': '{', ')': '(' }[c], '括号不匹配');
        continue;
      }
      if (!stack.length && (separator === ' ' ? /\s/.test(c) : c === separator)) emit(i);
    }
    requireThat(!quote && !stack.length, '引号或括号未闭合');
    emit(source.length);
    return parts;
  }
  function snbt(source) {
    let p = 0;
    const ws = () => {
      while (/\s/.test(source[p] || '!')) p++;
    };
    function value(depth = 0) {
      requireThat(depth < 60, '数据嵌套过深');
      ws();
      const c = source[p++];
      if (c === '"' || c === "'") {
        let v = '';
        while (p < source.length) {
          let k = source[p++];
          if (k === c) return v;
          if (k === '\\') {
            k = source[p++];
            if (k === 'u') {
              const h = source.slice(p, p + 4);
              requireThat(/^[a-f0-9]{4}$/i.test(h), 'Unicode 转义无效');
              v += String.fromCharCode(parseInt(h, 16));
              p += 4;
              continue;
            }
            k = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[k] ?? k;
          }
          v += k;
        }
        throw Error('字符串未闭合');
      }
      if (c === '{' || c === '[') {
        const obj = c === '{' ? dict() : [],
          end = c === '{' ? '}' : ']';
        ws();
        if (c === '[' && /^[BIL];/i.test(source.slice(p, p + 2))) p += 2;
        while (source[p] !== end) {
          requireThat(p < source.length, '数据未闭合');
          let key;
          if (c === '{') {
            ws();
            if (['"', "'"].includes(source[p])) key = value(depth + 1);
            else {
              const m = /^[\w.+-]+/.exec(source.slice(p));
              requireThat(m, '缺少字段名，带命名空间的键须加引号');
              key = m[0];
              p += key.length;
            }
            ws();
            requireThat(source[p++] === ':', '字段名后缺少冒号');
          }
          const v = value(depth + 1);
          if (c === '{') obj[key] = v;
          else obj.push(v);
          ws();
          if (source[p] === end) break;
          requireThat(source[p++] === ',', '数据项之间缺少逗号');
          ws();
        }
        p++;
        return obj;
      }
      p--;
      const m = /^[^\s,\]}]+/.exec(source.slice(p));
      requireThat(m, '缺少值');
      p += m[0].length;
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[bslfd]?$/i.test(m[0]))
        return Number(m[0].replace(/[bslfd]$/i, ''));
      return m[0] === 'true' ? true : m[0] === 'false' ? false : m[0];
    }
    const result = value();
    ws();
    requireThat(p === source.length, '数据后有多余内容');
    return result;
  }
  function number(v, lo = -Infinity, hi = Infinity, integer = false) {
    requireThat(
      v !== undefined && v !== '' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(v)),
      '需要数字，收到 ' + (v ?? '空值'),
    );
    const n = Number(v);
    requireThat(
      Number.isFinite(n) && n >= lo && n <= hi && (!integer || Number.isInteger(n)),
      '数字超出范围或格式错误：' + v,
    );
    return n;
  }
  const int = (v, lo = -2147483648, hi = 2147483647) => number(v, lo, hi, true);
  function range(v, pattern) {
    if (!String(pattern).includes('..')) return v === number(pattern);
    const [a, b, ...rest] = pattern.split('..');
    requireThat(!rest.length && (a || b), '区间格式错误');
    return (a === '' || v >= number(a)) && (b === '' || v <= number(b));
  }
  function coords(args, base, rotation = [0, 0]) {
    requireThat(args.length === 3, '需要 X Y Z 三个坐标');
    let result;
    if (args.some((s) => s.startsWith('^'))) {
      requireThat(
        args.every((s) => s.startsWith('^')),
        '局部坐标 ^ 不能与其他坐标类型混用',
      );
      const [left, up, forward] = args.map((s) => (s.length === 1 ? 0 : number(s.slice(1))));
      const [yaw, pitch] = rotation.map((n) => (n * Math.PI) / 180),
        sy = Math.sin(yaw),
        cy = Math.cos(yaw),
        sp = Math.sin(pitch),
        cp = Math.cos(pitch);
      result = [
        base[0] + left * cy - up * sy * sp - forward * sy * cp,
        base[1] + up * cp - forward * sp,
        base[2] + left * sy + up * cy * sp + forward * cy * cp,
      ].map((x) => (Math.abs(x - Math.round(x)) < 1e-10 ? Math.round(x) : x));
    } else
      result = args.map((s, i) =>
        s.startsWith('~') ? base[i] + (s.length === 1 ? 0 : number(s.slice(1))) : number(s),
      );
    requireThat(
      result.every((n) => Math.abs(n) <= 30000000),
      '坐标超出模拟世界范围（±30000000）',
    );
    return result;
  }
  const key = (pos) => pos.map(Math.floor).join(',');
  function entity(world, type, name, pos) {
    requireThat(world.entities.length < 512, '模拟器最多容纳 512 个实体');
    const e = {
      uid: ++world.serial,
      type,
      name,
      pos: [...pos],
      tags: [],
      mode: 'survival',
      hp: 20,
      inventory: [],
      effects: dict(),
      level: 0,
      xp: 0,
      rotation: [0, 0],
      dimension: 'overworld',
      title: { title: '', subtitle: '', actionbar: '', times: [10, 70, 20], until: 0, actionUntil: 0 },
      equipment: dict(),
      recipes: [],
      nbt: dict(),
    };
    world.entities.push(e);
    return e;
  }
  function world(edition) {
    const w = {
      edition,
      tick: 0,
      serial: 0,
      entities: [],
      scores: new Map(),
      slots: new Map(),
      teams: new Map(),
      bars: new Map(),
      blocks: new Map(),
      storage: new Map(),
      areas: new Map(),
      structures: new Map(),
      time: 1000,
      weather: 'clear',
      difficulty: 'normal',
      spawn: [0, 64, 0],
      rules: { doDaylightCycle: true, doWeatherCycle: true, keepInventory: false, commandBlockOutput: true },
      logs: [],
      chat: [],
      events: [],
      last: new Map(),
      power: new Map(),
      border: { size: 59999968, center: [0, 0] },
      defaultMode: 'survival',
    };
    entity(w, 'player', 'Steve', [0, 64, 0]);
    entity(w, 'player', 'Alex', [8, 64, 8]);
    return w;
  }
  const origin = { pos: [0, 64, 0], rotation: [0, 0], dimension: 'overworld', self: null, depth: 0 };
  const distance = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
  function select(w, token, ctx = origin) {
    requireThat(token, '缺少目标');
    if (!token.startsWith('@')) return w.entities.filter((e) => e.name === token.replace(/^"|"$/g, ''));
    const m = /^@([pares])(?:\[(.*)\])?$/.exec(token);
    requireThat(m, '目标选择器格式无效：' + token);
    const type = m[1],
      je = w.edition === 'JE',
      p = [...ctx.pos],
      filters = [];
    let limit = 'prs'.includes(type) ? 1 : Infinity,
      sort = type === 'p' ? 'nearest' : type === 'r' ? 'random' : 'arbitrary',
      spatial = false;
    for (const part of split(m[2] || '', ',')) {
      const eq = part.indexOf('=');
      requireThat(eq > 0, '选择器缺少 =');
      const k = part.slice(0, eq).trim(),
        v = part.slice(eq + 1).trim(),
        val = v.replace(/^!/, '').replace(/^"|"$/g, '');
      const invert = v.startsWith('!'),
        matches = (fn) => filters.push((e) => Boolean(fn(e)) !== invert);
      if (['x', 'y', 'z'].includes(k)) {
        p['xyz'.indexOf(k)] = number(v);
        spatial = true;
      } else if (k === 'type') matches((e) => e.type === id(val));
      else if (k === 'name') matches((e) => e.name === val);
      else if (k === 'tag') matches((e) => (val ? e.tags.includes(val) : !e.tags.length));
      else if (k === 'team' && je) matches((e) => (e.team || '') === val);
      else if (k === (je ? 'gamemode' : 'm')) matches((e) => e.mode === val);
      else if (k === 'scores') {
        requireThat(/^\{.*\}$/.test(v), 'scores 需要花括号');
        for (const score of split(v.slice(1, -1), ',')) {
          const [obj, r] = score.split('=');
          filters.push((e) => {
            const n = w.scores.get(obj)?.values.get(e.name);
            return n !== undefined && range(n, r);
          });
        }
      } else if ((je && k === 'distance') || (!je && ['r', 'rm'].includes(k))) {
        spatial = true;
        filters.push((e) =>
          range(distance(e.pos, p), k === 'distance' ? v : k === 'r' ? '..' + v : v + '..'),
        );
      } else if (['dx', 'dy', 'dz'].includes(k)) {
        spatial = true;
        const i = 'xyz'.indexOf(k[1]),
          n = number(v);
        filters.push((e) => e.pos[i] >= p[i] + Math.min(n, 0) && e.pos[i] < p[i] + Math.max(n, 0) + 1);
      } else if (k === (je ? 'limit' : 'c')) {
        limit = int(v, je ? 1 : -512, 512);
        if (limit < 0) {
          sort = 'furthest';
          limit = -limit;
        }
      } else if (je && k === 'sort') {
        requireThat(['nearest', 'furthest', 'random', 'arbitrary'].includes(v), '未知排序');
        sort = v;
      } else if (je && k === 'level') filters.push((e) => range(e.level, v));
      else throw Error('当前版本未模拟选择器参数 ' + k);
    }
    let list = (type === 's' ? (ctx.self ? [ctx.self] : []) : w.entities).filter(
      (e) =>
        (type === 'e' || type === 's' || e.type === 'player') &&
        ((!spatial && type !== 'p' && type !== 'e') || e.dimension === ctx.dimension) &&
        filters.every((f) => f(e)),
    );
    if (sort === 'nearest' || sort === 'furthest')
      list.sort((a, b) => (distance(a.pos, p) - distance(b.pos, p)) * (sort === 'nearest' ? 1 : -1));
    if (sort === 'random')
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
    return list.slice(0, limit);
  }
  function targets(w, token, ctx, players = false) {
    const list = select(w, token, ctx).filter((e) => !players || e.type === 'player');
    requireThat(list.length, '没有匹配的' + (players ? '玩家' : '目标'));
    return list;
  }
  function rich(v, w, ctx) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map((x) => rich(x, w, ctx)).join('');
    if (typeof v !== 'object') return String(v);
    let s = v.text ?? '';
    if (v.rawtext) s = rich(v.rawtext, w, ctx);
    if (v.selector)
      s = select(w, v.selector, ctx)
        .map((e) => e.name)
        .join(', ');
    if (v.score) {
      const n = v.score.name.startsWith('@') ? select(w, v.score.name, ctx)[0]?.name : v.score.name;
      s = String(w.scores.get(v.score.objective)?.values.get(n) ?? '');
    }
    if (v.translate) {
      s = MC_DATA.lang[v.translate] || v.fallback || v.translate;
      const a = v.with?.rawtext || v.with || [];
      let i = 0;
      s = s.replace(/%(?:(\d+)\$)?s/g, (_, n) => rich(a[n ? Number(n) - 1 : i++], w, ctx));
    }
    return String(s) + rich(v.extra, w, ctx);
  }
  function textArg(raw, w, ctx, mode = 'rich') {
    requireThat(raw, '缺少文本');
    if (mode === 'plain') return { text: raw, parts: [{ text: raw }] };
    const v = w.edition === 'BE' ? JSON.parse(raw) : snbt(raw);
    if (w.edition === 'BE') requireThat(v && Array.isArray(v.rawtext), '基岩版需要 {"rawtext":[...]}');
    const parts = [];
    function walk(node, style = {}) {
      if (Array.isArray(node)) {
        for (const child of node) walk(child, style);
        return;
      }
      if (node == null) return;
      if (typeof node !== 'object') {
        parts.push({ ...style, text: String(node) });
        return;
      }
      const next = { ...style };
      for (const k of ['color', 'bold', 'italic', 'underlined', 'strikethrough'])
        if (own(node, k)) next[k] = node[k];
      if (node.rawtext) {
        walk(node.rawtext, next);
        return;
      }
      const { extra, ...base } = node;
      parts.push({ ...next, text: rich(base, w, ctx) });
      if (extra) walk(extra, next);
    }
    walk(v);
    return { text: parts.map((p) => p.text).join(''), parts, color: v?.color, bold: v?.bold };
  }
  const handlers = new Map();
  function register(names, fn) {
    for (const n of names.split(' ')) handlers.set(n, fn);
  }
  function execute(w, source, ctx = origin) {
    try {
      requireThat(source.length <= 32768, '指令过长');
      requireThat(ctx.depth < 20, 'execute 嵌套超过上限');
      if (ctx.budget) {
        requireThat(--ctx.budget.left >= 0, '本刻执行预算已用尽');
      } else ctx = { ...ctx, budget: { left: 4096 } };
      const [head, ...args] = split(source.trim().replace(/^\//, ''));
      const name = id(head);
      requireThat(head, '命令方块中还没有指令');
      const allowed =
        MC_DATA[w.edition].commands.includes(name) || (w.edition === 'BE' && own(MC_DATA.BEaliases, name));
      requireThat(allowed, '当前版本没有此指令：/' + name);
      const fn = handlers.get(name) || handlers.get(MC_DATA.BEaliases[name]);
      requireThat(fn, '尚未模拟 /' + name + ' 的执行');
      const v = fn(w, args, ctx, name);
      return typeof v === 'string' ? { ok: true, message: v, value: 1 } : { ok: true, value: 1, ...v };
    } catch (e) {
      return { ok: false, message: e.message, value: 0 };
    }
  }
  const blockAt = (w, pos, dim) => w.blocks.get(dim + ':' + key(pos)) || 'air';
  function setBlock(w, pos, dim, value) {
    const k = dim + ':' + key(pos);
    if (value === 'air') w.blocks.delete(k);
    else {
      requireThat(w.blocks.has(k) || w.blocks.size < 65536, '虚拟世界方块数量已达上限');
      w.blocks.set(k, value);
    }
  }
  function known(w, kind, value) {
    const v = id(value);
    requireThat(MC_DATA[w.edition][kind].includes(v), '当前版本没有此 ID：' + value);
    return v;
  }
  return {
    requireThat,
    id,
    copy,
    own,
    dict,
    split,
    snbt,
    number,
    int,
    range,
    coords,
    key,
    world,
    entity,
    origin,
    select,
    targets,
    rich,
    textArg,
    register,
    handlers,
    execute,
    blockAt,
    setBlock,
    known,
  };
})();
