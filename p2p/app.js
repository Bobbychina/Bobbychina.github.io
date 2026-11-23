import { generateRoomCode, normalizeRoomCode, joinRoom } from './room.js';
import { createTransfers, FILE_LIMIT, MEMORY_LIMIT } from './transfer.js';

const el = id => document.getElementById(id);
const t = key => I18N.t('p2p.' + key);
const canStream = typeof window.showSaveFilePicker === 'function';
const errorText = {
  file_limit: 'fileLimit', invalid_file: 'invalidFile', receive_busy: 'receiveBusy',
  memory_limit: 'largeFile', file_unavailable: 'fileUnavailable', file_unshared: 'fileUnavailable',
  file_read_failed: 'readFailed', save_failed: 'writeFailed', peer_save_failed: 'peerStopped',
  peer_stopped: 'peerStopped', channel_failed: 'transferError', protocol_error: 'transferError'
};
let session, transfers, statusKey = '', noticeKey = '', copied = false;
let local = [], remote = [], pending = new Map(), receiving = '', saved = null;
const progress = { send: new Map(), receive: new Map() };
const rows = { send: new Map(), receive: new Map() };

function formatSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let amount = bytes, i = 0;
  while (amount >= 1024 && i < units.length - 1) { amount /= 1024; i++; }
  return I18N.number(amount, { maximumFractionDigits: i ? 1 : 0 }) + ' ' + units[i];
}

function notice(key) {
  noticeKey = key;
  el('notice').textContent = key ? t(key) : '';
}
function status(key) {
  statusKey = key;
  el('status').textContent = key ? t(key) : '';
  el('status').toggleAttribute('data-ready', key === 'ready');
  el('status').toggleAttribute('data-error', !!key && !session);
}

function forgetSaved() {
  if (saved) URL.revokeObjectURL(saved.url);
  saved = null;
}
function saveBlob() {
  if (!saved) return;
  const a = document.createElement('a');
  a.href = saved.url;
  a.download = saved.name;
  document.body.append(a);
  a.click();
  a.remove();
}

async function download(item) {
  if (receiving || !transfers) return;
  if (item.size > MEMORY_LIMIT && !canStream) { notice('largeFile'); return; }
  const active = transfers;
  receiving = item.id;
  notice('');
  drawList('receive');
  let writable;
  try {
    if (item.size > MEMORY_LIMIT) {
      const handle = await window.showSaveFilePicker({ suggestedName: item.name });
      if (transfers !== active) return;
      writable = await handle.createWritable();
    }
    if (transfers !== active) { if (writable) await writable.abort(); return; }
    if (active.requestFile(item.id, writable)) return;
  } catch (error) {
    if (transfers === active && error.name !== 'AbortError') notice('saveError');
  }
  if (transfers === active) { receiving = ''; drawList('receive'); }
}

function removeFile(id) {
  notice('');
  if (transfers) transfers.removeFile(id);
  else {
    pending.delete(id);
    local = local.filter(item => item.id !== id);
    drawList('send');
  }
}

function addFiles(files) {
  if (!session || !files.length) return;
  notice('');
  if (transfers) { transfers.addFiles(files); return; }
  for (const file of files) {
    if (pending.size >= FILE_LIMIT) { notice('fileLimit'); break; }
    const id = crypto.randomUUID();
    pending.set(id, file);
    local.push({ id, name: file.name, size: file.size });
  }
  drawList('send');
}

