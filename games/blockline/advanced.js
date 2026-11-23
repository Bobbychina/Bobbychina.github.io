'use strict';
(() => {
  const {
    register,
    requireThat: check,
    number,
    int,
    id,
    targets,
    select,
    coords,
    snbt,
    rich,
    copy,
    blockAt,
    setBlock,
  } = MC;
  const { exact, oneOf, event, region } = WorldCommands;
  const one = (w, t, c) => {
    const list = targets(w, t, c);
    check(list.length === 1, '需要单个目标');
    return list[0];
  };
  register('team', (w, a, c) => {
    const [op, t, ...v] = a;
    if (op === 'list') {
      exact(a, 1, 2);
      if (!t) return [...w.teams.keys()].join('、') || '没有队伍';
      check(w.teams.has(t), '队伍不存在');
      return (
        w.entities
          .filter((e) => e.team === t)
          .map((e) => e.name)
          .join('、') || '队伍为空'
      );
    }
    if (op === 'add') {
      exact(a, 2, 3);
      check(!w.teams.has(t), '队伍已存在');
      w.teams.set(t, { name: v[0] ? rich(snbt(v[0]), w, c) : t, color: 'white' });
    } else if (op === 'leave') {
      exact(a, 2);
      for (const e of targets(w, t, c)) delete e.team;
    } else {
      check(w.teams.has(t), '队伍不存在');
      if (op === 'join') {
        exact(a, 2, 3);
        for (const e of targets(w, v[0] || '@s', c)) e.team = t;
      } else if (op === 'remove' || op === 'empty') {
        exact(a, 2);
        for (const e of w.entities) if (e.team === t) delete e.team;
        if (op === 'remove') w.teams.delete(t);
      } else if (op === 'modify') {
        exact(a, 4);
        oneOf(v[0], ['color', 'displayName', 'prefix', 'suffix']);
        w.teams.get(t)[v[0]] = v[0] === 'color' ? v[1] : rich(snbt(v[1]), w, c);
      } else throw Error('team 子命令尚未支持');
    }
    return '队伍已更新 ' + (t || '');
  });
  register('bossbar', (w, a, c) => {
    const [op, k, prop, ...v] = a;
    if (op === 'list') {
      exact(a, 1);
      return [...w.bars.keys()].join('、') || '没有 Boss 栏';
    }
    if (op === 'add') {
      exact(a, 3);
      check(!w.bars.has(k), 'Boss 栏已存在');
      w.bars.set(k, {
        name: rich(snbt(prop), w, c),
        value: 0,
        max: 100,
        color: 'white',
        visible: true,
        players: [],
      });
    } else {
      const bar = w.bars.get(k);
      check(bar, 'Boss 栏不存在');
      if (op === 'remove') {
        exact(a, 2);
        w.bars.delete(k);
      } else if (op === 'get') {
        exact(a, 3);
        oneOf(prop, ['value', 'max', 'players', 'visible']);
        return { message: String(bar[prop]), value: typeof bar[prop] === 'number' ? bar[prop] : 1 };
      } else if (op === 'set') {
        if (prop === 'players') {
          exact(a, 3, 4);
          bar.players = v[0]
            ? select(w, v[0], c)
                .filter((e) => e.type === 'player')
                .map((e) => e.uid)
            : [];
        } else {
          exact(a, 4);
          if (prop === 'max' || prop === 'value') bar[prop] = int(v[0], prop === 'max' ? 1 : 0);
          else if (prop === 'visible') bar.visible = oneOf(v[0], ['true', 'false']) === 'true';
          else if (prop === 'color')
            bar.color = oneOf(v[0], ['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'white']);
          else if (prop === 'name') bar.name = rich(snbt(v[0]), w, c);
          else throw Error('尚未支持此 Boss 栏属性');
        }
      } else throw Error('bossbar 子命令无效');
    }
    return 'Boss 栏 ' + k + ' 已更新';
  });
  register('attribute', (w, a, c) => {
    const e = one(w, a[0], c),
      k = id(a[1]);
    const defaults = {
      max_health: 20,
      attack_damage: 1,
      attack_speed: 4,
      movement_speed: 0.1,
      scale: 1,
      armor: 0,
      knockback_resistance: 0,
    };
    check(Object.hasOwn(defaults, k), '尚未模拟属性 ' + k);
    e.attributes ??= Object.create(null);
    if (a[2] === 'get' || (a[2] === 'base' && a[3] === 'get')) {
      const i = a[2] === 'base' ? 4 : 3;
      exact(a, i, i + 1);
      const n = (e.attributes[k] ?? defaults[k]) * number(a[i] ?? 1);
      return { value: Math.floor(n), message: k + ' = ' + n };
    }
    check(a[2] === 'base' && a[3] === 'set', '支持 get、base get/set');
    exact(a, 5);
    e.attributes[k] = number(a[4]);
    return k + ' = ' + a[4];
  });
  register('data', (w, a, c) => {
    const [op, type, k, ...v] = a;
    oneOf(type, ['storage', 'entity']);
    let data;
    if (type === 'entity') {
      const e = one(w, k, c);
      check(op === 'get' || e.type !== 'player', '无法改写玩家实体 NBT');
      data = e.nbt;
    } else data = w.storage.get(k) || Object.create(null);
    if (op === 'merge') {
      exact(v, 1);
      const x = snbt(v[0]);
      check(x && typeof x === 'object' && !Array.isArray(x), 'merge 需要复合标签');
      for (const [name, value] of Object.entries(x))
        Object.defineProperty(data, name, { value, enumerable: true, writable: true, configurable: true });
    } else if (op === 'get' && !v.length) return JSON.stringify(data);
    else {
      check(v[0] && /^[\w.-]+$/.test(v[0]), '支持以点分隔的简单 NBT 路径');
      const path = v[0].split('.'),
        leaf = path.pop();
      let parent = data;
      for (const key of path) {
        check(parent && Object.hasOwn(parent, key), 'NBT 路径不存在');
        parent = parent[key];
      }
      check(parent && typeof parent === 'object', '无效 NBT 路径');
      if (op === 'modify') {
        exact(v, 4);
        check(v[1] === 'set' && v[2] === 'value', '支持 modify … set value');
        Object.defineProperty(parent, leaf, {
          value: snbt(v[3]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        check(Object.hasOwn(parent, leaf), 'NBT 路径不存在');
        if (op === 'remove') {
          exact(v, 1);
          delete parent[leaf];
        } else if (op === 'get') {
          exact(v, 1, 2);
          const x = parent[leaf];
          return {
            message: JSON.stringify(x),
            value: typeof x === 'number' ? Math.floor(x * number(v[1] ?? 1)) : 1,
          };
        } else throw Error('data 子命令无效');
      }
    }
    if (type === 'storage') w.storage.set(k, data);
    return 'NBT 已更新 ' + k;
  });
  register('random', (w, a) => {
    exact(a, 2);
    oneOf(a[0], ['value', 'roll']);
    const pair = a[1].split('..');
    check(pair.length === 2, '使用 min..max');
    const lo = int(pair[0]),
      hi = int(pair[1], lo);
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (a[0] === 'roll') {
      w.chat.push({ tick: w.tick, msg: '随机结果 ' + n, to: null });
      if (w.chat.length > 100) w.chat.shift();
    }
    return { value: n, message: '随机结果 ' + n };
  });
  register('return', (w, a, c) => {
    if (a[0] === 'run') return MC.execute(w, a.slice(1).join(' '), { ...c, depth: c.depth + 1 });
    exact(a, 1);
    if (a[0] === 'fail') return { ok: false, value: 0, message: '返回失败' };
    const n = int(a[0]);
    return { value: n, message: '返回 ' + n };
  });
  register('rotate', (w, a, c) => {
    exact(a, 3);
    const list = targets(w, a[0], c),
      r = a.slice(1).map((x) => number(x));
    for (const e of list) e.rotation = [...r];
    return '朝向 ' + r.join(' ');
  });
  register('spectate', (w, a, c) => {
    exact(a, 0, 2);
    const viewer = one(w, a[1] || '@s', c);
    check(viewer.mode === 'spectator', '玩家必须处于旁观模式');
    viewer.spectating = a[0] ? one(w, a[0], c).uid : null;
    return '旁观目标已更新';
  });
  register('worldborder', (w, a, c) => {
    const b = w.border;
    if (a[0] === 'get') {
      exact(a, 1);
      return { value: Math.floor(b.size), message: '边界直径 ' + b.size };
    }
    if (a[0] === 'center') {
      exact(a, 3);
      const p = coords([a[1], '~', a[2]], c.pos, c.rotation);
      b.center = [p[0], p[2]];
    } else {
      oneOf(a[0], ['add', 'set']);
      exact(a, 2);
      const n = number(a[1]) + (a[0] === 'add' ? b.size : 0);
      check(n >= 1 && n <= 59999968, '边界直径超出范围');
      b.size = n;
    }
    return '世界边界 ' + b.size + ' · ' + b.center.join(' ');
  });
  register('seed', (w, a) => {
    exact(a, 0);
    return { value: 0, message: '此虚拟世界的种子为 0' };
  });
  register('forceload', (w, a, c) => {
    const [op, ...v] = a;
    oneOf(op, ['query', 'add', 'remove']);
    w.forced ??= new Set();
    if (op === 'query' && !v.length) return [...w.forced].join('、') || '没有强制加载区块';
    if (op === 'remove' && v.join(' ') === 'all') {
      w.forced.clear();
      return '已清空区块列表';
    }
    check([2, 4].includes(v.length), '需要 X Z [X Z]');
    const pos = (i) => {
      const p = coords([v[i], '~', v[i + 1]], c.pos, c.rotation);
      return [Math.floor(p[0] / 16), Math.floor(p[2] / 16)];
    };
    const p = pos(0),
      q = v.length === 4 ? pos(2) : p;
    check((Math.abs(p[0] - q[0]) + 1) * (Math.abs(p[1] - q[1]) + 1) <= 256, '最多选择 256 个区块');
    for (let x = Math.min(p[0], q[0]); x <= Math.max(p[0], q[0]); x++)
      for (let z = Math.min(p[1], q[1]); z <= Math.max(p[1], q[1]); z++) {
        const k = c.dimension + '/' + x + ',' + z;
        if (op === 'query') check(w.forced.has(k), '区块未强制加载');
        else if (op === 'add') w.forced.add(k);
        else w.forced.delete(k);
      }
    return '强制加载区块数 ' + w.forced.size;
  });
  register('hud', (w, a, c) => {
    exact(a, 2, 3);
    oneOf(a[1], ['hide', 'reset']);
    const element = oneOf(a[2] || 'all', [
      'all',
      'hotbar',
      'health',
      'hunger',
      'crosshair',
      'air_bubbles',
      'armor',
      'item_text',
      'paperdoll',
      'progress_bar',
      'status_effects',
      'tooltips',
      'touch_controls',
      'vehicle_health',
      'horse_health',
    ]);
    for (const e of targets(w, a[0], c, true)) {
      e.hidden ??= new Set();
      if (a[1] === 'hide') e.hidden.add(element);
      else if (element === 'all') e.hidden.clear();
      else e.hidden.delete(element);
    }
    return 'HUD ' + element + ' · ' + a[1];
  });
  register('inputpermission', (w, a, c) => {
    oneOf(a[0], ['set', 'query']);
    exact(a, a[0] === 'set' ? 4 : 3);
    const list = targets(w, a[1], c, true),
      k = oneOf(a[2], [
        'camera',
        'movement',
        'jump',
        'sneak',
        'lateral_movement',
        'forward',
        'backward',
        'left',
        'right',
        'mount',
        'dismount',
      ]);
    if (a[0] === 'query') return list.map((e) => e.name + ' ' + (e.input?.[k] || 'enabled')).join('、');
    const v = oneOf(a[3], ['enabled', 'disabled']);
    for (const e of list) {
      e.input ??= Object.create(null);
      e.input[k] = v;
    }
    return k + ' ' + v;
  });
  register('camera camerashake', (w, a, c, cmd) => {
    if (cmd === 'camera') {
      const list = targets(w, a[0], c, true);
      if (a[1] === 'clear') {
        exact(a, 2);
        for (const e of list) delete e.camera;
      } else {
        check(a[1] === 'set', '支持 set 和 clear');
        exact(a, 3);
        for (const e of list) e.camera = a[2];
      }
      return '摄像机预设 ' + (a[2] || '默认');
    }
    oneOf(a[0], ['add', 'stop']);
    exact(a, 2, a[0] === 'add' ? 5 : 2);
    const list = targets(w, a[1], c, true),
      strength = number(a[2] ?? 0.5, 0, 4),
      sec = number(a[3] ?? 1, 0);
    if (a[4]) oneOf(a[4], ['positional', 'rotational']);
    for (const e of list) e.shake = a[0] === 'stop' ? 0 : w.tick + sec * 20;
    event(
      w,
      cmd,
      String(strength),
      list.map((e) => e.name),
    );
    return '镜头震动 ' + a[0];
  });
  register('mobevent', (w, a) => {
    exact(a, 1, 2);
    const k = oneOf(id(a[0]), [
      'events_enabled',
      'pillager_patrols_event',
      'wandering_trader_event',
      'ender_dragon_event',
    ]);
    w.mobevents ??= Object.create(null);
    if (a[1]) w.mobevents[k] = oneOf(a[1], ['true', 'false']) === 'true';
    return k + ' = ' + (w.mobevents[k] ?? true);
  });
  register('tickingarea', (w, a, c) => {
    if (a[0] === 'list') {
      exact(a, 1);
      return [...w.areas.keys()].join('、') || '没有常加载区域';
    }
    if (a[0] === 'remove_all') {
      exact(a, 1);
      w.areas.clear();
    } else if (a[0] === 'remove') {
      exact(a, 2);
      check(w.areas.delete(a[1]), '区域不存在');
    } else {
      check(a[0] === 'add', '未知区域操作');
      exact(a, 7, 8);
      const p = coords(a.slice(1, 4), c.pos, c.rotation),
        q = coords(a.slice(4, 7), c.pos, c.rotation),
        k = a[7] || 'area' + (w.areas.size + 1);
      check(!w.areas.has(k), '区域重名');
      w.areas.set(k, { p, q, dimension: c.dimension });
    }
    return '常加载区域 ' + w.areas.size;
  });
  register('structure', (w, a, c) => {
    const [op, k] = a;
    if (op === 'delete') {
      exact(a, 2);
      check(w.structures.delete(k), '结构不存在');
    } else if (op === 'save') {
      exact(a, 8);
      const p = coords(a.slice(2, 5), c.pos, c.rotation).map(Math.floor),
        q = coords(a.slice(5, 8), c.pos, c.rotation).map(Math.floor),
        { lo, points } = region(p, q);
      w.structures.set(
        k,
        points.map((pos) => [pos.map((v, i) => v - lo[i]), blockAt(w, pos, c.dimension)]),
      );
    } else if (op === 'load') {
      exact(a, 5);
      const entries = w.structures.get(k);
      check(entries, '结构不存在');
      const base = coords(a.slice(2, 5), c.pos, c.rotation).map(Math.floor);
      const update = entries.map(([p, v]) => [p.map((x, i) => x + base[i]), v]);
      check(
        w.blocks.size +
          update.filter(([p, v]) => v !== 'air' && blockAt(w, p, c.dimension) === 'air').length <=
          65536,
        '虚拟世界方块数量已达上限',
      );
      for (const [p, v] of update) setBlock(w, p, c.dimension, v);
    } else throw Error('支持 structure save/load/delete');
    return '结构 ' + k + ' · ' + op;
  });
  register('music', (w, a) => {
    const op = oneOf(a[0], ['play', 'queue', 'stop', 'volume']);
    w.music ??= { queue: [], volume: 1 };
    if (op === 'volume') {
      exact(a, 2);
      w.music.volume = number(a[1], 0, 1);
    } else if (op === 'stop') {
      exact(a, 1, 2);
      if (a[1]) number(a[1], 0);
      w.music.queue = [];
    } else {
      exact(a, 2, 5);
      if (a[2]) number(a[2], 0, 1);
      if (a[3]) number(a[3], 0);
      if (a[4]) oneOf(a[4], ['loop', 'play_once']);
      if (op === 'play') w.music.queue = [];
      w.music.queue.push(a[1]);
    }
    event(w, 'music', a.join(' '), []);
    return '音乐预览事件 ' + a.join(' ');
  });
})();
