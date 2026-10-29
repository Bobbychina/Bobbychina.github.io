(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.InkOnlineProtocol = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = 2;
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const CHARACTERS = Object.freeze({ nameless: '无名', panshan: '磐山', mingxiao: '鸣霄' });
  const EDGES = ['jump', 'dive', 'dash', 'attackPress', 'heavy', 'skill2', 'ultimate'];
  function roomCode(value) {
    const code = String(value || '').trim().toUpperCase().replace(/[\s-]/g, '');
    return code.length === 10 && [...code].every(char => ALPHABET.includes(char)) ? code : null;
  }
  function randomCode() {
    const values = new Uint32Array(10);
    crypto.getRandomValues(values);
    return Array.from(values, value => ALPHABET[value % ALPHABET.length]).join('');
  }
  function profile(value = {}) {
    return {
      name: String(value.name || '').replace(/[\x00-\x1f<>]/g, '').trim().slice(0, 12) || '行者',
      character: Object.hasOwn(CHARACTERS, value.character) ? value.character : 'nameless'
    };
  }
  function command(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.type === 'input' && value.input && typeof value.input === 'object' && !Array.isArray(value.input)) {
      const input = { move: [-1, 0, 1].includes(value.input.move) ? value.input.move : 0, attack: value.input.attack === true };
      for (const key of EDGES) input[key] = value.input[key] === true;
      return { type: 'input', input };
    }
    if (value.type === 'ready') return { type: 'ready', ready: value.ready === true };
    if (value.type === 'select' && Object.hasOwn(CHARACTERS, value.character)) return { type: 'select', character: value.character };
    if (value.type === 'ping' && Number.isFinite(value.at)) return { type: 'ping', at: value.at };
    if (['rematch', 'surrender', 'leave'].includes(value.type)) return { type: value.type };
    return null;
  }
  function signalOptions(address) {
    const url = new URL(address || 'https://0.peerjs.com');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('信令地址应为 http:// 或 https:// 地址，不含账号和参数。');
    return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), secure: url.protocol === 'https:', path: url.pathname, key: 'peerjs', debug: 0, pingInterval: 5000 };
  }
  return Object.freeze({ VERSION, CHARACTERS, EDGES, roomCode, randomCode, profile, command, signalOptions });
});
