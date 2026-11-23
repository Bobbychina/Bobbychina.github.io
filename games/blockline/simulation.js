'use strict';
const StudioSim = (() => {
  const types = {
    impulse: { name: '脉冲', block: 'command_block', hint: '收到信号时执行一次' },
    chain: { name: '连锁', block: 'chain_command_block', hint: '沿上一个方块继续执行' },
    repeat: { name: '循环', block: 'repeating_command_block', hint: '激活期间每刻执行' },
  };
  const dirs = { east: [1, 0], south: [0, 1], west: [-1, 0], north: [0, -1] };
  const directionNames = { east: '东', south: '南', west: '西', north: '北' };
  const key = (b) => b.x + ',' + b.z;
  const make = (x, z, type, cmd = '', dir = 'east') => ({
    x,
    z,
    type,
    cmd,
    dir,
    conditional: false,
    always: type !== 'impulse',
    powered: type === 'impulse',
    delay: 0,
  });
  function demo(edition, example = 'intro') {
    const je = edition === 'JE';
    if (example === 'empty') return [];
    if (example === 'clock')
      return [
        make(0, 0, 'impulse', 'scoreboard objectives add ticks dummy'),
        make(1, 0, 'chain', 'scoreboard objectives setdisplay sidebar ticks'),
        make(0, 1, 'repeat', 'scoreboard players add Steve ticks 1'),
        make(
          1,
          1,
          'chain',
          je ? 'title @a actionbar {text:"计时中",color:"aqua"}' : 'title @a actionbar 计时中',
        ),
      ];
    return [
      make(
        0,
        0,
        'impulse',
        je
          ? 'give @p minecraft:diamond_sword[minecraft:custom_name={text:"晨曦之刃",color:"aqua"},minecraft:enchantments={sharpness:3}] 1'
          : 'give @p minecraft:diamond_sword 1 0 {"minecraft:keep_on_death":{}}',
      ),
      make(
        1,
        0,
        'chain',
        'scoreboard objectives add points dummy ' + (je ? '{"text":"冒险积分"}' : '"冒险积分"'),
      ),
      make(2, 0, 'chain', 'scoreboard players set Steve points 10', 'south'),
      make(2, 1, 'chain', 'scoreboard objectives setdisplay sidebar points', 'west'),
      make(
        1,
        1,
        'chain',
        je
          ? 'title @a subtitle {text:"已领取初始装备",color:"white"}'
          : 'titleraw @a subtitle {"rawtext":[{"text":"已领取初始装备"}]}',
        'west',
      ),
      make(
        0,
        1,
        'chain',
        je ? 'title @a title {text:"冒险开始",color:"gold"}' : 'title @a title 冒险开始',
        'west',
      ),
    ];
  }
  function sync(w, blocks) {
    for (const b of blocks) MC.setBlock(w, [b.x, 64, b.z], 'overworld', types[b.type].block);
  }
  function log(w, where, cmd, r) {
    w.logs.push({ tick: w.tick, where, cmd, ...r });
    if (w.logs.length > 400) w.logs.splice(0, w.logs.length - 400);
  }
  function tick(w, blocks) {
    w.tick++;
    if (w.rules.doDaylightCycle) w.time++;
    if (w.weatherUntil && w.tick >= w.weatherUntil) {
      w.weather = 'clear';
      w.weatherUntil = 0;
    }
    for (const e of w.entities)
      for (const [k, v] of Object.entries(e.effects)) if (v.until <= w.tick) delete e.effects[k];
    w.pendingChains ??= new Map();
    const graph = new Map(blocks.map((b) => [key(b), b])),
      budget = { left: 4096 };
    const present = (b) => MC.blockAt(w, [b.x, 64, b.z], 'overworld') === types[b.type].block;
    function active(b) {
      return (
        b.always ||
        b.powered ||
        [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 0, 1],
          [0, 0, -1],
          [0, 1, 0],
          [0, -1, 0],
        ].some(
          ([dx, dy, dz]) => MC.blockAt(w, [b.x + dx, 64 + dy, b.z + dz], 'overworld') === 'redstone_block',
        )
      );
    }
    function fire(b) {
      const k = key(b),
        [dx, dz] = dirs[b.dir],
        behindKey = b.x - dx + ',' + (b.z - dz),
        behind = graph.get(behindKey);
      const r =
        b.conditional && (!behind || !present(behind) || !w.last.get(behindKey)?.ok)
          ? { ok: false, skipped: true, value: 0, message: '条件未满足，已跳过' }
          : MC.execute(w, b.cmd, { ...MC.origin, pos: [b.x, 64, b.z], budget });
      w.last.set(k, { ...r, tick: w.tick });
      log(w, k, b.cmd, r);
    }
    function chain(b, visited = new Set([key(b)])) {
      let count = visited.size - 1;
      while (count++ < Math.min(w.rules.maxCommandChainLength ?? 65536, 1024) && budget.left > 0) {
        const [dx, dz] = dirs[b.dir],
          next = graph.get(b.x + dx + ',' + (b.z + dz));
        if (!next || next.type !== 'chain' || !present(next)) return;
        if (visited.has(key(next))) {
          log(w, key(next), '', { ok: false, message: '命令链形成环路，本刻已停止' });
          return;
        }
        visited.add(key(next));
        b = next;
        if (active(b)) {
          if (w.edition === 'BE' && b.delay > 0) {
            if (!w.pendingChains.has(key(b))) w.pendingChains.set(key(b), { due: w.tick + b.delay, visited });
            return;
          }
          fire(b);
        } else w.last.delete(key(b));
      }
    }
    for (const [k, pending] of w.pendingChains) {
      if (pending.due > w.tick) continue;
      w.pendingChains.delete(k);
      const b = graph.get(k);
      if (b?.type === 'chain' && active(b) && present(b)) {
        fire(b);
        chain(b, pending.visited);
      }
    }
    for (const b of blocks) {
      if (b.type === 'chain' || !present(b)) continue;
      const k = key(b),
        on = active(b),
        old = w.power.get(k) || { on: false, next: 0 };
      if (on && !old.on) old.next = w.tick + (w.edition === 'BE' ? b.delay : 0);
      if (on && w.tick >= old.next) {
        fire(b);
        chain(b);
        old.next = b.type === 'repeat' ? w.tick + Math.max(1, w.edition === 'BE' ? b.delay : 0) : Infinity;
      }
      old.on = on;
      w.power.set(k, old);
    }
  }
  function fresh(edition, blocks) {
    const w = MC.world(edition);
    sync(w, blocks);
    return w;
  }
  return { types, dirs, directionNames, key, make, demo, sync, log, tick, fresh };
})();
