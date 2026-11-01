(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.defineProperty(root, 'InkGuard', { value: api, writable: false, configurable: false });
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const SAVE_KEY = 'ink-fury-road-progress';
  const stringify = JSON.stringify.bind(JSON);
  const finite = Number.isFinite;
  const integer = Number.isSafeInteger;
  const freeze = Object.freeze;
  const snapshot = value => stringify(value, (_key, item) =>
    typeof item === 'number' && !finite(item) ? String(item) : item);

  function create(options) {
    const storage = options.storage;
    const get = storage.getItem.bind(storage);
    const set = storage.setItem.bind(storage);
    const permit = options.permit;
    if (!permit || typeof permit !== 'object') throw new Error('Missing private game permit');
    let config, rules, functions, state, resources, pendingResources;
    let stopped = false, punished = false, reason = null;
    let saved;
    let runId, casts = new Map(), returnAvailable = false;
    try { saved = get(SAVE_KEY); } catch { saved = undefined; }

    function screen(cheat, code) {
      const doc = options.document;
      if (!doc) return;
      const panel = doc.createElement('section');
      panel.id = 'ink-integrity-screen';
      panel.setAttribute('role', 'alertdialog');
      panel.setAttribute('aria-modal', 'true');
      panel.tabIndex = -1;
      panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;background:#302b25;color:white;text-align:center;font-family:system-ui,sans-serif';
      const title = doc.createElement('h1');
      title.textContent = cheat ? '墨迹不对劲' : '存档发生变化';
      const text = doc.createElement('p');
      text.textContent = cheat ? '检测到游戏数据或运行逻辑被修改，本局已停止。已保存的进度不会被清空。' : '另一窗口可能更新了进度，请重新进入读取存档。';
      const detail = doc.createElement('p');
      const descriptions = {
        'state-written-outside-game': '战斗数据在正常游戏流程之外被改动',
        'combat-functions-replaced': '游戏运行逻辑被替换',
        'combat-rules-changed': '招式或角色规则被改动',
        'unauthorized-guard-call': '检测到外部调用防护接口',
        'guard-rebind': '检测到重设防护基线',
        'resource-without-receipt': '资源变化与本次奖励或消费不一致',
        'external-save-change': '浏览器中的存档发生了变化',
        'cast-during-cooldown': '技能在冷却结束前重复施放',
        'ultimate-without-energy-cost': '必杀未按规则消耗彩墨'
      };
      detail.textContent = '检查原因：' + (descriptions[code] || (code.startsWith('motion-') ? '移动或动作参数异常' : '游戏数据校验未通过'));
      panel.dataset.reason = code;
      const retry = doc.createElement('button');
      retry.textContent = '重新进入游戏';
      retry.onclick = () => options.reload?.();
      panel.append(title, text, detail, retry);
      doc.body.append(panel);
      panel.focus();
      for (const type of ['keydown', 'keyup', 'click', 'pointerdown']) doc.addEventListener(type, event => {
        if (!panel.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    }
    function stop(code, cheat = true) {
      if (stopped) return false;
      stopped = true; punished = cheat; reason = code;
      // Detection has no storage writes, deletes, persistent penalties or save resets.
      options.onStop?.({ cheat: false, detected: cheat, code, saved: false });
      screen(cheat, code);
      return false;
    }
    function authorize(key) { return key === permit || stop('unauthorized-guard-call'); }
    function check(compareState = true) {
      if (stopped) return false;
      try {
        if (saved !== undefined && get(SAVE_KEY) !== saved) return stop('external-save-change', false);
      } catch { /* Unavailable browser storage must not become a cheating verdict. */ }
      if (!config) return true;
      try {
        if (snapshot(config.rules()) !== rules) return stop('combat-rules-changed');
        const current = config.functions();
        if (current.length !== functions.length || current.some((fn, index) => fn !== functions[index])) return stop('combat-functions-replaced');
        if (compareState && snapshot(config.state()) !== state) return stop('state-written-outside-game');
      } catch { return stop('protected-data-replaced'); }
      return true;
    }
    function resourceValues(value) {
      const result = {};
      for (const key of ['coins', 'gems', 'talent']) {
        if (!integer(value?.[key]) || value[key] < 0) return null;
        result[key] = value[key];
      }
      return result;
    }
    const api = {
      check,
      bind(key, value) {
        if (!authorize(key) || stopped) return false;
        if (config) return stop('guard-rebind');
        config = freeze({ rules: value.rules, functions: value.functions, state: value.state, save: value.save });
        rules = snapshot(config.rules());
        functions = config.functions().slice();
        resources = resourceValues(config.save());
        if (!resources) return stop('invalid-resource-state');
        state = snapshot(config.state());
        return true;
      },
      accept(key) {
        if (!authorize(key) || !check(false)) return false;
        if (config) state = snapshot(config.state());
        return true;
      },
      write(key, value) {
        if (!authorize(key) || !check(false)) return false;
        const next = resourceValues(value);
        const expected = pendingResources || resources;
        if (config && (!next || Object.keys(expected).some(name => next[name] !== expected[name]))) return stop('resource-without-receipt');
        try {
          const text = stringify(value); set(SAVE_KEY, text); saved = text;
          if (pendingResources) resources = pendingResources;
          pendingResources = undefined;
          return true;
        } catch { return false; }
      },
      resources(key, before, next, delta) {
        if (!authorize(key) || !check(false)) return false;
        const previous = resourceValues(before), values = resourceValues(next);
        if (!previous || !values || !delta || typeof delta !== 'object') return stop('invalid-resource-receipt');
        const matches = record => record && ['coins', 'gems', 'talent'].every(name => previous[name] === record[name]);
        // A failed save may leave its reward in memory, or its caller may roll a purchase back.
        if (resources && !matches(resources) && !matches(pendingResources)) return stop('resource-without-receipt');
        for (const name of ['coins', 'gems', 'talent']) {
          const amount = delta[name] === undefined ? 0 : delta[name];
          if (!integer(amount) || values[name] !== previous[name] + amount) return stop('resource-without-receipt');
        }
        pendingResources = values;
        return true;
      },
      cast(key, run, time, id, cooldown, energy) {
        if (!authorize(key) || stopped) return false;
        if (!finite(time) || time < 0 || !finite(cooldown) || cooldown < 0 || !finite(energy) || energy < 0 || energy > 100) return stop('invalid-cast-receipt');
        if (runId !== run) { runId = run; casts = new Map(); returnAvailable = false; }
        if (id === 'return') {
          if (!returnAvailable) return stop('extra-return-cast');
          returnAvailable = false;
          return true;
        }
        if (id === 'ult' && energy !== 0) return stop('ultimate-without-energy-cost');
        if (casts.has(id) && time - casts.get(id) < cooldown - 0.000001) return stop('cast-during-cooldown');
        casts.set(id, time);
        if (id === 'i') returnAvailable = true;
        return true;
      },
      enforce(code) { return code ? stop('motion-' + code) : !stopped; },
      resume() { return check(); },
      conflict() { return stop('external-save-change', false); },
      get stopped() { return stopped; },
      get punished() { return punished; },
      get reason() { return reason; }
    };
    return freeze(api);
  }
  return freeze({ create, version: '2.0.0' });
});
