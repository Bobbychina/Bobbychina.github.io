(function () {
  'use strict';
  const P = window.InkOnlineProtocol;
  const GRACE = 20000;
  const errorText = error => {
    const type = error?.type;
    if (type === 'peer-unavailable') return '找不到这个房间。请核对房间码，并确认房主还开着页面、双方使用相同信令地址。';
    if (type === 'unavailable-id') return '这个房间码暂被占用，请重新创建房间。';
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) return '无法连接信令服务。请检查网络，或在网络设置中改用双方可访问的 PeerServer。';
    return error?.message || '连接失败，请重试。';
  };
  class OnlineTransport extends EventTarget {
    constructor() {
      super();
      this.closed = true;
      this.epoch = 0;
      this.role = null;
      this.code = null;
      this.lastRoom = null;
      this.stats = null;
      this.timers = new Set();
      this.sockets = new Set();
    }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    later(fn, ms) {
      const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms);
      this.timers.add(timer);
      return timer;
    }
    cancel(timer) { clearTimeout(timer); this.timers.delete(timer); }
    async start(role, profile, options, code) {
      this.close();
      const epoch = this.epoch;
      this.closed = false;
      this.role = role;
      this.profile = P.profile(profile);
      this.options = options;
      this.code = role === 'host' ? P.randomCode() : P.roomCode(code);
      if (!this.code) throw new Error('房间码应为 10 位字母或数字，请完整复制。');
      this.emit('status', { text: role === 'host' ? '正在启动本机对战、登记房间…' : '正在寻找房主…' });
      try {
        if (role === 'host') {
          const local = await this.openSocket({ type: 'create', ...this.profile }, packet => this.emit('packet', packet), epoch);
          if (this.epoch !== epoch) throw new Error('连接已取消。');
          this.local = local.socket;
          this.gameCode = local.room.code;
        }
        this.peer = await this.openPeer(role === 'host' ? 'ink-duel-v2-' + this.code : undefined, options, epoch);
        if (this.epoch !== epoch) throw new Error('连接已取消。');
        this.emit('code', this.code);
        if (role === 'host') {
          this.peer.on('connection', connection => this.acceptGuest(connection, epoch));
          this.emit('status', { text: '房间已创建。把 10 位房间码发给朋友，等待加入。' });
        } else {
          this.session = this.getSession(this.code);
          await this.connectGuest(epoch);
        }
        this.startStats(epoch);
      } catch (error) {
        if (this.epoch === epoch) { this.close(); this.emit('failure', errorText(error)); }
        throw error;
      }
    }
    getSession(code) {
      const key = 'ink-online:session:' + code;
      let token;
      try { token = sessionStorage.getItem(key); } catch { /* Private browsing can disable storage. */ }
      if (!/^[0-9a-f]{32}$/.test(token || '')) {
        token = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
        try { sessionStorage.setItem(key, token); } catch { /* The in-memory token still supports reconnection. */ }
      }
      return token;
    }
    openSocket(first, onPacket, epoch) {
      return new Promise((resolve, reject) => {
        const socket = new window.InkOnlineLocal.Socket();
        this.sockets.add(socket);
        let settled = false;
        const timer = this.later(() => { socket.close(); reject(new Error('浏览器战斗引擎加载超时，请刷新页面后重试。')); }, 8000);
        socket.addEventListener('open', () => {
          if (this.epoch !== epoch) { socket.close(); return; }
          socket.send(JSON.stringify(first));
        });
        socket.addEventListener('message', event => {
          if (this.epoch !== epoch) return;
          let packet;
          try { packet = JSON.parse(event.data); } catch { reject(new Error('本机服务返回了无效数据。')); return; }
          if (!settled && packet.type === 'error') { this.cancel(timer); settled = true; reject(new Error(packet.text)); socket.close(); return; }
          if (!settled && packet.type === 'room') { this.cancel(timer); settled = true; resolve({ socket, room: packet }); }
          onPacket(packet);
        });
        socket.addEventListener('error', event => { if (!settled) reject(new Error(event.message || socket.lastError || '浏览器战斗引擎加载失败，请刷新页面后重试。')); });
        socket.addEventListener('close', () => {
          this.sockets.delete(socket);
          this.cancel(timer);
          if (!settled) reject(new Error('浏览器战斗引擎已停止。'));
          else if (!this.closed && this.epoch === epoch && this.local === socket) {
            this.close(); this.emit('failure', '浏览器战斗引擎已停止，房间已关闭。请刷新后重新创建。');
          }
        });
      });
    }
    openPeer(id, options, epoch) {
      return new Promise((resolve, reject) => {
        if (!window.Peer || !window.RTCPeerConnection) { reject(new Error('浏览器不支持 WebRTC，请使用 Chrome、Edge、Thorium 或 Firefox。')); return; }
        let peer;
        const timer = this.later(() => { peer?.destroy(); reject(new Error('连接信令服务超时。请检查网络，或在网络设置中更换双方可用的信令服务。')); }, 18000);
        try { peer = new Peer(id, options); } catch (error) { this.cancel(timer); reject(error); return; }
        this.pendingPeer = peer;
        let opened = false;
        let reconnects = 0;
        peer.on('open', () => {
          this.cancel(timer);
          if (this.epoch !== epoch) { peer.destroy(); reject(new Error('连接已取消。')); return; }
          opened = true; reconnects = 0; resolve(peer);
        });
        peer.on('error', error => {
          if (this.epoch !== epoch || this.closed) return;
          if (!opened) { this.cancel(timer); peer.destroy(); reject(error); }
          else this.emit('status', { text: errorText(error), error: true });
        });
        peer.on('disconnected', () => {
          if (this.epoch !== epoch || this.closed) return;
          this.emit('status', { text: '信令暂时断开，正在恢复登记；已建立的对战连接仍可继续。' });
          const reconnect = () => {
            if (this.epoch !== epoch || this.closed || peer.destroyed || !peer.disconnected) return;
            if (++reconnects > 5) { this.emit('status', { text: '信令恢复失败。已连接玩家可继续；接纳新玩家前请重新建房。', error: true }); return; }
            try { peer.reconnect(); } catch (error) { this.emit('status', { text: errorText(error), error: true }); }
            this.later(reconnect, 3000);
          };
          this.later(reconnect, 1200);
        });
      });
    }
    wire(connection, payload, snapshot = false) {
      if (!connection?.open) return false;
      if (snapshot && connection.dataChannel?.bufferedAmount > 131072) return false;
      try { connection.send({ v: P.VERSION, ...payload }); return true; }
      catch (error) { this.emit('status', { text: '对战通道发送失败：' + error.message, error: true }); return false; }
    }
    rejectConnection(connection, text) {
      connection.on('error', () => {});
      const reject = () => { this.wire(connection, { type: 'rejected', text }); this.later(() => connection.close(), 200); };
      connection.open ? reject() : connection.once('open', reject);
      this.later(() => connection.close(), 5000);
    }
    async acceptGuest(connection, epoch) {
      const meta = connection.metadata;
      if (this.closed || this.epoch !== epoch || !meta || meta.v !== P.VERSION || !/^[0-9a-f]{32}$/.test(meta.session || '')) {
        this.rejectConnection(connection, '联机版本不一致，请双方使用新版“线上联机.cmd”。'); return;
      }
      if (this.guestToken && (meta.session !== this.guestToken || this.remote?.open || this.guestConnecting)) {
        this.rejectConnection(connection, '房间已有两位玩家，或正为掉线玩家保留座位。'); return;
      }
      this.guestConnecting = true;
      this.guestToken = meta.session;
      this.remote = connection;
      let commands = 0;
      let windowAt = Date.now();
      const timeout = this.later(() => { if (!connection.open) connection.close(); }, 25000);
      connection.on('data', value => {
        if (this.epoch !== epoch || connection !== this.remote || !value || value.v !== P.VERSION || value.type !== 'command') return;
        this.lastReceiveAt = Date.now();
        const now = Date.now();
        if (now - windowAt >= 1000) { windowAt = now; commands = 0; }
        if (++commands > 100) { connection.close(); return; }
        const command = P.command(value.command);
        if (!command) return;
        if (command.type === 'leave') { this.releaseGuest(); return; }
        if (this.proxy?.readyState === WebSocket.OPEN) this.proxy.send(JSON.stringify(command));
      });
      const opened = async () => {
        this.cancel(timeout);
        if (this.epoch !== epoch || connection !== this.remote) return;
        this.lastReceiveAt = Date.now();
        this.cancel(this.graceTimer);
        try {
          if (!this.proxy || this.proxy.readyState !== WebSocket.OPEN) {
            const local = await this.openSocket({ type: 'join', code: this.gameCode, ...P.profile(meta.profile) }, packet => {
              if (packet.type === 'room') this.lastRoom = packet;
              if (packet.type === 'snapshot') this.lastSnapshot = packet;
              this.wire(this.remote, { type: 'packet', packet }, packet.type === 'snapshot');
            }, epoch);
            if (this.epoch !== epoch) { local.socket.close(); return; }
            this.proxy = local.socket;
          }
          this.guestConnecting = false;
          this.wire(connection, { type: 'welcome', code: this.code });
          if (this.lastRoom) this.wire(connection, { type: 'packet', packet: this.lastRoom });
          if (this.lastSnapshot) this.wire(connection, { type: 'packet', packet: this.lastSnapshot });
          this.local?.send(JSON.stringify({ type: 'pause', paused: false }));
          this.emit('status', { text: '对方已连接。两人都准备后开始对战。' });
        } catch (error) {
          this.wire(connection, { type: 'rejected', text: error.message });
          this.releaseGuest();
          this.emit('status', { text: error.message, error: true });
        }
      };
      connection.on('error', error => this.emit('status', { text: '对方连接异常：' + errorText(error), error: true }));
      connection.on('close', () => {
        this.cancel(timeout);
        if (this.closed || this.epoch !== epoch || this.remote !== connection) return;
        this.guestConnecting = false;
        this.local?.send(JSON.stringify({ type: 'pause', paused: true }));
        if (this.proxy?.readyState === WebSocket.OPEN) this.proxy.send(JSON.stringify({ type: 'input', input: { move: 0, attack: false } }));
        this.emit('status', { text: '对方连接中断，已暂停战斗。为对方保留座位 20 秒。', error: true });
        this.cancel(this.graceTimer);
        this.graceTimer = this.later(() => this.releaseGuest(), GRACE);
      });
      connection.open ? opened() : connection.once('open', opened);
    }
    releaseGuest() {
      this.cancel(this.graceTimer);
      const remote = this.remote;
      this.remote = null;
      this.guestToken = null;
      this.guestConnecting = false;
      this.proxy?.close();
      this.proxy = null;
      this.lastRoom = this.lastSnapshot = null;
      remote?.close();
      if (!this.closed) this.emit('status', { text: '对方已离开，房间仍然开放，可以重新邀请。' });
    }
    connectGuest(epoch, retry = false) {
      return new Promise((resolve, reject) => {
        const connection = this.peer.connect('ink-duel-v2-' + this.code, {
          reliable: true, serialization: 'json', label: 'ink-duel-v2',
          metadata: { v: P.VERSION, session: this.session, profile: this.profile }
        });
        this.remote = connection;
        let welcomed = false;
        const timer = this.later(() => {
          reject(new Error('对战通道未连通。请确认房主在线、房间码和信令地址一致；校园网或对称 NAT 可能需要配置 TURN 中继。'));
          connection.close();
        }, retry ? Math.max(1000, Math.min(8000, this.reconnectUntil - Date.now())) : 25000);
        const peerError = error => {
          if (!welcomed && error.type === 'peer-unavailable') { this.cancel(timer); reject(new Error(errorText(error))); connection.close(); }
        };
        this.peer.on('error', peerError);
        connection.on('data', value => {
          if (this.epoch !== epoch || this.remote !== connection || !value || value.v !== P.VERSION) return;
          this.lastReceiveAt = Date.now();
          if (value.type === 'welcome') {
            this.cancel(timer); this.peer.off('error', peerError); welcomed = true; this.everConnected = true; this.reconnectUntil = 0;
            this.emit('status', { text: retry ? '连接已恢复，可以继续对战。' : '已加入房间。选择角色，准备后开战。' });
            resolve();
          } else if (value.type === 'packet' && value.packet && typeof value.packet === 'object') this.emit('packet', value.packet);
          else if (value.type === 'rejected') {
            this.cancel(timer); this.everConnected = false; reject(new Error(value.text));
            this.close(); this.emit('failure', value.text);
          }
        });
        connection.on('error', error => { if (!welcomed) { this.cancel(timer); reject(error); } });
        connection.on('close', () => {
          this.cancel(timer);
          this.peer?.off('error', peerError);
          if (!welcomed) reject(new Error('对战通道关闭。请确认房主仍在线，并检查 TURN 中继设置。'));
          if (this.closed || this.epoch !== epoch || this.remote !== connection || !this.everConnected) return;
          this.emit('lost');
          this.scheduleReconnect(epoch);
        });
      });
    }
    scheduleReconnect(epoch) {
      if (!this.reconnectUntil) this.reconnectUntil = Date.now() + GRACE - 1500;
      this.emit('status', { text: '与房主的连接中断，正在重连…', error: true });
      this.later(async () => {
        if (this.closed || this.epoch !== epoch) return;
        if (Date.now() >= this.reconnectUntil || this.peer.destroyed) {
          this.close(); this.emit('failure', '重连超时。请确认房主仍在线，再用房间码重新加入。'); return;
        }
        try { await this.connectGuest(epoch, true); }
        catch (error) {
          if (!this.closed && this.epoch === epoch) {
            if (Date.now() >= this.reconnectUntil) { this.close(); this.emit('failure', errorText(error)); }
            else this.scheduleReconnect(epoch);
          }
        }
      }, 1200);
    }
    send(value) {
      const command = P.command(value);
      if (this.closed || !command) return false;
      if (this.role === 'host') {
        if (this.local?.readyState !== WebSocket.OPEN) return false;
        this.local.send(JSON.stringify(command)); return true;
      }
      return this.wire(this.remote, { type: 'command', command });
    }
    startStats(epoch) {
      const sample = async () => {
        if (this.closed || this.epoch !== epoch) return;
        const pc = this.remote?.peerConnection;
        if (this.remote?.open && this.lastReceiveAt && Date.now() - this.lastReceiveAt > 8000) this.remote.close();
        if (pc?.connectionState === 'connected') {
          try {
            const reports = await pc.getStats();
            let selected;
            for (const report of reports.values()) if (report.type === 'transport' && report.selectedCandidatePairId) selected = reports.get(report.selectedCandidatePairId);
            if (selected) {
              const local = reports.get(selected.localCandidateId);
              const remote = reports.get(selected.remoteCandidateId);
              this.stats = { relay: local?.candidateType === 'relay' || remote?.candidateType === 'relay', rtt: Math.round((selected.currentRoundTripTime || 0) * 1000), protocol: local?.protocol };
              this.emit('path', this.stats);
            }
          } catch (error) { this.emit('diagnostic', '连接统计暂不可用：' + error.message); }
        }
        this.later(sample, 3000);
      };
      sample();
    }
    close() {
      this.closed = true;
      this.epoch++;
      for (const timer of this.timers) clearTimeout(timer);
      this.timers.clear();
      this.remote?.close();
      this.remote = null;
      this.peer?.destroy(); this.pendingPeer?.destroy();
      this.peer = this.pendingPeer = null;
      for (const socket of this.sockets) socket.close();
      this.sockets.clear();
      window.InkOnlineLocal.close();
      this.local = this.proxy = null;
      this.guestToken = this.lastRoom = this.lastSnapshot = null;
      this.guestConnecting = this.everConnected = false;
      this.reconnectUntil = 0;
      this.stats = null;
    }
  }
  window.InkOnlineTransport = OnlineTransport;
})();
