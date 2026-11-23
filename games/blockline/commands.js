'use strict';
const WorldCommands = (() => {
  const {
    register,
    requireThat: check,
    int,
    number,
    id,
    known,
    targets,
    select,
    coords,
    blockAt,
    setBlock,
    entity,
    snbt,
    rich,
    textArg,
    copy,
  } = MC;
  const exact = (a, min, max = min) =>
    check(a.length >= min && a.length <= max, '参数数量错误，请查看指令目录中的示例');
  const oneOf = (v, values) => {
    check(values.includes(v), '可用值：' + values.join(' / '));
    return v;
  };
  const pl = (w, s, c) => targets(w, s, c, true);
  const names = (list) => list.map((e) => e.name).join('、');
  const coord = (a, c) => coords(a, c.pos, c.rotation).map(Math.floor);
  function event(w, type, detail, entity) {
    w.events.push({ tick: w.tick, type, detail, entity });
    if (w.events.length > 80) w.events.shift();
  }
  function chat(w, msg, to) {
    w.chat.push({ tick: w.tick, msg, to });
    if (w.chat.length > 100) w.chat.shift();
    return msg;
  }
  const resolveMsg = (w, msg, c) => msg.replace(/@[pares](?:\[[^\]]*\])?/g, (s) => names(select(w, s, c)));
  register('say me tell msg w teammsg tm tellraw', (w, a, c, cmd) => {
    let to = null,
      body,
      from = c.self?.name || '命令方块';
    if (['tell', 'msg', 'w', 'tellraw'].includes(cmd)) {
      to = pl(w, a[0], c).map((e) => e.name);
      body = a.slice(1).join(' ');
    } else {
      body = a.join(' ');
      if (cmd === 'teammsg' || cmd === 'tm') {
        check(c.self?.team, '执行者未加入队伍');
        to = w.entities.filter((e) => e.team === c.self.team).map((e) => e.name);
      }
    }
    check(body, '缺少消息');
    const msg =
      cmd === 'tellraw'
        ? textArg(body, w, c).text
        : (cmd === 'me' ? '* ' + from + ' ' : '[' + from + '] ') + resolveMsg(w, body, c);
    return chat(w, msg, to);
  });
  register('title titleraw', (w, a, c, cmd) => {
    const list = pl(w, a[0], c),
      mode = a[1];
    oneOf(mode, ['clear', 'reset', 'times', 'title', 'subtitle', 'actionbar']);
    let val;
    if (mode === 'times') {
      exact(a, 5);
      val = a.slice(2).map((x) => int(x, 0));
    } else if (['clear', 'reset'].includes(mode)) exact(a, 2);
    else val = textArg(a.slice(2).join(' '), w, c, w.edition === 'BE' && cmd === 'title' ? 'plain' : 'rich');
    for (const e of list) {
      const t = e.title;
      if (mode === 'times') t.times = val;
      else if (['clear', 'reset'].includes(mode)) {
        t.title = t.subtitle = t.actionbar = '';
        t.titleParts = t.subtitleParts = t.actionbarParts = [];
        t.until = t.actionUntil = 0;
        if (mode === 'reset') t.times = [10, 70, 20];
      } else {
        t[mode] = val.text;
        t[mode + 'Parts'] = val.parts;
        t[mode + 'Color'] = val.color;
        if (mode === 'title') {
          t.start = w.tick;
          t.until = w.tick + t.times.reduce((s, n) => s + n, 0);
        }
        if (mode === 'actionbar') t.actionUntil = w.tick + 60;
      }
    }
    return names(list) + ' · ' + mode + (val?.text ? ' · ' + val.text : '');
  });
  register('list', (w, a) => {
    exact(a, 0);
    return names(w.entities.filter((e) => e.type === 'player'));
  });
  register('testfor', (w, a, c) => {
    exact(a, 1);
    const list = targets(w, a[0], c);
    return { message: '检测到 ' + names(list), value: list.length };
  });
  register('tag', (w, a, c) => {
    const list = targets(w, a[0], c),
      op = oneOf(a[1], ['list', 'add', 'remove']);
    exact(a, op === 'list' ? 2 : 3);
    if (op === 'list') return [...new Set(list.flatMap((e) => e.tags))].join('、') || '没有标签';
    let count = 0;
    for (const e of list) {
      if (op === 'add' && !e.tags.includes(a[2])) {
        e.tags.push(a[2]);
        count++;
      }
      if (op === 'remove' && e.tags.includes(a[2])) {
        e.tags = e.tags.filter((t) => t !== a[2]);
        count++;
      }
    }
    check(count, '没有标签发生变化');
    return { message: '更新 ' + count + ' 个目标的标签', value: count };
  });
  register('summon', (w, a, c) => {
    check([1, 4, 5].includes(a.length), '支持 summon <实体> [x y z] 和 Java 实体数据');
    const type = known(w, 'entities', a[0]);
    check(type !== 'player', '不能召唤玩家');
    const pos = a.length > 1 ? coords(a.slice(1, 4), c.pos, c.rotation) : c.pos;
    let data = {};
    if (a[4]) {
      check(w.edition === 'JE', '此基岩版召唤格式尚未支持');
      data = snbt(a[4]);
      check(data && typeof data === 'object' && !Array.isArray(data), '需要实体数据对象');
    }
    const e = entity(
      w,
      type,
      data.CustomName ? rich(data.CustomName, w, c) : type + '#' + (w.serial + 1),
      pos,
    );
    e.dimension = c.dimension;
    e.nbt = data;
    if (Array.isArray(data.Tags)) e.tags = [...data.Tags];
    return '已召唤 ' + e.name;
  });
  register('teleport tp', (w, a, c) => {
    let from,
      dest,
      dim = c.dimension;
    const coordinate = (x) => /^[~^+\-.\d]/.test(x || '');
    if (a.length === 1 || (a.length === 3 && coordinate(a[0]))) {
      from = targets(w, '@s', c);
      dest = a;
    } else {
      from = targets(w, a[0], c);
      dest = a.slice(1);
    }
    let pos, rot;
    if (dest.length === 1) {
      const p = targets(w, dest[0], c);
      check(p.length === 1, '传送目的地需要单个实体');
      pos = p[0].pos;
      dim = p[0].dimension;
    } else {
      check([3, 5].includes(dest.length), '支持坐标或单个目标作为目的地');
      pos = coords(dest.slice(0, 3), c.pos, c.rotation);
      if (dest.length === 5) rot = dest.slice(3).map((x) => number(x));
    }
    for (const e of from) {
      e.pos = [...pos];
      e.dimension = dim;
      if (rot) e.rotation = [...rot];
    }
    return names(from) + ' → ' + pos.join(' ');
  });
  register('kill damage', (w, a, c, cmd) => {
    if (cmd === 'kill') exact(a, 0, 1);
    else exact(a, 2, 3);
    const list = targets(w, a[0] || '@s', c),
      damage = cmd === 'kill' ? Infinity : number(a[1], 0);
    for (const e of list) e.hp = Math.max(0, e.hp - damage);
    w.entities = w.entities.filter((e) => e.hp > 0);
    return names(list) + (cmd === 'kill' ? ' 已死亡' : ' 受到 ' + damage + ' 点伤害');
  });
  const modes = ['survival', 'creative', 'adventure', 'spectator'];
  register('gamemode defaultgamemode', (w, a, c, cmd) => {
    exact(a, 1, cmd === 'gamemode' ? 2 : 1);
    const m = oneOf(a[0], modes);
    if (cmd === 'defaultgamemode') w.defaultMode = m;
    else for (const e of pl(w, a[1] || '@s', c)) e.mode = m;
    return '游戏模式 → ' + m;
  });
  register('difficulty', (w, a) => {
    exact(a, 0, 1);
    if (a[0]) w.difficulty = oneOf(a[0], ['peaceful', 'easy', 'normal', 'hard']);
    return w.difficulty;
  });
  register('effect', (w, a, c) => {
    const je = w.edition === 'JE',
      clear = je ? a[0] === 'clear' : a[1] === 'clear';
    if (je) oneOf(a[0], ['give', 'clear']);
    const list = targets(w, (je ? a[1] : a[0]) || '@s', c),
      effect = id(a[je ? 2 : clear ? 2 : 1]);
    if (clear) {
      exact(a, je ? 1 : 2, 3);
      for (const e of list) {
        if (effect) delete e.effects[effect];
        else e.effects = Object.create(null);
      }
      return '已清除状态效果';
    }
    const i = je ? 3 : 2;
    exact(a, i, i + 3);
    check(MC_DATA.effects.includes(effect), '未知状态效果：' + effect);
    const sec = a[i] === 'infinite' ? Infinity : int(a[i] ?? 30, 0, 1000000),
      amplifier = int(a[i + 1] ?? 0, 0, 255);
    if (a[i + 2]) oneOf(a[i + 2], ['true', 'false']);
    for (const e of list) e.effects[effect] = { until: w.tick + sec * 20, amplifier };
    return names(list) + ' · ' + effect + ' ' + (amplifier + 1);
  });
  register('experience xp', (w, a, c) => {
    if (w.edition === 'BE') {
      exact(a, 1, 2);
      const levels = /l$/i.test(a[0]),
        n = int(a[0].replace(/l$/i, '')),
        list = pl(w, a[1] || '@s', c);
      for (const e of list) e[levels ? 'level' : 'xp'] = Math.max(0, e[levels ? 'level' : 'xp'] + n);
      return '经验已更新 ' + n;
    }
    const op = oneOf(a[0], ['add', 'set', 'query']),
      q = op === 'query';
    exact(a, q ? 3 : 3, q ? 3 : 4);
    const field = oneOf(a[q ? 2 : 3] || 'points', ['levels', 'points']) === 'levels' ? 'level' : 'xp',
      list = pl(w, a[1], c);
    if (q) {
      check(list.length === 1, '查询需要单个玩家');
      return { message: String(list[0][field]), value: list[0][field] };
    }
    const n = int(a[2], op === 'set' ? 0 : -2147483648);
    for (const e of list) e[field] = Math.max(0, op === 'add' ? e[field] + n : n);
    return '经验已更新 ' + n;
  });
  register('spawnpoint setworldspawn clearspawnpoint', (w, a, c, cmd) => {
    if (cmd === 'setworldspawn') {
      check([0, 3].includes(a.length), '支持 setworldspawn [x y z]');
      w.spawn = a.length ? coord(a, c) : c.pos.map(Math.floor);
      return '世界出生点 ' + w.spawn.join(' ');
    }
    if (cmd === 'clearspawnpoint') {
      exact(a, 0, 1);
      for (const e of pl(w, a[0] || '@s', c)) delete e.spawn;
      return '重生点已清除';
    }
    check([0, 1, 4].includes(a.length), '支持 spawnpoint [玩家] [x y z]');
    const pos = a.length === 4 ? coord(a.slice(1), c) : c.pos.map(Math.floor);
    for (const e of pl(w, a[0] || '@s', c)) e.spawn = [...pos];
    return '重生点 ' + pos.join(' ');
  });
  register('time', (w, a) => {
    exact(a, 2);
    const [op, v] = a;
    if (op === 'query') {
      oneOf(v, ['daytime', 'day', 'gametime']);
      const val = v === 'day' ? Math.floor(w.time / 24000) : v === 'gametime' ? w.tick : w.time % 24000;
      return { value: val, message: String(val) };
    }
    oneOf(op, ['set', 'add']);
    const times = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunset: 12000, sunrise: 23000 };
    const n = op === 'set' && Object.hasOwn(times, v) ? times[v] : int(v, 0);
    w.time = op === 'set' ? n : w.time + n;
    return '世界时间 ' + w.time;
  });
  register('weather', (w, a) => {
    exact(a, 1, 2);
    if (a[0] === 'query' && w.edition === 'BE') return w.weather;
    const kind = oneOf(a[0], ['clear', 'rain', 'thunder']);
    const dur = a[1] ? int(a[1], 1) : 0;
    w.weather = kind;
    w.weatherUntil = dur ? w.tick + dur * 20 : 0;
    return '天气 → ' + kind;
  });
  register('toggledownfall', (w, a) => {
    exact(a, 0);
    w.weather = w.weather === 'clear' ? 'rain' : 'clear';
    return w.weather;
  });
  register('daylock', (w, a) => {
    exact(a, 0, 1);
    const b = oneOf(a[0] || 'true', ['true', 'false']) === 'true';
    w.rules.doDaylightCycle = !b;
    if (b) w.time = 6000;
    return '日夜循环 ' + !b;
  });
  const rules = {
    doDaylightCycle: true,
    doWeatherCycle: true,
    keepInventory: false,
    commandBlockOutput: true,
    sendCommandFeedback: true,
    doMobSpawning: true,
    mobGriefing: true,
    doFireTick: true,
    doMobLoot: true,
    doTileDrops: true,
    doEntityDrops: true,
    showDeathMessages: true,
    fallDamage: true,
    fireDamage: true,
    drowningDamage: true,
    naturalRegeneration: true,
    randomTickSpeed: 3,
    maxCommandChainLength: 65536,
    showCoordinates: false,
    doImmediateRespawn: false,
    pvp: true,
  };
  register('gamerule', (w, a) => {
    exact(a, 1, 2);
    const key = Object.keys(rules).find((k) =>
      w.edition === 'BE' ? k.toLowerCase() === a[0].toLowerCase() : k === a[0],
    );
    check(key, '尚未模拟此游戏规则');
    if (a[1] !== undefined)
      w.rules[key] =
        typeof rules[key] === 'boolean' ? oneOf(a[1], ['true', 'false']) === 'true' : int(a[1], 0);
    return key + ' = ' + (w.rules[key] ?? rules[key]);
  });
  const region = (p, q) => {
    const lo = p.map((v, i) => Math.min(v, q[i])),
      hi = p.map((v, i) => Math.max(v, q[i]));
    check(hi.reduce((n, v, i) => n * (1 + v - lo[i]), 1) <= 32768, '区域上限为 32768 个方块');
    const points = [];
    for (let x = lo[0]; x <= hi[0]; x++)
      for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) points.push([x, y, z]);
    return { lo, hi, points };
  };
  register('setblock fill', (w, a, c, cmd) => {
    const fill = cmd === 'fill',
      i = fill ? 6 : 3;
    exact(a, i + 1, i + (fill ? 3 : 2));
    const p = coord(a.slice(0, 3), c),
      q = fill ? coord(a.slice(3, 6), c) : p,
      t = known(w, 'blocks', a[i]),
      mode = oneOf(
        a[i + 1] || 'replace',
        fill ? ['replace', 'keep', 'outline', 'hollow', 'destroy'] : ['replace', 'keep', 'destroy'],
      ),
      filter = a[i + 2] ? known(w, 'blocks', a[i + 2]) : null;
    check(!filter || mode === 'replace', '过滤器只适用于 replace');
    const { lo, hi, points } = region(p, q),
      updates = [];
    for (const pos of points) {
      const prev = blockAt(w, pos, c.dimension),
        edge = pos.some((v, k) => v === lo[k] || v === hi[k]);
      if ((mode === 'keep' && prev !== 'air') || (filter && prev !== filter) || (mode === 'outline' && !edge))
        continue;
      const value = mode === 'hollow' && !edge ? 'air' : t;
      if (prev !== value) updates.push([pos, value]);
    }
    check(updates.length, '没有方块发生变化');
    const added = updates.filter(([pos, v]) => v !== 'air' && blockAt(w, pos, c.dimension) === 'air').length;
    check(w.blocks.size + added <= 65536, '虚拟世界方块数量已达上限');
    for (const [pos, v] of updates) setBlock(w, pos, c.dimension, v);
    return { message: '已更新 ' + updates.length + ' 个方块', value: updates.length };
  });
  register('testforblock', (w, a, c) => {
    exact(a, 4);
    const b = known(w, 'blocks', a[3]);
    check(blockAt(w, coord(a.slice(0, 3), c), c.dimension) === b, '方块不匹配');
    return '方块匹配 ' + b;
  });
  register('clone testforblocks', (w, a, c, cmd) => {
    exact(a, 9, 10);
    const src = coord(a.slice(0, 3), c),
      end = coord(a.slice(3, 6), c),
      to = coord(a.slice(6, 9), c),
      { lo, points } = region(src, end),
      test = cmd === 'testforblocks',
      mode = oneOf(a[9] || (test ? 'all' : 'replace'), test ? ['all', 'masked'] : ['replace', 'masked']);
    const entries = points
      .map((p) => [p.map((v, i) => to[i] + v - lo[i]), blockAt(w, p, c.dimension)])
      .filter(([, b]) => mode !== 'masked' || b !== 'air');
    if (test)
      check(
        entries.every(([p, b]) => blockAt(w, p, c.dimension) === b),
        '区域方块不一致',
      );
    else {
      check(
        w.blocks.size +
          entries.filter(([p, b]) => b !== 'air' && blockAt(w, p, c.dimension) === 'air').length <=
          65536,
        '虚拟世界方块数量已达上限',
      );
      for (const [p, b] of entries) setBlock(w, p, c.dimension, b);
    }
    return { message: (test ? '区域匹配 ' : '已复制 ') + entries.length + ' 个方块', value: entries.length };
  });
  register('playsound stopsound particle', (w, a, c, cmd) => {
    let list = [],
      detail;
    if (cmd === 'playsound') {
      const je = w.edition === 'JE',
        i = je ? 2 : 1;
      exact(a, je ? 3 : 1, i + 7);
      if (je)
        oneOf(a[1], [
          'master',
          'music',
          'record',
          'weather',
          'block',
          'hostile',
          'neutral',
          'player',
          'ambient',
          'voice',
        ]);
      list = pl(w, a[i] || '@s', c);
      if (a.length > i + 1) {
        check(a.length >= i + 4, '需要完整播放坐标');
        coords(a.slice(i + 1, i + 4), c.pos, c.rotation);
        a.slice(i + 4).forEach((n) => number(n, 0));
      }
      detail = a[0];
      for (const e of list) {
        e.sounds ??= new Set();
        e.sounds.add(detail);
      }
    }
    if (cmd === 'stopsound') {
      exact(a, 1, w.edition === 'JE' ? 3 : 2);
      list = pl(w, a[0], c);
      detail = a[w.edition === 'JE' ? 2 : 1];
      for (const e of list) {
        if (detail) e.sounds?.delete(detail);
        else e.sounds?.clear();
      }
    }
    if (cmd === 'particle') {
      check([1, 4, ...(w.edition === 'JE' ? [9, 10, 11] : [])].includes(a.length), '粒子参数格式未支持');
      if (a.length >= 4) coords(a.slice(1, 4), c.pos, c.rotation);
      if (a.length >= 9) {
        a.slice(4, 8).forEach((n) => number(n));
        int(a[8], 0);
      }
      if (a[9]) oneOf(a[9], ['normal', 'force']);
      if (a[10]) list = pl(w, a[10], c);
      detail = a[0];
    }
    event(
      w,
      cmd,
      detail || '全部',
      list.map((e) => e.name),
    );
    return '预览事件 ' + cmd + ' · ' + (detail || '全部');
  });
  register('recipe', (w, a, c) => {
    exact(a, 3);
    oneOf(a[0], ['give', 'take']);
    for (const e of pl(w, a[1], c)) {
      if (a[0] === 'give' && !e.recipes.includes(a[2])) e.recipes.push(a[2]);
      if (a[0] === 'take') e.recipes = a[2] === '*' ? [] : e.recipes.filter((x) => x !== a[2]);
    }
    return '配方 ' + a[0] + ' ' + a[2];
  });
  register('ride', (w, a, c) => {
    const list = targets(w, a[0], c),
      je = w.edition === 'JE',
      op = oneOf(a[1], je ? ['mount', 'dismount'] : ['start_riding', 'stop_riding']);
    if (['mount', 'start_riding'].includes(op)) {
      exact(a, 3);
      const mount = targets(w, a[2], c);
      check(mount.length === 1 && !list.includes(mount[0]), '需要一个不同的坐骑');
      for (const e of list) e.vehicle = mount[0].uid;
    } else {
      exact(a, 2);
      for (const e of list) delete e.vehicle;
    }
    return '已更新骑乘关系';
  });
  register('spreadplayers', (w, a, c) => {
    const je = w.edition === 'JE';
    exact(a, je ? 6 : 5);
    const center = coords([a[0], '~', a[1]], c.pos, c.rotation),
      sep = number(a[2], 0),
      r = number(a[3], 1);
    if (je) oneOf(a[4], ['false']);
    const list = targets(w, a.at(-1), c),
      places = [];
    for (const e of list) {
      let pos;
      for (let i = 0; i < 300; i++) {
        pos = [
          center[0] + Math.floor((Math.random() * 2 - 1) * r),
          e.pos[1],
          center[2] + Math.floor((Math.random() * 2 - 1) * r),
        ];
        if (places.every((v) => Math.hypot(pos[0] - v[0], pos[2] - v[2]) >= sep)) break;
        pos = null;
      }
      check(pos, '区域太小，无法分散目标');
      places.push(pos);
    }
    list.forEach((e, i) => (e.pos = places[i]));
    return '已分散 ' + list.length + ' 个目标';
  });
  register('help', (w, a) => {
    exact(a, 0, 1);
    if (a[0]) {
      const name = id(a[0].replace(/^\//, ''));
      check(MC.handlers.has(name) && MC_DATA[w.edition].commands.includes(name), '此版本未模拟指令 ' + name);
      return '/' + name + ' · 打开指令目录查看示例';
    }
    return MC_DATA[w.edition].commands.filter((x) => MC.handlers.has(x)).join('、');
  });
  return { region, event, oneOf, exact };
})();
