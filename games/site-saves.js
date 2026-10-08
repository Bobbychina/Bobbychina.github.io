/* ============================================================================
   SiteSaves —— 站点云存档（服务端托管密钥）客户端 SDK（2026-10-08）
   ----------------------------------------------------------------------------
   为什么要换掉老方案：老存档的加密钥匙由「游戏厅口令」派生 —— 改口令就换钥匙，
   换设备/换登录方式（第三方登录）就拿不到那把钥匙，档案等于锁死。
   新方案把钥匙托管给站点身份：登录站点账号 → 取一次钥匙 → 所有游戏共用，
   与口令、与第三方绑定完全解耦。

   接口（`window.SiteSaves`）：
     SiteSaves.available()                 Promise<boolean> —— 后端有没有托管存档
     SiteSaves.key()                       Promise<CryptoKey|null> —— 身份存档钥匙（缓存内存里）
     SiteSaves.put(game, slot, obj, meta)  Promise<{ok, bytes, updatedAt}>
     SiteSaves.get(game, slot)             Promise<{data, meta, updatedAt}|null>
     SiteSaves.list(game)                  Promise<[{slot, bytes, updatedAt, meta, migrated}]>
     SiteSaves.remove(game, slot)          Promise<{ok}>
     SiteSaves.summary()                   Promise<{games, totalSlots, needsMigration, hint}>
     SiteSaves.importLegacy(game, slot, obj, meta)
                                           把「用旧办法解出来的明文」用新钥匙重新加密上传（标记 migrated）
     SiteSaves.plain(env)                 解一份密文信封（迁移脚本读老存档时用）

   密文口径（与后端 game-saves 模块对齐）：
     AES-256-GCM；信封 = `site-save-v1.<iv b64>.<ciphertext b64>`（GCM tag 附在密文尾部，WebCrypto 行为）。
     钥匙来自 /api/auth/identity/saves/key（Bearer access_token，需 saves scope），只缓存在内存里。
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var ENVELOPE_PREFIX = 'site-save-v1';
  var SAVES_PATH = '/api/auth/identity/saves';
  var keyCache = null;      // CryptoKey（内存；刷新页面即忘）
  var rawKeyHex = '';       // 迁移/排障用：拿原始字节（不落盘）

  function auth() { return global.SiteAuth || null; }

  function endpoint(path) {
    var a = auth();
    if (a && a._internal && a._internal.endpoint) return a._internal.endpoint(path);
    return path;
  }

  function b64encode(buf) {
    var bytes = new Uint8Array(buf), str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str);
  }
  function b64decode(text) {
    var raw = atob(String(text || ''));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function cryptoObj() { return global.crypto || global.msCrypto; }

  /** 是否可用：需要 SDK 可用 + 已授权登录 + 后端有 saves 端点 */
  async function available() {
    var a = auth();
    if (!a) return false;
    var ok = await a.available();
    if (!ok) return false;
    var token = await a.getAccessToken();
    return !!token;
  }

  /** 取身份存档钥匙（32 字节 → AES-GCM CryptoKey）；同一页面只取一次 */
  async function key(force) {
    if (keyCache && !force) return keyCache;
    var a = auth();
    if (!a) throw new Error('没有加载 SiteAuth');
    var res = await a.authFetch(endpoint(SAVES_PATH + '/key'), { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) throw new Error('站点授权已失效，请重新授权登录');
      throw new Error('取存档钥匙失败（HTTP ' + res.status + '）');
    }
    var data = await res.json();
    if (!data || !data.key) throw new Error('后端没有返回存档钥匙');
    var raw = b64decode(data.key);
    if (raw.length !== 32) throw new Error('存档钥匙长度异常（应为 32 字节）');
    rawKeyHex = Array.prototype.map.call(raw, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    keyCache = await cryptoObj().subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return keyCache;
  }

  function rawKey() { return rawKeyHex; }

  /** 加密：明文对象 → `site-save-v1.<iv>.<密文>` */
  async function seal(obj) {
    var k = await key();
    var iv = new Uint8Array(12);
    cryptoObj().getRandomValues(iv);
    var plain = new TextEncoder().encode(JSON.stringify(obj));
    var ct = await cryptoObj().subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, plain);
    return [ENVELOPE_PREFIX, b64encode(iv), b64encode(ct)].join('.');
  }

  /** 解密：接受 `site-save-v1.<iv>.<密文>`；格式不对返回 null（而不是抛错，调用方可回退老格式） */
  async function open(env) {
    var text = String(env || '');
    if (text.indexOf(ENVELOPE_PREFIX + '.') !== 0) return null;
    var parts = text.split('.');
    if (parts.length !== 3) return null;
    var k = await key();
    try {
      var iv = b64decode(parts[1]);
      var ct = b64decode(parts[2]);
      var plain = await cryptoObj().subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) {
      // 钥匙不对 / 密文损坏：明确报错，别返回 null 让调用方当成"格式不对"
      throw new Error('存档解密失败（钥匙不匹配或数据损坏）');
    }
  }

  function isEnvelope(text) { return String(text || '').indexOf(ENVELOPE_PREFIX + '.') === 0; }

  // ───────────────────────── 服务端读写 ─────────────────────────

  async function call(path, opts) {
    var a = auth();
    if (!a) throw new Error('没有加载 SiteAuth');
    var res = await a.authFetch(endpoint(path), Object.assign({ headers: { Accept: 'application/json' } }, opts || {}));
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      var msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function put(game, slot, obj, meta, migrated) {
    var env = await seal(obj);
    var qs = '?game=' + encodeURIComponent(game) + '&slot=' + encodeURIComponent(slot);
    var out = await call(SAVES_PATH + qs, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: env, meta: meta || null, migrated: !!migrated }),
    });
    return { ok: !!(out && out.ok), bytes: (out && out.bytes) || 0, updatedAt: out && out.updatedAt, sha256: out && out.sha256 };
  }

  /** 读存档并解密；没有这份存档返回 null（调用方可回退到本地/老存档） */
  async function get(game, slot) {
    var qs = '?game=' + encodeURIComponent(game) + '&slot=' + encodeURIComponent(slot);
    var row;
    try {
      row = await call(SAVES_PATH + '/one' + qs, { method: 'GET' });
    } catch (e) {
      if (e.status === 404) return null;
      if (e.status === 401 || e.status === 403) {
        var err = new Error('站点授权已失效，请重新授权登录');
        err.status = e.status;
        throw err;
      }
      throw e;
    }
    if (!row || !row.data) return null;
    var data = await open(row.data);
    return { data: data, meta: row.meta || null, updatedAt: row.updatedAt, migrated: !!row.migrated, raw: row.data };
  }

  async function list(game) {
    var out = await call(SAVES_PATH + '?game=' + encodeURIComponent(game), { method: 'GET' });
    return (out && out.slots) || [];
  }

  async function remove(game, slot) {
    var qs = '?game=' + encodeURIComponent(game) + '&slot=' + encodeURIComponent(slot);
    var out = await call(SAVES_PATH + qs, { method: 'DELETE' });
    return { ok: !!(out && out.ok), removed: (out && out.removed) || 0 };
  }

  async function summary() {
    return call(SAVES_PATH + '/summary', { method: 'GET' });
  }

  /**
   * 迁移一份老存档：调用方负责用**老办法**解出明文（老口令派生的钥匙或旧 Gist），
   * 这里用新钥匙重新加密上传，并打上 migrated 标记（引导据此收敛）。
   */
  async function importLegacy(game, slot, obj, meta) {
    return put(game, slot, obj, meta || null, true);
  }

  /**
   * 一次性把某游戏的**本地**存档全部搬到服务端（老用户换设备的常规路径）。
   * localSlots: [{slot, data, updatedAt}]（由调用方从旧存储读出来，明文）
   */
  async function importMany(game, localSlots) {
    var out = { ok: 0, failed: [] };
    for (var i = 0; i < (localSlots || []).length; i++) {
      var row = localSlots[i];
      try {
        await importLegacy(game, row.slot, row.data, row.meta || null);
        out.ok++;
      } catch (e) {
        out.failed.push({ slot: row.slot, err: (e && e.message) || String(e) });
      }
    }
    return out;
  }

  global.SiteSaves = {
    version: VERSION,
    available: available,
    key: key,
    rawKey: rawKey,
    seal: seal,
    open: open,
    isEnvelope: isEnvelope,
    plain: open,
    put: put,
    get: get,
    list: list,
    remove: remove,
    summary: summary,
    importLegacy: importLegacy,
    importMany: importMany,
    forgetKey: function () { keyCache = null; rawKeyHex = ''; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
