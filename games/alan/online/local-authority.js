(function () {
'use strict';

/* 房主浏览器内的本机权威：用 WebWorker 承接现有 transport.openSocket 所需的 WebSocket 兼容接口。
   只暴露 window.InkOnlineLocal，绝不替换全局 WebSocket。 */

const currentScript = document.currentScript;
const scriptURL = currentScript && currentScript.src ? currentScript.src : location.href;
const WORKER_URL = new URL('worker.js', scriptURL).href;

const sockets = new Map();
let worker = null;
let nextId = 1;
let visibilityBound = false;

function bindVisibility() {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    post({ op: 'visibility', hidden: document.hidden === true });
  });
}

function post(message) {
  if (!worker) return false;
  try {
    worker.postMessage(message);
    return true;
  } catch (error) {
    failWorker(error, false);
    return false;
  }
}

function onWorkerMessage(event) {
  const data = event ? event.data : null;
  if (!data || typeof data !== 'object') return;
  const socket = sockets.get(data.id);
  if (!socket || socket.readyState === 3) return;
  if (data.op === 'open') {
    if (socket.readyState !== 0) return;
    socket.readyState = 1;
    socket.dispatchEvent(new Event('open'));
    return;
  }
  if (data.op === 'packet') {
    if (socket.readyState !== 1) return;
    let text;
    try {
      text = JSON.stringify(data.packet);
    } catch (error) {
      console.error(error);
      return;
    }
    socket.dispatchEvent(new MessageEvent('message', { data: text }));
    return;
  }
  if (data.op === 'hello') {
    socket.version = data.version;
  }
}

function onWorkerError(event) {
  const error =
    (event && event.error) ||
    new Error((event && event.message) || '本机对战 Worker 运行出错');
  failWorker(error, true);
}

function onWorkerMessageError(event) {
  const error = new Error('本机对战 Worker 返回了无法解析的数据');
  console.error(error, event && event.data);
  failWorker(error, false);
}

function failWorker(error, rethrow) {
  const failed = worker;
  worker = null;
  if (failed) {
    try {
      failed.terminate();
    } catch (ignored) {
      /* terminate 失败也不再影响后续重开 */
    }
  }
  const list = Array.from(sockets.values());
  sockets.clear();
  const text = error && error.message ? error.message : String(error);
  for (const socket of list) socket._fail(text);
  console.error(error);
  if (rethrow) {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

function ensureWorker() {
  if (worker) return worker;
  const created = new Worker(WORKER_URL);
  worker = created;
  created.addEventListener('message', onWorkerMessage);
  created.addEventListener('error', onWorkerError);
  created.addEventListener('messageerror', onWorkerMessageError);
  created.postMessage({ op: 'visibility', hidden: document.hidden === true });
  return created;
}

class Socket extends EventTarget {
  constructor() {
    super();
    this.readyState = 0;
    this.version = null;
    this._id = nextId;
    nextId += 1;
    this._closed = false;
    sockets.set(this._id, this);
    ensureWorker();
    post({ op: 'open', id: this._id });
  }

  send(data) {
    if (this.readyState !== 1) return false;
    let message;
    try {
      message = JSON.parse(data);
    } catch (error) {
      return false;
    }
    return post({ op: 'message', id: this._id, message });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3;
    post({ op: 'close', id: this._id });
    sockets.delete(this._id);
    this.dispatchEvent(new Event('close'));
  }

  _fail(text) {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3;
    sockets.delete(this._id);
    this.lastError = text;
    this.dispatchEvent(new ErrorEvent('error', { message: text, error: new Error(text) }));
    this.dispatchEvent(new Event('close'));
  }
}

function close() {
  const list = Array.from(sockets.values());
  for (const socket of list) socket.close();
  sockets.clear();
  const current = worker;
  worker = null;
  if (current) {
    try {
      current.terminate();
    } catch (ignored) {
      /* 终止失败也视为已清理 */
    }
  }
}

bindVisibility();

window.InkOnlineLocal = { Socket, close };
})();