function drawList(direction) {
  const outgoing = direction === 'send';
  const files = outgoing ? local : remote;
  const list = el(outgoing ? 'local-list' : 'remote-list');
  const current = new Set(files.map(item => item.id));
  for (const [id, row] of rows[direction]) {
    if (current.has(id)) continue;
    row.li.remove();
    rows[direction].delete(id);
    progress[direction].delete(id);
  }
  for (const item of files) {
    const { id } = item;
    let row = rows[direction].get(id);
    if (!row) {
      const li = document.createElement('li');
      const name = document.createElement('bdi');
      name.className = 'filename';
      const info = document.createElement('span');
      info.className = 'file-info';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn ghost';
      button.onclick = () => {
        if (outgoing) removeFile(id);
        else if (saved?.id === id) saveBlob();
        else {
          const offered = remote.find(f => f.id === id);
          if (offered) void download(offered);
        }
      };
      const bar = document.createElement('progress');
      li.append(name, info, button, bar);
      list.append(li);
      row = { li, name, info, button, bar };
      rows[direction].set(id, row);
    }
    const job = progress[direction].get(id);
    const inFlight = job?.state === 'transferring';
    const size = formatSize(item.size);
    let details = size;
    if (inFlight) details = t(outgoing ? 'sending' : 'receiving') + ' · ' + formatSize(job.done) + ' / ' + size;
    if (job?.state === 'complete') details += ' · ' + t(outgoing ? 'completeSend' : 'completeReceive');
    if (job?.state === 'failed') details += ' · ' + t('failed');
    row.name.textContent = item.name;
    row.info.textContent = details;
    row.bar.hidden = !inFlight;
    if (inFlight) {
      row.bar.max = job.total || 1;
      row.bar.value = job.done;
      row.bar.setAttribute('aria-label', item.name);
    }
    const action = outgoing ? 'remove' : saved?.id === id ? 'saveAgain' : 'download';
    row.button.textContent = t(action);
    row.button.setAttribute('aria-label', t(action) + ' ' + item.name);
    row.button.disabled = !outgoing && !!receiving;
  }
  if (!outgoing) el('remote-empty').hidden = remote.length > 0;
}

function view() {
  el('lobby').hidden = !!session;
  el('active-room').hidden = !session;
  el('files').hidden = !session;
  el('memory-limit').hidden = canStream;
  el('copy').textContent = t(copied ? 'copied' : 'copy');
  status(statusKey);
  notice(noticeKey);
  drawList('send');
  drawList('receive');
}

function leave(reason = '') {
  const old = session;
  session = null;
  old?.room.close();
  transfers?.close();
  transfers = null;
  pending.clear();
  local = []; remote = [];
  receiving = ''; copied = false;
  forgetSaved();
  el('room-code').textContent = '';
  el('dropzone').classList.remove('drag');
  notice('');
  status(reason);
  view();
}

function enter(code) {
  if (session) return;
  if (!code) { status('invalid-code'); el('join-code').focus(); return; }
  const active = {};
  session = active;
  el('room-code').textContent = code;
  el('join-code').value = code;
  notice('');
  status('connecting');
  view();
  active.room = joinRoom(code, {
    onStatus(key) { if (session === active) status(key); },
    onEnd(reason) { if (session === active) leave(reason); },
    onChannel(channel) {
      if (session !== active) return;
      status('ready');
      transfers = createTransfers(channel, {
        onLocal(files) { local = files; drawList('send'); },
        onRemote(files) {
          remote = files;
          if (saved && !files.some(f => f.id === saved.id)) forgetSaved();
          drawList('receive');
        },
        onProgress(job) {
          progress[job.direction].set(job.id, job);
          if (job.direction === 'receive' && job.state !== 'transferring') receiving = '';
          drawList(job.direction);
        },
        onDownload({ id, name, blob }) {
          forgetSaved();
          saved = { id, name, url: URL.createObjectURL(blob) };
          saveBlob();
        },
        onError(code) { notice(errorText[code] || 'transferError'); }
      });
      transfers.addFiles(pending.values());
      pending.clear();
    }
  });
}

el('create').onclick = () => enter(generateRoomCode());
el('join-form').onsubmit = e => { e.preventDefault(); enter(normalizeRoomCode(el('join-code').value)); };
el('leave').onclick = () => { leave(); el('join-code').focus(); };
el('copy').onclick = async () => {
  const active = session;
  try {
    await navigator.clipboard.writeText(el('room-code').textContent);
    if (session === active) { copied = true; notice(''); view(); }
  } catch { if (session === active) notice('copyError'); }
};
el('choose').onclick = () => el('picker').click();
el('picker').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
const drop = el('dropzone');
const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });
drop.ondragover = e => { if (hasFiles(e)) { e.preventDefault(); drop.classList.add('drag'); } };
drop.ondragleave = e => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('drag'); };
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); };
window.addEventListener('pagehide', () => leave());
I18N.onChange(view);
view();
