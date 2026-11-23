'use strict';
(() => {
  const {
    requireThat: check,
    register,
    int,
    number,
    range,
    select,
    targets,
    coords,
    blockAt,
    rich,
    snbt,
    id,
  } = MC;
  const obj = (w, name) => {
    const o = w.scores.get(name);
    check(o, '计分项不存在：' + name);
    return o;
  };
  function holders(w, token, c) {
    check(token, '缺少分数持有者');
    if (token === '*') return [...new Set([...w.scores.values()].flatMap((o) => [...o.values.keys()]))];
    return token.startsWith('@') ? targets(w, token, c).map((e) => e.name) : [token.replace(/^"|"$/g, '')];
  }
  function singleScore(w, h, n, c) {
    const names = holders(w, h, c);
    check(names.length === 1, '比较分数时需要一个目标');
    const value = obj(w, n).values.get(names[0]);
    check(value !== undefined, '目标还没有分数');
    return value;
  }
  const within = (a, lo, hi) => a >= lo && a <= hi;
  register('scoreboard', (w, a, c) => {
    const [group, op, ...v] = a,
      je = w.edition === 'JE';
    let n = 0;
    if (group === 'objectives') {
      if (op === 'list' && !v.length) return [...w.scores.keys()].join('、') || '没有计分项';
      if (op === 'add') {
        check(
          v.length >= 2 && v[0] && ['dummy', ...(je ? ['trigger'] : [])].includes(v[1]),
          '支持 dummy' + (je ? '、trigger' : '') + ' 计分项',
        );
        check(!w.scores.has(v[0]), '计分项已存在：' + v[0]);
        const raw = v.slice(2).join(' '),
          name = raw ? (je ? rich(snbt(raw), w, c) : raw.replace(/^"|"$/g, '')) : v[0];
        w.scores.set(v[0], { name, criteria: v[1], values: new Map(), enabled: new Set() });
        return '已创建计分项 ' + name;
      }
      if (op === 'remove' && v.length === 1) {
        obj(w, v[0]);
        w.scores.delete(v[0]);
        for (const [k, val] of w.slots) if (val === v[0]) w.slots.delete(k);
        return '已删除计分项 ' + v[0];
      }
      if (op === 'setdisplay') {
        check(
          within(v.length, 1, je ? 2 : 3) &&
            ['sidebar', 'list', je ? 'below_name' : 'belowname'].includes(v[0]),
          '显示位置或参数无效',
        );
        if (v[1]) {
          const o = obj(w, v[1]);
          if (v[2]) check(['ascending', 'descending'].includes(v[2]), '排序须为 ascending 或 descending');
          o.order = v[2] || 'descending';
          w.slots.set(v[0], v[1]);
        } else w.slots.delete(v[0]);
        return '已更新显示位置 ' + v[0];
      }
      if (je && op === 'modify' && v[1] === 'displayname') {
        obj(w, v[0]).name = rich(snbt(v.slice(2).join(' ')), w, c);
        return '已更新计分项名称';
      }
    }
    if (group === 'players') {
      if (op === 'list') {
        check(v.length <= 1, 'players list 参数过多');
        if (!v.length) return holders(w, '*', c).join('、') || '没有分数记录';
        const h = holders(w, v[0], c)[0];
        return (
          [...w.scores]
            .filter(([, o]) => o.values.has(h))
            .map(([k, o]) => k + '=' + o.values.get(h))
            .join('，') || '没有分数记录'
        );
      }
      if (op === 'get' && je && v.length === 2) {
        const value = singleScore(w, ...v, c);
        return { message: v[0] + ' = ' + value, value };
      }
      if (op === 'reset' && within(v.length, 1, 2)) {
        const names = holders(w, v[0], c),
          os = v[1] ? [obj(w, v[1])] : [...w.scores.values()];
        for (const o of os) for (const h of names) o.values.delete(h);
        return '分数已重置';
      }
      if (op === 'enable' && je && v.length === 2) {
        const o = obj(w, v[1]);
        check(o.criteria === 'trigger', '计分项需要 trigger 准则');
        for (const h of holders(w, v[0], c)) o.enabled.add(h);
        return '已允许触发';
      }
      if (['add', 'set', 'remove', 'random', 'test'].includes(op)) {
        const extra = ['random', 'test'].includes(op);
        check(extra ? !je && within(v.length, 3, 4) : v.length === 3, '计分参数不适用于当前版本');
        const o = obj(w, v[1]),
          names = holders(w, v[0], c),
          x = v[2] === '*' && op === 'test' ? -2147483648 : int(v[2]),
          y = v[3] && v[3] !== '*' ? int(v[3]) : 2147483647;
        if (op === 'test') {
          check(
            names.some((h) => o.values.has(h) && within(o.values.get(h), x, y)),
            '没有分数落入指定区间',
          );
          return '分数检测成功';
        }
        if (op === 'random') check(v.length === 4 && y >= x, '随机范围无效');
        for (const h of names) {
          const prev = o.values.get(h) || 0;
          n =
            op === 'set'
              ? x
              : op === 'random'
                ? x + Math.floor(Math.random() * (y - x + 1))
                : prev + (op === 'add' ? x : -x);
          o.values.set(h, n | 0);
        }
        return { message: names.join('、') + ' · ' + o.name + ' = ' + (n | 0), value: n | 0 };
      }
      if (op === 'operation' && v.length === 5) {
        const o = obj(w, v[1]),
          src = obj(w, v[4]),
          ts = holders(w, v[0], c),
          ss = holders(w, v[3], c),
          op2 = v[2];
        check(['+=', '-=', '*=', '/=', '%=', '=', '<', '>', '><'].includes(op2), '未知计分运算');
        for (const h of ts)
          for (const s of ss) {
            const y = src.values.get(s) ?? 0;
            if (['/=', '%='].includes(op2)) check(y !== 0, '除数不能为零');
          }
        for (const h of ts)
          for (const s of ss) {
            const x = o.values.get(h) || 0,
              y = src.values.get(s) || 0;
            n = {
              '+=': x + y,
              '-=': x - y,
              '*=': Math.imul(x, y),
              '/=': Math.floor(x / y),
              '%=': x - Math.floor(x / y) * y,
              '=': y,
              '<': Math.min(x, y),
              '>': Math.max(x, y),
              '><': y,
            }[op2];
            if (op2 === '><') src.values.set(s, x);
            o.values.set(h, n | 0);
          }
        return { message: '计分运算结果 ' + (n | 0), value: n | 0 };
      }
    }
    throw Error('此 scoreboard 子命令或参数尚未支持');
  });
  register('trigger', (w, a, c) => {
    const e = targets(w, '@s', c, true)[0],
      o = obj(w, a[0]);
    check(o.criteria === 'trigger' && o.enabled.has(e.name), '目标没有获准触发此计分项');
    check(a.length === 1 || (a.length === 3 && ['set', 'add'].includes(a[1])), 'trigger 参数错误');
    const x = int(a[2] ?? 1);
    o.values.set(e.name, (a[1] === 'set' ? x : (o.values.get(e.name) || 0) + x) | 0);
    o.enabled.delete(e.name);
    return '已触发 ' + o.name;
  });
  register('execute', (w, a, c) => {
    let contexts = [{ ...c, depth: c.depth + 1 }],
      i = 0,
      condition = false;
    function expand(fn) {
      const next = [];
      for (const x of contexts) {
        next.push(...fn(x));
        check(next.length <= 512, 'execute 分支数量超过上限');
      }
      contexts = next;
    }
    while (i < a.length) {
      const sub = a[i++];
      if (sub === 'run') {
        check(a[i], 'run 后缺少指令');
        check(contexts.length, '执行条件未满足');
        const results = contexts.map((x) => MC.execute(w, a.slice(i).join(' '), x)),
          ok = results.filter((r) => r.ok);
        return ok.length
          ? {
              message: ok.at(-1).message + (ok.length > 1 ? '（' + ok.length + ' 个分支）' : ''),
              value: ok.reduce((s, r) => s + r.value, 0),
            }
          : results[0];
      }
      if (sub === 'as' || sub === 'at') {
        const s = a[i++];
        expand((x) =>
          select(w, s, x).map((e) =>
            sub === 'as'
              ? { ...x, self: e }
              : { ...x, pos: e.pos, dimension: e.dimension, rotation: e.rotation },
          ),
        );
      } else if (sub === 'positioned') {
        if (a[i] === 'as') {
          const s = a[++i];
          i++;
          expand((x) => select(w, s, x).map((e) => ({ ...x, pos: e.pos })));
        } else {
          const pos = a.slice(i, i + 3);
          i += 3;
          expand((x) => [{ ...x, pos: coords(pos, x.pos, x.rotation) }]);
        }
      } else if (sub === 'rotated') {
        if (a[i] === 'as') {
          const s = a[++i];
          i++;
          expand((x) => select(w, s, x).map((e) => ({ ...x, rotation: [...e.rotation] })));
        } else {
          const angles = a.slice(i, i + 2);
          i += 2;
          check(angles.length === 2, 'rotated 需要水平角和俯仰角');
          expand((x) => [
            {
              ...x,
              rotation: angles.map((t, j) =>
                t.startsWith('~')
                  ? (x.rotation?.[j] || 0) + (t.length > 1 ? number(t.slice(1)) : 0)
                  : number(t),
              ),
            },
          ]);
        }
      } else if (sub === 'facing') {
        const entityMode = a[i] === 'entity';
        let token, anchor, pos;
        if (entityMode) {
          i++;
          token = a[i++];
          anchor = a[i++];
          check(['feet', 'eyes'].includes(anchor), 'facing entity 需要 feet 或 eyes');
        } else {
          pos = a.slice(i, i + 3);
          i += 3;
        }
        expand((x) =>
          (entityMode
            ? select(w, token, x).map((e) => [e.pos[0], e.pos[1] + (anchor === 'eyes' ? 1.62 : 0), e.pos[2]])
            : [coords(pos, x.pos, x.rotation)]
          ).map((p) => {
            const [dx, dy, dz] = p.map((v, j) => v - x.pos[j]);
            return {
              ...x,
              rotation: [
                (Math.atan2(-dx, dz) * 180) / Math.PI,
                (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
              ],
            };
          }),
        );
      } else if (sub === 'store' && w.edition === 'JE') {
        const [mode, kind, h, n] = a.slice(i, i + 4);
        i += 4;
        check(
          ['result', 'success'].includes(mode) && kind === 'score' && n,
          '支持 store result/success score <目标> <计分项>',
        );
        const o = obj(w, n),
          rest = a.slice(i).join(' ');
        check(rest, 'store 后缺少后续指令');
        check(contexts.length, '执行条件未满足');
        const results = contexts.map((x) => {
          const hs = holders(w, h, x),
            r = MC.execute(w, 'execute ' + rest, x);
          const v = mode === 'success' ? Number(r.ok) : r.value;
          for (const name of hs) o.values.set(name, v | 0);
          return r;
        });
        const good = results.filter((r) => r.ok);
        return good.length
          ? { message: good.at(-1).message, value: good.reduce((s, r) => s + r.value, 0) }
          : results[0];
      } else if (sub === 'align') {
        const axes = a[i++];
        check(/^[xyz]{1,3}$/.test(axes), 'align 需要坐标轴');
        expand((x) => [{ ...x, pos: x.pos.map((p, j) => (axes.includes('xyz'[j]) ? Math.floor(p) : p)) }]);
      } else if (sub === 'in') {
        const d = id(a[i++]);
        check(
          [
            'overworld',
            'the_nether',
            'the_end',
            ...(w.edition === 'BE' ? ['nether', 'the_end'] : []),
          ].includes(d),
          '未知维度',
        );
        const dim = d === 'nether' ? 'the_nether' : d;
        expand((x) => {
          const scale = (x.dimension === 'the_nether' ? 8 : 1) / (dim === 'the_nether' ? 8 : 1);
          return [{ ...x, dimension: dim, pos: [x.pos[0] * scale, x.pos[1], x.pos[2] * scale] }];
        });
      } else if (sub === 'if' || sub === 'unless') {
        condition = true;
        const type = a[i++];
        let test;
        if (type === 'entity') {
          const s = a[i++];
          test = (x) => select(w, s, x).length > 0;
        } else if (type === 'block') {
          const pos = a.slice(i, i + 3),
            block = MC.known(w, 'blocks', a[i + 3]);
          i += 4;
          test = (x) => blockAt(w, coords(pos, x.pos, x.rotation), x.dimension) === block;
        } else if (type === 'score') {
          const [h, n, op] = a.slice(i, i + 3);
          i += 3;
          const h2 = a[i++],
            n2 = op === 'matches' ? null : a[i++];
          check(['matches', '=', '<', '>', '<=', '>='].includes(op), '未知分数比较符');
          test = (x) => {
            try {
              const v = singleScore(w, h, n, x);
              if (op === 'matches') return range(v, h2);
              const y = singleScore(w, h2, n2, x);
              return { '=': v === y, '<': v < y, '>': v > y, '<=': v <= y, '>=': v >= y }[op];
            } catch (e) {
              if (e.message === '目标还没有分数') return false;
              throw e;
            }
          };
        } else throw Error('尚未模拟 execute 条件 ' + type);
        contexts = contexts.filter((x) => test(x) === (sub === 'if'));
      } else throw Error('尚未模拟 execute 子命令 ' + sub);
    }
    check(condition && contexts.length, '缺少 run 或执行条件未满足');
    return { message: '条件成立', value: contexts.length };
  });
})();
