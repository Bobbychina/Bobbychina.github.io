(function (root) {
'use strict';

const { Duel } = root.InkOnlineCombat;

const CHARACTERS = Object.freeze(['nameless', 'panshan', 'mingxiao']);
const EDGE_KEYS = Object.freeze([
  'jump',
  'dive',
  'dash',
  'attackPress',
  'heavy',
  'skill2',
  'ultimate',
]);
const DEFAULT_NAME = '行者';
const MAX_NAME = 12;
const STATES = ['waiting', 'countdown', 'playing', 'paused', 'result'];

function cleanInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const move = raw.move === 1 ? 1 : raw.move === -1 ? -1 : 0;
  const input = {
    move,
    attack: raw.attack === true,
  };
  for (const key of EDGE_KEYS) input[key] = raw[key] === true;
  return input;
}

function cleanName(raw) {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const text = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME);
  return text || DEFAULT_NAME;
}

function cleanCharacter(raw) {
  return CHARACTERS.includes(raw) ? raw : 'nameless';
}

function emptyInput() {
  return { move: 0, attack: false };
}

function emptyEdges() {
  const edges = {};
  for (const key of EDGE_KEYS) edges[key] = false;
  return edges;
}

function copyPlayer(player) {
  if (!player) return null;
  return { name: player.name, character: player.character, ready: player.ready };
}

class MatchRoom {
  constructor(options = {}) {
    const opts = options || {};
    this.code = typeof opts.code === 'string' ? opts.code : '';
    this.countdownSeconds =
      Number.isFinite(opts.countdownSeconds) && opts.countdownSeconds > 0
        ? opts.countdownSeconds
        : 3;
    this.inputTimeoutMs =
      Number.isFinite(opts.inputTimeoutMs) && opts.inputTimeoutMs >= 0
        ? opts.inputTimeoutMs
        : 300;
    this._onEmit = typeof opts.onEmit === 'function' ? opts.onEmit : () => {};
    this._now = typeof opts.now === 'function' ? opts.now : Date.now;

    this.state = 'waiting';
    this.players = [null, null];
    this.duel = null;

    this._prevState = null;
    this._countdownLeft = 0;
    this._seq = 0;
    this._playTicks = 0;
    this._rematch = [false, false];
    this._input = [emptyInput(), emptyInput()];
    this._edges = [emptyEdges(), emptyEdges()];
    this._lastInputAt = [null, null];
  }

  /* ---------------------------------------------------------------- 座位 */

  connect(slot, info) {
    if (slot !== 0 && slot !== 1) throw new Error('座位号无效');
    if (this.players[slot]) throw new Error('该座位已被占用');
    const data = info && typeof info === 'object' ? info : {};
    this.players[slot] = {
      name: cleanName(data.name),
      character: cleanCharacter(data.character),
      ready: false,
    };
    this._resetSlotInput(slot);
    this._rematch[slot] = false;
    this.broadcastRoom();
    return true;
  }

  disconnect(slot) {
    if (slot !== 0 && slot !== 1) return false;
    if (!this.players[slot]) return false;
    this.players[slot] = null;
    this._resetSlotInput(slot);
    this._rematch[slot] = false;

    if (this.duel && !this.duel.over) this.duel.finish(1 - slot, '对手离开');
    this.duel = null;
    this._prevState = null;
    this._countdownLeft = 0;
    this._playTicks = 0;
    this._rematch = [false, false];
    this._clearInputs();
    this.state = 'waiting';
    for (let s = 0; s < 2; s += 1) {
      if (this.players[s]) this.players[s].ready = false;
    }
    this.broadcastRoom();
    if (this.players[1 - slot]) {
      this._emit(1 - slot, { type: 'notice', text: '对手已离开，等待新的对手' });
    }
    return true;
  }

  /* ---------------------------------------------------------------- 消息 */

