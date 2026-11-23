'use strict';
const Items = (() => {
  const { requireThat: check, register, targets, id, int, split, snbt, known, copy, rich } = MC;
  const beComponents = ['can_place_on', 'can_destroy', 'item_lock', 'keep_on_death'];
  function parse(w, spec, quantity = '1', data, raw) {
    check(spec, '缺少物品 ID');
    const m = /^([a-z0-9_:./-]+)(.*)$/s.exec(spec);
    check(m, '物品格式错误');
    const item = {
      id: known(w, 'items', m[1]),
      count: int(quantity, 1, 32767),
      components: Object.create(null),
      data: 0,
    };
    if (w.edition === 'JE') {
      check(data === undefined, 'Java 版数量后没有数据值或组件参数');
      if (m[2]) {
        check(/^\[.*\]$/s.test(m[2]), 'Java 1.21.5 的物品组件写在方括号中');
        for (const pair of split(m[2].slice(1, -1), ',')) {
          const eq = pair.indexOf('=');
          check(eq > 0, '组件格式为 名称=值');
          const k = id(pair.slice(0, eq).trim());
          check(MC_DATA.components.includes(k), '未知 Java 物品组件：' + k);
          check(!Object.hasOwn(item.components, k), '组件重复：' + k);
          const value = snbt(pair.slice(eq + 1));
          if (k === 'enchantments' || k === 'stored_enchantments') {
            check(value && typeof value === 'object' && !Array.isArray(value), '附魔需要名称和等级的映射');
            for (const [enchantment, level] of Object.entries(value)) {
              check(MC_DATA.enchants.includes(id(enchantment)), '未知附魔：' + enchantment);
              int(level, 0, 255);
            }
          }
          if (k === 'lore') check(Array.isArray(value), '物品说明需要文本数组');
          if (k === 'max_stack_size') int(value, 1, 99);
          if (k === 'damage' || k === 'max_damage') int(value, k === 'damage' ? 0 : 1);
          item.components[k] = value;
        }
      }
    } else {
      check(!m[2], '基岩版在数量和数据值后填写 JSON 组件');
      item.data = int(data ?? 0, 0, 32767);
      if (raw) {
        const parsed = JSON.parse(raw);
        check(parsed && typeof parsed === 'object' && !Array.isArray(parsed), '需要组件对象');
        for (const [k, v] of Object.entries(parsed)) {
          const n = id(k);
          check(beComponents.includes(n), '基岩版 /give 未支持组件 ' + k);
          check(v && typeof v === 'object' && !Array.isArray(v), '组件需要 JSON 对象');
          if (n === 'item_lock')
            check(['lock_in_inventory', 'lock_in_slot'].includes(v.mode), '未知物品锁定模式');
          if (n === 'can_place_on' || n === 'can_destroy')
            check(
              Array.isArray(v.blocks) && v.blocks.every((x) => typeof x === 'string'),
              '组件需要 blocks 字符串数组',
            );
          item.components[n] = v;
        }
      }
    }
    return item;
  }
  const label = (item) => MC_DATA.items[item.id]?.[0] || item.id;
  function describe(item, w) {
    const c = item.components,
      base = MC_DATA.items[item.id] || [item.id, 0, [], 64],
      lines = [],
      name = rich(c.custom_name ?? c.item_name, w, MC.origin) || label(item);
    const ench = c.enchantments?.levels || c.enchantments || {};
    for (const [k, v] of Object.entries(ench))
      lines.push(['enchant', (MC_DATA.lang['enchantment.minecraft.' + id(k)] || id(k)) + ' ' + v]);
    for (const v of Array.isArray(c.lore) ? c.lore : []) lines.push(['lore', rich(v, w, MC.origin)]);
    const max = w.edition === 'JE' ? (c.max_damage ?? base[1]) : MC_DATA.BE.itemStats[item.id]?.[0] || 0;
    if (max) lines.push(['stat', '耐久度 ' + Math.max(0, max - (c.damage ?? item.data ?? 0)) + ' / ' + max]);
    if (w.edition === 'JE') {
      const attr = c.attribute_modifiers ?? base[2];
      for (const entry of Array.isArray(attr) ? attr : attr?.modifiers || []) {
        const [type, amount, op, slot] = Array.isArray(entry)
          ? entry
          : [id(entry.type), entry.amount, entry.operation, entry.slot];
        const baseAttribute =
          (Array.isArray(entry) && ['attack_damage', 'attack_speed'].includes(type)) ||
          entry.id === 'minecraft:base_attack_damage' ||
          entry.id === 'minecraft:base_attack_speed';
        const value = baseAttribute
          ? Math.round(((type === 'attack_speed' ? 4 : 1) + amount) * 1000) / 1000
          : op === 'add_value'
            ? amount
            : Math.round(amount * 10000) / 100 + '%';
        lines.push([
          'stat',
          (MC_DATA.lang['attribute.name.' + type] || type) +
            ' ' +
            (!baseAttribute && Number(amount) >= 0 ? '+' : '') +
            value +
            ' · ' +
            ({
              mainhand: '主手',
              offhand: '副手',
              head: '头部',
              chest: '胸部',
              legs: '腿部',
              feet: '脚部',
              hand: '手持',
              any: '任意槽位',
            }[slot] ||
              slot ||
              ''),
        ]);
      }
    }
    for (const [k, v] of Object.entries(c)) {
      if (w.edition === 'BE' && beComponents.includes(k)) {
        const translated = {
          keep_on_death: '死亡后保留',
          item_lock: '物品锁定',
          can_place_on: '可放置于',
          can_destroy: '可破坏',
        };
        const detail = k === 'keep_on_death' ? '' : k === 'item_lock' ? v.mode : (v.blocks || []).join('、');
        lines.push(['component', translated[k] + (detail ? ' · ' + detail : '') + ' (' + k + ')']);
        continue;
      }
      if (
        ![
          'custom_name',
          'item_name',
          'lore',
          'enchantments',
          'attribute_modifiers',
          'max_damage',
          'damage',
        ].includes(k)
      )
        lines.push(['component', k + ' ' + JSON.stringify(v)]);
    }
    if (item.data) lines.push(['stat', '数据值 ' + item.data]);
    return { name, lines };
  }
  function put(w, e, item) {
    const def = w.edition === 'JE' ? MC_DATA.items[item.id]?.[3] : MC_DATA.BE.itemStats[item.id]?.[1];
    const limit = int(item.components.max_stack_size ?? def ?? 64, 1, 99),
      signature = JSON.stringify(item.components);
    let remaining = item.count;
    for (const stack of e.inventory) {
      if (
        stack.id !== item.id ||
        stack.data !== item.data ||
        stack.count >= limit ||
        JSON.stringify(stack.components) !== signature
      )
        continue;
      const added = Math.min(remaining, limit - stack.count);
      stack.count += added;
      remaining -= added;
      if (!remaining) return;
    }
    while (remaining && e.inventory.length < 36) {
      const count = Math.min(remaining, limit);
      e.inventory.push({ ...copy(item), count });
      remaining -= count;
    }
    if (remaining) {
      w.drops ??= [];
      const dropped = w.drops.find(
        (d) =>
          d.dimension === e.dimension &&
          d.pos.join(',') === e.pos.join(',') &&
          d.item.id === item.id &&
          d.item.data === item.data &&
          JSON.stringify(d.item.components) === signature,
      );
      if (dropped) dropped.item.count += remaining;
      else
        w.drops.push({ pos: [...e.pos], dimension: e.dimension, item: { ...copy(item), count: remaining } });
    }
  }
  register('give', (w, a, c) => {
    check(a.length >= 2 && a.length <= (w.edition === 'JE' ? 3 : 5), '用法：give <玩家> <物品> [数量]');
    const list = targets(w, a[0], c, true),
      item = parse(w, ...a.slice(1));
    for (const e of list) put(w, e, item);
    return '给予 ' + list.map((e) => e.name).join('、') + ' ' + describe(item, w).name + ' × ' + item.count;
  });
  register('clear', (w, a, c) => {
    const list = targets(w, a[0] || '@s', c, true),
      je = w.edition === 'JE';
    check(a.length <= (je ? 3 : 4), 'clear 参数过多');
    const type = a[1] ? known(w, 'items', a[1]) : null,
      data = je ? -1 : int(a[2] ?? -1, -1),
      max = int(a[je ? 2 : 3] ?? -1, -1);
    let n = 0;
    for (const e of list) {
      let left = max;
      for (const v of e.inventory) {
        if ((type && type !== v.id) || (data !== -1 && data !== v.data)) continue;
        const take = left <= 0 ? v.count : Math.min(left, v.count);
        n += take;
        if (max !== 0) v.count -= take;
        if (left > 0 && (left -= take) === 0) break;
      }
      e.inventory = e.inventory.filter((v) => v.count > 0);
    }
    check(n > 0, '未找到符合条件的物品');
    return { message: (max === 0 ? '检测到 ' : '清除 ') + n + ' 件物品', value: n };
  });
  register('enchant', (w, a, c) => {
    check(a.length === 2 || a.length === 3, '用法：enchant <玩家> <附魔> [等级]');
    const ench = id(a[1]);
    check(MC_DATA.enchants.includes(ench), '未知附魔');
    const n = int(a[2] ?? 1, 1, 255),
      list = targets(w, a[0], c, true).filter((e) => e.inventory[0]);
    check(list.length, '目标手中没有物品');
    for (const e of list) {
      const comp = e.inventory[0].components;
      comp.enchantments = { ...comp.enchantments, [ench]: n };
    }
    return '主手物品已附魔 ' + ench + ' ' + n;
  });
  register('item replaceitem', (w, a, c, cmd) => {
    let target, slot, spec;
    if (cmd === 'item') {
      check(
        a[0] === 'replace' && a[1] === 'entity' && a[4] === 'with' && [6, 7].includes(a.length),
        '支持 item replace entity <目标> <槽位> with <物品> [数量]',
      );
      target = a[2];
      slot = a[3];
      spec = parse(w, a[5], a[6]);
    } else {
      check(
        a[0] === 'entity' && a.length >= 5 && a.length <= 8,
        '支持 replaceitem entity <目标> <槽位> <索引> <物品> [数量] [数据] [组件]',
      );
      target = a[1];
      slot = a[2] + '.' + int(a[3], 0);
      spec = parse(w, ...a.slice(4));
    }
    const list = targets(w, target, c);
    for (const e of list) {
      if (['weapon.mainhand', 'slot.weapon.mainhand.0', 'hotbar.0', 'slot.hotbar.0'].includes(slot))
        e.inventory.splice(0, 1, copy(spec));
      else e.equipment[slot] = copy(spec);
    }
    return '已替换槽位 ' + slot;
  });
  return { parse, describe, label, put };
})();
