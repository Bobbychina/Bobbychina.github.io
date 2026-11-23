const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const namespace = 'bobbychina/p2p-room/v1';
const label = 'bobbychina-files-v1';
const encoder = new TextEncoder();
const stunServers = [
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' }
];

export function normalizeRoomCode(input) {
  if (typeof input !== 'string') return '';
  const code = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(code) ? code.match(/.{4}/g).join('-') : '';
}

export function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return normalizeRoomCode(Array.from(bytes, byte => alphabet[byte & 31]).join(''));
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function credentials(code) {
  const slot = async role => {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${namespace}/${role}/${code}`));
    return 'bc-files-' + hex(digest).slice(0, 40);
  };
  const [host, guest, key] = await Promise.all([
    slot('host'), slot('guest'),
    crypto.subtle.importKey('raw', encoder.encode(`${namespace}/auth/${code}`),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  ]);
  return { host, guest, key };
}

function fingerprint(description) {
  const match = description?.sdp.match(/^a=fingerprint:sha-256 ((?:[\da-f]{2}:){31}[\da-f]{2})\s*$/im);
  if (!match) throw new Error('Missing DTLS certificate fingerprint');
  return match[1].toLowerCase();
}

// Bind both proofs to the certificates actually used by the encrypted channel.
// The final ready message gives each receiver time to install its file listener.
function authenticate(connection, role, key, onReady, onFailure) {
  const channel = connection.dataChannel;
  const pc = connection.peerConnection;
  const local = fingerprint(pc.localDescription);
  const remote = fingerprint(pc.remoteDescription);
  const certificates = role === 'host' ? [local, remote] : [remote, local];
  const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
  let hostNonce = role === 'host' ? nonce : '';
  let guestNonce = role === 'guest' ? nonce : '';
  let expected = role === 'host' ? 'proof' : 'hello';
  let active = true;

  const proofInput = signer => encoder.encode([namespace, signer, ...certificates, hostNonce, guestNonce].join('/'));
  const sign = async signer => hex(await crypto.subtle.sign('HMAC', key, proofInput(signer)));
  const verify = (signer, proof) => {
    const bytes = Uint8Array.from(proof.match(/../g), pair => parseInt(pair, 16));
    return crypto.subtle.verify('HMAC', key, bytes, proofInput(signer));
  };
  function detach() {
    active = false;
    connection.off('data', receive);
  }
  function ready() {
    detach();
    onReady(channel);
  }
  async function receive(message) {
    if (!active) return;
    try {
      if (typeof message !== 'string' || message.length > 128) throw new Error();
      const [prefix, type, ...parts] = message.split('/');
      if (prefix !== 'room1' || type !== expected) throw new Error();
      expected = ''; // Reject overlapping input while Web Crypto is pending.
      if (type === 'hello' && parts.length === 1 && /^[0-9a-f]{32}$/.test(parts[0])) {
        hostNonce = parts[0];
        const proof = await sign('guest');
        if (!active) return;
        expected = 'accept';
        channel.send(`room1/proof/${guestNonce}/${proof}`);
      } else if (type === 'proof' && parts.length === 2 && /^[0-9a-f]{32}$/.test(parts[0]) && /^[0-9a-f]{64}$/.test(parts[1])) {
        guestNonce = parts[0];
        if (!await verify('guest', parts[1])) throw new Error();
        const proof = await sign('host');
        if (!active) return;
        expected = 'ready';
        channel.send(`room1/accept/${proof}`);
      } else if (type === 'accept' && parts.length === 1 && /^[0-9a-f]{64}$/.test(parts[0])) {
        if (!await verify('host', parts[0])) throw new Error();
        if (!active) return;
        channel.send('room1/ready');
        ready();
      } else if (type === 'ready' && parts.length === 0) {
        ready();
      } else {
        throw new Error();
      }
    } catch {
      if (active) onFailure();
    }
  }
  // PeerJS 1.5.5's raw serializer emits the original string or ArrayBuffer.
  // Removing this one listener leaves the native channel free for the application.
  connection.on('data', receive);
  if (role === 'host') channel.send(`room1/hello/${hostNonce}`);
  return detach;
}

// onEnd receives invalid-code, unsupported, signaling, timeout, room-full,
// unreachable, authentication, or disconnected. A caller-initiated close is silent.
export function joinRoom(input, { onStatus, onChannel, onEnd }, { signaling = {} } = {}) {
  const code = normalizeRoomCode(input);
  let peer;
  let connection;
  let slots;
  let deadline;
  let iceDeadline;
  let detachAuth;
  let ended = false;
  let paired = false;

  function close() {
    if (ended) return;
    ended = true;
    clearTimeout(deadline);
    clearTimeout(iceDeadline);
    detachAuth?.();
    peer?.destroy();
  }
  function fail(reason) {
    if (ended) return;
    close();
    onEnd(reason);
  }
  function timeout(ms, reason) {
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(reason), ms);
  }
  function pair(link, role) {
    connection = link;
    onStatus('pairing');
    timeout(35_000, 'unreachable');
    link.on('error', () => fail(paired ? 'disconnected' : 'unreachable'));
    link.on('close', () => fail('disconnected'));
    link.on('iceStateChanged', state => {
      if (ended) return;
      if (state === 'disconnected') {
        iceDeadline ??= setTimeout(() => fail('disconnected'), 15_000);
      } else {
        clearTimeout(iceDeadline);
        iceDeadline = undefined;
      }
    });
    link.on('open', () => {
      if (ended) return;
      const channel = link.dataChannel;
      if (!channel?.ordered || channel.maxRetransmits != null || channel.maxPacketLifeTime != null || channel.label !== label) {
        fail('authentication');
        return;
      }
      timeout(12_000, 'authentication');
      try {
        detachAuth = authenticate(link, role, slots.key, nativeChannel => {
          if (ended || paired) return;
          paired = true;
          clearTimeout(deadline);
          onChannel(nativeChannel);
        }, () => fail('authentication'));
      } catch {
        fail('authentication');
      }
    });
  }
  function register(role) {
    // Both registrations stay reserved while paired. After ICE completes the
    // signaling socket only needs its heartbeat; all file traffic uses SCTP.
    const node = new window.Peer(slots[role], {
      ...signaling,
      config: { iceServers: stunServers }
    });
    peer = node;
    const current = () => !ended && peer === node;
    timeout(20_000, 'signaling');
    node.on('error', error => {
      if (!current() || paired) return;
      if (error.type === 'unavailable-id' && role === 'host') {
        // PeerJS destroys this unsuccessful registration after emitting error.
        register('guest');
      } else if (error.type === 'unavailable-id') {
        fail('room-full');
      } else if (error.type === 'browser-incompatible') {
        fail('unsupported');
      } else {
        fail(['peer-unavailable', 'webrtc'].includes(error.type) ? 'unreachable' : 'signaling');
      }
    });
    node.on('disconnected', () => { if (current() && !paired) fail('signaling'); });
    node.on('close', () => { if (current()) fail(paired ? 'disconnected' : 'signaling'); });
    node.on('call', call => call.close());
    node.on('connection', incoming => {
      if (!current() || role !== 'host' || connection || incoming.peer !== slots.guest ||
          incoming.label !== label || incoming.serialization !== 'raw' || !incoming.reliable) {
        incoming.close();
        return;
      }
      pair(incoming, 'host');
    });
    node.on('open', () => {
      if (!current()) return;
      if (role === 'host') {
        timeout(10 * 60_000, 'timeout');
        onStatus('waiting');
      } else {
        const outgoing = node.connect(slots.host, { label, serialization: 'raw', reliable: true });
        if (outgoing) pair(outgoing, 'guest');
        else fail('unreachable');
      }
    });
  }
  async function start() {
    if (ended) return;
    if (!code) return fail('invalid-code');
    if (!window.Peer || !window.RTCPeerConnection || !window.crypto?.subtle) return fail('unsupported');
    onStatus('connecting');
    slots = await credentials(code);
    if (!ended) register('host');
  }
  Promise.resolve().then(start).catch(() => fail('signaling'));
  return { close };
}