  receive(slot, message) {
    if (slot !== 0 && slot !== 1) return;
    if (!this.players[slot]) return;
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this._error(slot, '消息格式不正确');
      return;
    }
    switch (message.type) {
      case 'ready':
        this._onReady(slot, message);
        return;
      case 'select':
        this._onSelect(slot, message);
        return;
      case 'input':
        this._onInput(slot, message);
        return;
      case 'rematch':
        this._onRematch(slot);
        return;
      case 'surrender':
        this._onSurrender(slot);
        return;
      case 'ping':
        this._emit(slot, { type: 'pong', at: message.at });
        return;
      default:
        this._error(slot, '未知的消息类型');
    }
  }

  _onReady(slot, message) {
    if (this.state !== 'waiting') {
      this._error(slot, '当前阶段不能准备');
      return;
    }
    this.players[slot].ready = message.ready === true;
    this.broadcastRoom();
    if (this._bothReady()) this._startCountdown();
  }

  _onSelect(slot, message) {
    if (this.state !== 'waiting') {
      this._error(slot, '当前阶段不能切换角色');
      return;
    }
    if (!CHARACTERS.includes(message.character)) {
      this._error(slot, '只能选择无名、磐山或鸣霄');
      return;
    }
    this.players[slot].character = message.character;
    this.players[slot].ready = false;
    this.broadcastRoom();
  }

  _onInput(slot, message) {
    if (this.state === 'paused') {
      this._error(slot, '暂停中不接受操作');
      return;
    }
    if (this.state !== 'playing' || !this.duel) {
      this._error(slot, '当前阶段不接受战斗输入');
      return;
    }
    const input = cleanInput(message.input);
    if (!input) {
      this._error(slot, '输入格式不正确');
      return;
    }
    const current = this._input[slot];
    current.move = input.move;
    current.attack = input.attack;
    const edges = this._edges[slot];
    for (const key of EDGE_KEYS) {
      if (input[key] === true) edges[key] = true;
    }
    this._lastInputAt[slot] = this._now();
  }

  _onRematch(slot) {
    if (this.state !== 'result') {
      this._error(slot, '当前阶段不能再战');
      return;
    }
    this._rematch[slot] = true;
    this.players[slot].ready = true;
    this.broadcastRoom();
    if (this._bothReady()) this._startCountdown();
  }

  _onSurrender(slot) {
    if (this.state !== 'playing' && this.state !== 'paused') {
      this._error(slot, '当前不在战斗中，无法认输');
      return;
    }
    if (!this.duel) {
      this._error(slot, '当前不在战斗中，无法认输');
      return;
    }
    this._finishMatch(1 - slot, '对手认输');
  }

  _finishMatch(winner, reason) {
    if (this.duel && !this.duel.over) this.duel.finish(winner, reason);
    this.state = 'result';
    this._prevState = null;
    this._countdownLeft = 0;
    this._playTicks = 0;
    this._rematch = [false, false];
    this._clearInputs();
    this.broadcastRoom();
    this.broadcastSnapshot();
  }

  /* ---------------------------------------------------------------- 时间 */

  tick(dt = 1 / 60) {
    const step = typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (step <= 0) return;

    if (this.state === 'countdown') {
      this._countdownLeft = Math.max(0, this._countdownLeft - step);
      if (this._countdownLeft <= 0) {
        this._startMatch();
        return;
      }
      this.broadcastRoom();
      return;
    }
    if (this.state !== 'playing' || !this.duel) return;

    const inputs = [this._tickInput(0), this._tickInput(1)];
    this._playTicks += 1;
    this.duel.update(inputs, step);
    if (this.duel.over) {
      this.state = 'result';
      this._prevState = null;
      this._countdownLeft = 0;
      this._playTicks = 0;
      this._rematch = [false, false];
      this._clearInputs();
      this.broadcastRoom();
      this.broadcastSnapshot();
      return;
    }
    if (this._playTicks % 2 === 0) this.broadcastSnapshot();
  }

  setPaused(paused) {
    if (paused === true) {
      if (this.state !== 'playing' && this.state !== 'countdown') return false;
      this._prevState = this.state;
      this._clearInputs();
      this.state = 'paused';
      this.broadcastRoom();
      return true;
    }
    if (paused !== false) return false;
    if (this.state !== 'paused') return false;
    const resume = this._prevState === 'countdown' ? 'countdown' : 'playing';
    this._prevState = null;
    this.state = resume;
    this.broadcastRoom();
    if (this.duel) this.broadcastSnapshot();
    return true;
  }

  /* ---------------------------------------------------------------- 广播 */

  broadcastRoom() {
    const countdown =
      this.state === 'countdown' ? Math.max(0, Math.ceil(this._countdownLeft)) : 0;
    const players = [copyPlayer(this.players[0]), copyPlayer(this.players[1])];
    for (let slot = 0; slot < 2; slot += 1) {
      if (!this.players[slot]) continue;
      this._emit(slot, {
        type: 'room',
        code: this.code,
        state: this.state,
        players,
        countdown,
        slot,
        paused: this.state === 'paused',
      });
    }
  }

  broadcastSnapshot() {
    if (!this.duel) return;
    const snap = this.duel.snapshot();
    this._seq += 1;
    const message = { type: 'snapshot', seq: this._seq, ...snap };
    for (let slot = 0; slot < 2; slot += 1) {
      if (this.players[slot]) this._emit(slot, message);
    }
  }

  /* ---------------------------------------------------------------- 内部 */

  _startCountdown() {
    this.duel = null;
    this.state = 'countdown';
    this._prevState = null;
    this._countdownLeft = this.countdownSeconds;
    this._playTicks = 0;
    this._rematch = [false, false];
    this._clearInputs();
    this.broadcastRoom();
  }

  _startMatch() {
    this.duel = new Duel([this.players[0].character, this.players[1].character]);
    for (let s = 0; s < 2; s += 1) {
      if (this.players[s]) this.players[s].ready = false;
    }
    this.state = 'playing';
    this._prevState = null;
    this._countdownLeft = 0;
    this._playTicks = 0;
    this._rematch = [false, false];
    this._clearInputs();
    this.broadcastRoom();
    this.broadcastSnapshot();
  }

  _bothReady() {
    return (
      Boolean(this.players[0]) &&
      Boolean(this.players[1]) &&
      this.players[0].ready === true &&
      this.players[1].ready === true
    );
  }

  _tickInput(slot) {
    const stored = this._input[slot];
    const edges = this._edges[slot];
    const last = this._lastInputAt[slot];
    const stale = last === null || this._now() - last > this.inputTimeoutMs;
    const input = {
      move: stale ? 0 : stored.move,
      attack: stale ? false : stored.attack,
    };
    for (const key of EDGE_KEYS) {
      input[key] = stale ? false : edges[key] === true;
      edges[key] = false;
    }
    return input;
  }

  _resetSlotInput(slot) {
    this._input[slot] = emptyInput();
    this._edges[slot] = emptyEdges();
    this._lastInputAt[slot] = null;
  }

  _clearInputs() {
    this._resetSlotInput(0);
    this._resetSlotInput(1);
  }

  _emit(slot, message) {
    try {
      this._onEmit(slot, message);
    } catch (error) {
      this.lastTransportError = error;
    }
  }

  _error(slot, text) {
    this._emit(slot, { type: 'error', text });
  }
}

root.InkOnlineRoom = { MatchRoom, cleanInput, CHARACTERS, STATES };
})(globalThis);
