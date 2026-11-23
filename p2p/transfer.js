// Ordered, reliable DataChannel. Each direction carries one file at a time.
const CHUNK = 16 * 1024;
const BLOCK = 256 * 1024;
const WINDOW = 4 * BLOCK;
export const MEMORY_LIMIT = 128 * 1024 * 1024;
export const FILE_LIMIT = 32;

function safeName(value) {
  const leaf = value.split(/[\\/]/).pop();
  let name = leaf.replace(/[<>:"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, "_").trim();
  // Keep the entire manifest within a single small SCTP message.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
  name = name.slice(0, 96).replace(/[\ud800-\udbff]$/, "").replace(/[. ]+$/, "");
  return name || "download";
}

function publicFile({ id, name, size }) {
  return { id, name, size };
}

function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("");
}

function validSize(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function abortWriter(writer) {
  if (writer) Promise.resolve().then(() => writer.abort()).catch(() => {});
}

// An optional writable comes from the user-initiated save picker. A successful
// disk receive signals completion only after close commits the file. Without a
// writable, onDownload receives a Blob and the caller owns its URL lifetime.
export function createTransfers(channel, hooks = {}) {
  const local = new Map();
  let remote = new Map();
  let sending = null;
  let receiving = null;
  let closed = false;
  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = BLOCK / 2;

  function progress(job, direction, state) {
    if (state === "transferring") {
      const now = performance.now();
      if (job.lastUpdate !== undefined && job.done < job.item.size && now - job.lastUpdate < 100) return;
      job.lastUpdate = now;
    }
    hooks.onProgress?.({ id: job.item.id, direction, done: job.done, total: job.item.size, state });
  }

  function wakeSender() {
    if (sending?.wake) {
      const wake = sending.wake;
      sending.wake = null;
      wake();
    }
  }

  function close(reason) {
    if (closed) return;
    closed = true;
    channel.removeEventListener("message", onMessage);
    channel.removeEventListener("bufferedamountlow", wakeSender);
    channel.removeEventListener("close", onClose);
    channel.removeEventListener("error", onError);
    wakeSender();
    const outgoing = sending;
    const incoming = receiving;
    sending = receiving = null;
    if (incoming) abortWriter(incoming.writer);
    if (channel.readyState !== "closed" && channel.readyState !== "closing") channel.close();
    local.clear();
    remote.clear();
    if (outgoing) progress(outgoing, "send", "failed");
    if (incoming) progress(incoming, "receive", "failed");
    hooks.onLocal?.([]);
    hooks.onRemote?.([]);
    if (reason) hooks.onError?.(reason);
  }

  function onClose() { close(); }
  function onError() { close("channel_failed"); }

  function send(data) {
    if (closed) return false;
    try {
      channel.send(data);
      return true;
    } catch {
      close("channel_failed");
      return false;
    }
  }

  function control(type, fields = {}) {
    return send(JSON.stringify({ type, ...fields }));
  }

  function publish() {
    control("list", { files: Array.from(local.values(), publicFile) });
  }

  function addFiles(files) {
    if (closed) return;
    for (const file of files) {
      if (local.size >= FILE_LIMIT) {
        hooks.onError?.("file_limit");
        break;
      }
      if (typeof file?.name !== "string" || !validSize(file.size) || typeof file.slice !== "function") {
        hooks.onError?.("invalid_file");
        continue;
      }
      const id = newId();
      local.set(id, { id, name: safeName(file.name), size: file.size, file });
    }
    hooks.onLocal?.(Array.from(local.values(), publicFile));
    publish();
  }

  function removeFile(id) {
    if (closed || !local.delete(id)) return;
    if (sending?.item.id === id && !sending.ended) failSend(sending, "file_unshared");
    hooks.onLocal?.(Array.from(local.values(), publicFile));
    publish();
  }

  function requestFile(id, writer) {
    const item = remote.get(id);
    let error;
    if (closed || !item) error = "file_unavailable";
    else if (receiving) error = "receive_busy";
    else if (!writer && item.size > MEMORY_LIMIT) error = "memory_limit";
    if (error) {
      abortWriter(writer);
      hooks.onError?.(error);
      return false;
    }
    receiving = { item, writer, done: 0, received: 0, chunks: [], blocks: [], writes: Promise.resolve(), cancelled: false, ended: false };
    if (!control("get", { id })) return false;
    progress(receiving, "receive", "transferring");
    return true;
  }

  function failSend(job, message) {
    if (sending !== job) return;
    wakeSender();
    sending = null;
    control("stopped", { id: job.item.id });
    progress(job, "send", "failed");
    if (message) hooks.onError?.(message);
  }

  async function sendFile(job) {
    const { id, file, size } = job.item;
    try {
      while (job.offset < size && sending === job) {
        if (job.offset - job.done >= WINDOW || channel.bufferedAmount > BLOCK) {
          await new Promise(resolve => { job.wake = resolve; });
          continue;
        }
        const end = Math.min(job.offset + CHUNK, size);
        const bytes = await file.slice(job.offset, end).arrayBuffer();
        if (sending !== job) return;
        if (bytes.byteLength !== end - job.offset) throw new Error("short read");
        if (!send(bytes)) return;
        job.offset = end;
      }
      if (sending === job) {
        job.ended = true;
        control("end", { id });
      }
    } catch {
      failSend(job, "file_read_failed");
    }
  }

  function startSend(id) {
    if (sending) throw new Error("duplicate request");
    const item = local.get(id);
    if (!item) {
      control("stopped", { id });
      return;
    }
    const job = { item, offset: 0, done: 0, wake: null, ended: false };
    sending = job;
    progress(job, "send", "transferring");
    void sendFile(job);
  }

  function cancelReceive(job) {
    if (job !== receiving || job.cancelled) return;
    // Wait for 'stopped' to drain any already-sent binary frames before a
    // subsequent download can reuse this direction.
    job.cancelled = true;
    job.chunks = [];
    job.blocks = [];
    abortWriter(job.writer);
    job.writer = null;
    if (!control("cancel", { id: job.item.id })) return;
    hooks.onError?.("save_failed");
  }

  function chunk(bytes) {
    const job = receiving;
    if (!job) throw new Error("unexpected binary frame");
    if (job.cancelled) return;
    const remaining = job.item.size - job.received;
    if (job.ended || remaining === 0 || bytes.byteLength !== Math.min(CHUNK, remaining) ||
        job.received + bytes.byteLength - job.done > WINDOW) throw new Error("unexpected chunk size");
    job.received += bytes.byteLength;
    job.chunks.push(bytes);
    if (job.received % BLOCK !== 0 && job.received < job.item.size) return;
    const block = new Blob(job.chunks);
    job.chunks = [];
    job.writes = job.writes.then(async () => {
      if (receiving !== job || job.cancelled) return;
      if (job.writer) await job.writer.write(block);
      else job.blocks.push(block);
      if (receiving !== job || job.cancelled) return;
      job.done += block.size;
      if (control("credit", { id: job.item.id, done: job.done })) progress(job, "receive", "transferring");
    }).catch(() => cancelReceive(job));
  }

  function finishReceive(job) {
    if (job.cancelled) return;
    if (job.ended || job.received !== job.item.size) throw new Error("premature end");
    job.ended = true;
    job.writes = job.writes.then(async () => {
      if (receiving !== job || job.cancelled) return;
      if (job.writer) await job.writer.close();
      if (receiving !== job || job.cancelled) return;
      if (!job.writer) hooks.onDownload?.({ id: job.item.id, name: job.item.name, blob: new Blob(job.blocks) });
      if (!control("saved", { id: job.item.id })) return;
      receiving = null;
      progress(job, "receive", "complete");
    }).catch(() => cancelReceive(job));
  }

  function readList(files) {
    if (!Array.isArray(files) || files.length > FILE_LIMIT) throw new Error("invalid manifest");
    const next = new Map();
    for (const item of files) {
      if (!item || !validId(item.id) || next.has(item.id) || !validSize(item.size) ||
          typeof item.name !== "string" || item.name.length > 98) throw new Error("invalid file metadata");
      next.set(item.id, { id: item.id, name: safeName(item.name), size: item.size });
    }
    remote = next;
    hooks.onRemote?.(Array.from(next.values(), publicFile));
  }

  function validId(id) { return typeof id === "string" && /^[a-f0-9]{24}$/.test(id); }

  function onMessage({ data }) {
    if (closed) return;
    try {
      if (data instanceof ArrayBuffer) return chunk(data);
      if (typeof data !== "string" || data.length > CHUNK) throw new Error("invalid frame");
      const msg = JSON.parse(data);
      if (msg.type === "hello" && msg.version === 1) return publish();
      if (msg.type === "list") return readList(msg.files);
      if (!validId(msg.id)) throw new Error("invalid id");
      if (msg.type === "get") return startSend(msg.id);
      if (msg.type === "end" && receiving?.item.id === msg.id) return finishReceive(receiving);
      if (msg.type === "stopped" && receiving?.item.id === msg.id) {
        const job = receiving;
        receiving = null;
        abortWriter(job.writer);
        progress(job, "receive", "failed");
        if (!job.cancelled) hooks.onError?.("peer_stopped");
        return;
      }
      // Credits and cancellation can cross an outgoing 'stopped' in flight.
      if (msg.type === "credit" || msg.type === "cancel") {
        if (sending?.item.id !== msg.id) return;
        if (msg.type === "cancel") return failSend(sending, "peer_save_failed");
        if (!validSize(msg.done) || msg.done <= sending.done || msg.done > sending.offset) throw new Error("invalid credit");
        sending.done = msg.done;
        wakeSender();
        progress(sending, "send", "transferring");
        return;
      }
      if (msg.type === "saved" && sending?.item.id === msg.id && sending.ended && sending.done === sending.item.size) {
        const job = sending;
        sending = null;
        progress(job, "send", "complete");
        return;
      }
      throw new Error("unexpected control");
    } catch {
      close("protocol_error");
    }
  }

  channel.addEventListener("message", onMessage);
  channel.addEventListener("close", onClose);
  channel.addEventListener("error", onError);
  channel.addEventListener("bufferedamountlow", wakeSender);
  control("hello", { version: 1 });
  return { addFiles, removeFile, requestFile, close: () => close() };
}
