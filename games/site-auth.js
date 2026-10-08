/* ============================================================================
   SiteAuth —— bobbycn.cc 站点统一授权 SDK（2026-10-08）
   ----------------------------------------------------------------------------
   站点账号 -> OAuth 2.0 授权码 + PKCE（与 GitHub / 微软登录同一套协议形状）
   站内游戏与以后任何自研应用都用它「用站点账号授权登录」，不再各自维护账号表。

   公开接口（`window.SiteAuth`，也可作 ES 模块 default 导入）：
     SiteAuth.ready()                  Promise<SiteAuth>  —— 处理完回跳、恢复登录态后 resolve
     SiteAuth.available()              是否可用（后端有没有部署这套授权端点；不可用就显式降级）
     SiteAuth.status()                 { available, signedIn, user, expired, clientId }
     SiteAuth.user()                   当前用户（{sub, username, name, email, picture}）
     SiteAuth.signIn(opts)             授权登录（整页跳转；opts.game 自动算 clientId）
     SiteAuth.signInPopup(opts)        Promise —— 弹窗授权，不刷新当前页面（游戏厅用）
     SiteAuth.getAccessToken(opts)     Promise<string|null> —— 取令牌，过期自动用刷新令牌续
     SiteAuth.authFetch(url, opts)     带 Authorization 的 fetch，401 自动刷新重试一次
     SiteAuth.signOut(opts)            撤销刷新令牌 + 清本地登录态（可选 opts.global 连站点会话一起登出）
     SiteAuth.onChange(fn)             登录态变化订阅，返回取消函数

   安全口径（与后端 README 对齐）：
     · PKCE：verifier 只存 sessionStorage，一次性；授权码 120 秒、只能兑换一次；
     · access token 是 10 分钟的 EdDSA JWT —— 前端**不解析它做安全判断**，只当作通行证；
     · refresh token 存 localStorage（30 天，可随时撤销）；撤销 = 整条授权失效；
     · 用户可见的授权记录与撤销在 https://bobbycn.cc/account/。

   降级：后端没上线时 available=false，页面应当**明确告诉用户**"站点账号登录暂不可用"，
   而不是静默退回旧的本机账号（那正是这次要消灭的东西）。
   ========================================================================== */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var STORE = {
    tokens: 'siteauth.tokens.v1',     // {clientId: {access, refresh, exp, scope}}
    pkce: 'siteauth.pkce.v1',         // 只在 sessionStorage：{state, verifier, clientId, redirectUri, createdAt}
    known: 'siteauth.known.v1',       // 上次成功登录的 clientId（下次先用它，省一次探测）
  };
  var REFRESH_SKEW_MS = 60 * 1000;    // 提前 60 秒续期，避免"刚好过期"的竞态
  var FETCH_TIMEOUT_MS = 15000;
  var PROBE_CACHE_MS = 5 * 60 * 1000;

  var config = normalizeConfig(global.DSH_AUTH_CONFIG || {});
  var listeners = [];
  var probe = { at: 0, result: null, promise: null };
  var readyPromise = null;
  var lastError = '';

  // ───────────────────────── 配置与地址 ─────────────────────────

  /**
   * 站点基址：SDK 与授权端点打到哪里。
   *
   * 规则（顺序很重要）：
   *  1. 域名为 *.bobbycn.cc（含 staging）→ 用**当前源**：同源最省事，Cookie 也天然可用；
   *  2. 配置了 `site.relay`（跨源部署，或本机把游戏页面与后端分开跑）→ 用它；
   *  3. 其它情况（GitHub Pages 镜像等）→ 也用当前源，靠门户自身的中继转发 /api。
   *
   * ⚠️ 本机开发就是第 2 种：静态站在 :5180，后端在 :8099 —— 不能用当前源，
   * 否则每个 /api 请求都打到静态服务器上变成 404，而症状是"授权服务不可用"。
   */
  function siteBase() {
    var origin = '';
    try { origin = location.origin; } catch (e) { origin = ''; }
    var cfg = relay();
    if (/(^|\.)bobbycn\.cc$/.test(hostname())) return origin;
    if (cfg) return cfg;
    return origin;
  }

  function hostname() {
    try { return location.hostname || ''; } catch (e) { return ''; }
  }

  function endpoint(path) {
    return siteBase().replace(/\/+$/, '') + path;
  }

  var API = {
    clients: '/api/auth/identity/oauth/clients',
    authorize: '/api/auth/identity/oauth/authorize',
    token: '/api/auth/identity/oauth/token',
    userinfo: '/api/auth/identity/oauth/userinfo',
    revoke: '/api/auth/identity/oauth/revoke',
    revokeGrant: '/api/auth/identity/oauth/revoke-grant',
    siteMe: '/api/auth/identity/me',
    siteLogin: '/login/',
  };

  function normalizeConfig(c) {
    return {
      relay: String((c && (c.relay || (c.github && c.github.relay))) || '').replace(/\/+$/, ''),
      games: (c && c.games) || {},
      sites: (c && c.sites) || null,
    };
  }

  /**
   * 本机冒烟/联调用的**运行时覆盖**：页面在任何脚本之前设置
   * `window.DSH_AUTH_TEST_OVERRIDE = { siteRelay: '…', siteLoginBase: '…' }`，
   * 就能把授权端点/登录页指到本机，而不必改 auth-config.js（避免把开发地址带进部署产物）。
   * 每次取地址时都问一遍 override，这样"脚本先加载、测试后注入"也能生效。
   */
  function overrideRelay() {
    var o = global.DSH_AUTH_TEST_OVERRIDE;
    return o && o.siteRelay ? String(o.siteRelay).replace(/\/+$/, '') : '';
  }

  function overrideLoginBase() {
    var o = global.DSH_AUTH_TEST_OVERRIDE;
    return o && o.siteLoginBase ? String(o.siteLoginBase).replace(/\/+$/, '') : '';
  }

  function relay() {
    return overrideRelay() || config.relay || '';
  }

  /**
   * 站点基址：SDK 与授权端点打到哪里。
   *
   * 规则（顺序很重要）：
   *  1. 域名为 *.bobbycn.cc（含 staging）→ 用**当前源**：同源最省事，Cookie 也天然可用；
   *  2. 配置了 `site.relay`（跨源部署，或本机把游戏页面与后端分开跑）→ 用它；
   *  3. 其它情况（GitHub Pages 镜像等）→ 也用当前源，靠门户自身的中继转发 /api。
   *
   * ⚠️ 本机开发就是第 2 种：静态站在 :5180，后端在 :8099。不能用当前源 ——
   * 否则每个 /api 请求都打到静态服务器上变成 404，症状却是"授权服务不可用"。
   */
  function siteBase() {
    var origin = '';
    try { origin = location.origin; } catch (e) { origin = ''; }
    if (/(^|\.)bobbycn\.cc$/.test(hostname())) return origin;
    var cfg = relay();
    if (cfg) return cfg;
    return origin;
  }

  /** 当前游戏目录（用来自动推导默认回调地址） */
  function currentDir() {
    var path = '';
    try { path = location.pathname || ''; } catch (e) { path = ''; }
    if (/\.html?$/i.test(path))
      path = path.replace(/[^/]*$/, '');
    if (path.charAt(path.length - 1) !== '/')
      path += '/';
    return path;
  }

  /** client_id：显式指定 > 配置表里按目录匹配 > 用当前目录名推导 */
  function resolveClient(gameOrClient, explicit) {
    if (explicit)
      return String(explicit);
    var key = String(gameOrClient || '').trim();
    if (key) {
      var map = config.games || {};
      var hit = null;
      Object.keys(map).forEach(function (k) {
        if (hit) return;
        var v = map[k];
        var id = typeof v === 'string' ? v : (v && (v.clientId || v.client)) || '';
        if (k === key || id === key)
          hit = id || k;
      });
      if (hit)
        return hit;
      return key;
    }
    var dir = currentDir();
    var seg = dir.replace(/\/+$/, '').split('/').pop() || '';
    if (seg === 'games') return 'bobbycn-games';
    return seg || 'bobbycn-games';
  }

  function redirectUri(clientId, explicit) {
    if (explicit)
      return String(explicit);
    var map = config.games || {};
    var entry = map[clientId];
    if (entry && typeof entry !== 'string' && entry.redirect)
      return String(entry.redirect);
    return siteBase().replace(/\/+$/, '') + currentDir() + 'oauth-callback.html';
  }

  // ───────────────────────── 小工具 ─────────────────────────

  function nowMs() { return Date.now(); }

  function readJSON(store, key, def) {
    try {
      var raw = store.getItem(key);
      return raw ? JSON.parse(raw) : def;
    } catch (e) { return def; }
  }
  function writeJSON(store, key, value) {
    try { store.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function removeKey(store, key) { try { store.removeItem(key); } catch (e) { /* ignore */ } }

  function b64url(bytes) {
    var str = '';
    for (var i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomVerifier() {
    var buf = new Uint8Array(32);
    (global.crypto || global.msCrypto).getRandomValues(buf);
    return b64url(buf);
  }

  function sha256b64url(text) {
    var data = new TextEncoder().encode(text);
    return global.crypto.subtle.digest('SHA-256', data).then(function (digest) {
      return b64url(new Uint8Array(digest));
    });
  }

  async function fetchTimeout(url, opts, ms) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {}));
    } finally { clearTimeout(timer); }
  }

  function emit() {
    var snapshot = status();
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot); } catch (e) { if (global.console) console.warn('[SiteAuth] listener', e); }
    });
    try { global.dispatchEvent(new CustomEvent('site-auth:change', { detail: snapshot })); } catch (e) { /* 老浏览器 */ }
  }

  // ───────────────────────── 令牌存取 ─────────────────────────

  function allTokens() { return readJSON(localStorage, STORE.tokens, {}); }

  function tokenFor(clientId) { return allTokens()[clientId] || null; }

  function saveTokens(clientId, payload) {
    var box = allTokens();
    box[clientId] = {
      access: payload.access_token,
      refresh: payload.refresh_token || (box[clientId] && box[clientId].refresh) || '',
      exp: nowMs() + (Number(payload.expires_in) || 600) * 1000,
      scope: payload.scope || '',
      savedAt: nowMs(),
    };
    writeJSON(localStorage, STORE.tokens, box);
    writeJSON(localStorage, STORE.known, clientId);
    lastError = '';
    emit();
    return box[clientId];
  }

  function clearTokens(clientId) {
    var box = allTokens();
    if (clientId) delete box[clientId];
    else box = {};
    writeJSON(localStorage, STORE.tokens, box);
    emit();
    return box;
  }

  /** 本地用户快照（由 /userinfo 或令牌响应写入）；只用于显示，不作为鉴权依据 */
  function userCache(clientId) {
    var entry = tokenFor(clientId);
    return entry && entry.user ? entry.user : null;
  }

  function cacheUser(clientId, user) {
    var box = allTokens();
    if (!box[clientId]) return;
    box[clientId].user = user;
    writeJSON(localStorage, STORE.tokens, box);
    emit();
  }

  // ───────────────────────── 能力探测 ─────────────────────────

  /**
   * 后端有没有部署授权系统？探测 `/clients`（公开只读）。
   * 结果缓存 5 分钟；失败也缓存（避免每个页面都打一次不可达的端点）。
   */
  function available(force) {
    if (!force && probe.result !== null && nowMs() - probe.at < PROBE_CACHE_MS)
      return Promise.resolve(probe.result);
    if (probe.promise)
      return probe.promise;
    probe.promise = fetchTimeout(endpoint(API.clients), { headers: { Accept: 'application/json' } }, 8000)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var ok = !!(data && Array.isArray(data.clients) && data.clients.length);
        probe = { at: nowMs(), result: ok, promise: null, scopes: (data && data.scopes) || null, clients: (data && data.clients) || [] };
        return ok;
      })
      .catch(function () {
        probe = { at: nowMs(), result: false, promise: null };
        return false;
      });
    return probe.promise;
  }

  function scopeCatalog() { return probe.scopes || null; }
  function clientCatalog() { return probe.clients || []; }

  // ───────────────────────── 回跳处理 ─────────────────────────

  function parseCallback() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return null; }
    var code = params.get('code');
    var error = params.get('error');
    if (!code && !error)
      return null;
    return {
      code: code || '',
      error: error || '',
      description: params.get('error_description') || '',
      state: params.get('state') || '',
    };
  }

  /** 去掉地址栏里的授权参数（避免用户刷新/分享时把一次性 code 带出去） */
  function cleanUrl() {
    try {
      var url = new URL(location.href);
      ['code', 'state', 'error', 'error_description', 'scope'].forEach(function (k) { url.searchParams.delete(k); });
      history.replaceState(null, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash);
    } catch (e) { /* ignore */ }
  }

  function pkceBox() { return readJSON(sessionStorage, STORE.pkce, null); }
  function savePkce(box) { writeJSON(sessionStorage, STORE.pkce, box); }
  function clearPkce() { removeKey(sessionStorage, STORE.pkce); }

  /** 交换授权码（PKCE 校验 verifier） */
  async function exchangeCode(clientId, code, verifier, redir) {
    var body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: code,
      redirect_uri: redir,
      code_verifier: verifier,
    });
    var res = await fetchTimeout(endpoint(API.token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || !data.access_token) {
      var why = (data && (data.error_description || data.error)) || ('HTTP ' + res.status);
      throw new Error('授权码兑换失败：' + why);
    }
    var entry = saveTokens(clientId, data);
    if (data.user) cacheUser(clientId, data.user);
    return entry;
  }

  /** 处理回跳（页面加载时自动跑一次）；返回 {clientId, ok, error} */
  async function handleRedirect() {
    var cb = parseCallback();
    if (!cb)
      return { handled: false };
    var box = pkceBox();
    cleanUrl();
    if (cb.error) {
      clearPkce();
      var denied = cb.error === 'access_denied';
      lastError = denied ? '你拒绝了这次授权' : ('授权失败：' + (cb.description || cb.error));
      emit();
      return { handled: true, ok: false, denied: denied, error: lastError };
    }
    if (!box || !box.verifier) {
      // 常见原因：授权是在另一个浏览器/隐私窗口里完成的，sessionStorage 里没有 verifier
      lastError = '这次授权的临时凭据已失效（可能是换了浏览器窗口或标签），请重新点一次登录';
      emit();
      return { handled: true, ok: false, error: lastError };
    }
    if (cb.state && box.state && cb.state !== box.state) {
      clearPkce();
      lastError = '授权状态校验失败（state 不一致），已中止';
      emit();
      return { handled: true, ok: false, error: lastError };
    }
    try {
      var entry = await exchangeCode(box.clientId, cb.code, box.verifier, box.redirectUri);
      clearPkce();
      return { handled: true, ok: true, clientId: box.clientId, entry: entry };
    } catch (e) {
      clearPkce();
      lastError = (e && e.message) || '授权码兑换失败';
      emit();
      return { handled: true, ok: false, error: lastError };
    }
  }

  // ───────────────────────── 登录 ─────────────────────────

  function authorizeUrl(clientId, redir, state, challenge) {
    return endpoint(API.authorize) + '?' + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redir,
      response_type: 'code',
      scope: 'openid profile email saves arcade',
      state: state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  }

  /** 整页跳转到授权页（最稳的一条路：没有任何弹窗拦截问题） */
  async function signIn(opts) {
    opts = opts || {};
    var clientId = resolveClient(opts.game, opts.clientId);
    var redir = redirectUri(clientId, opts.redirectUri);
    var verifier = randomVerifier();
    var challenge = await sha256b64url(verifier);
    var state = b64url((global.crypto || global.msCrypto).getRandomValues(new Uint8Array(16)));
    /* returnTo：调用方页面所在的目录。回调页是所有游戏共用的一份文件，
       它没法从自己的路径推出调用方是谁 —— 记在这里，回跳时才能把 code 送回正确的页面。 */
    savePkce({ state: state, verifier: verifier, clientId: clientId, redirectUri: redir, returnTo: currentDir(), createdAt: nowMs() });
    var url = authorizeUrl(clientId, redir, state, challenge);
    if (opts.popup) return url;
    location.href = url;
    return url;
  }

  /**
   * 弹窗授权（游戏厅与"内嵌游戏"用）：不刷新当前页面，授权完成后 resolve。
   * 失败/被拦截/超时都会给出明确原因 —— 调用方据此显示"点这里重新授权"。
   */
  function signInPopup(opts) {
    opts = opts || {};
    return signIn(Object.assign({}, opts, { popup: true })).then(function (url) {
      return new Promise(function (resolve, reject) {
        var w = global.open(url, 'siteauth', 'width=520,height=680,menubar=no,toolbar=no');
        if (!w) {
          reject(new Error('弹窗被浏览器拦截了：请允许本站弹窗，或用「整页登录」'));
          return;
        }
        var done = false;
        var timer = setInterval(function () {
          if (done) return;
          // 用户在弹窗里点了拒绝会回到本页（授权页 302 到 redirect_uri，Redirect 的目标是 oauth-callback.html，
          // 它把结果 postMessage 回来），因此这里只等消息 + 检测弹窗被关掉
          if (w.closed) {
            done = true;
            clearInterval(timer);
            var box = pkceBox();
            if (box) {
              clearPkce();
              reject(new Error('授权窗口被关掉了（未完成授权）'));
            } else {
              resolve({ ok: true }); // 已经完成过兑换（消息可能先到）
            }
          }
        }, 400);

        function onMessage(e) {
          if (e.origin !== siteBase().replace(/\/+$/, '') && e.origin !== location.origin) return;
          var d = e.data || {};
          if (!d || d.type !== 'siteauth:done') return;
          done = true;
          clearInterval(timer);
          global.removeEventListener('message', onMessage);
          try { w.close(); } catch (err) { /* ignore */ }
          var box = pkceBox();
          if (!box) { resolve({ ok: true }); return; }
          exchangeCode(box.clientId, d.code, box.verifier, box.redirectUri)
            .then(function () { clearPkce(); resolve({ ok: true, clientId: box.clientId }); })
            .catch(function (err) { clearPkce(); reject(err); });
        }
        global.addEventListener('message', onMessage);
      });
    });
  }

  // ───────────────────────── 令牌续期与带令牌请求 ─────────────────────────

  function refreshTokens(clientId, refresh) {
    var body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh });
    return fetchTimeout(endpoint(API.token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    }).then(function (res) {
      return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    }).then(function (out) {
      if (!out.ok || !out.data || !out.data.access_token) {
        var why = (out.data && (out.data.error_description || out.data.error)) || ('HTTP ' + out.status);
        clearTokens(clientId);
        lastError = '登录已失效，请重新授权（' + why + '）';
        emit();
        return null;
      }
      return saveTokens(clientId, out.data);
    });
  }

  var inflightRefresh = {};

  /** 取访问令牌：没过期直接用；过期/快过期就用刷新令牌换；都没有则返回 null */
  /**
   * 取令牌时用哪个 client：显式指定 > 页面级 client（有令牌就用）> 本浏览器最近登录过的 client。
   * 与 activeClientId 同一套回退逻辑 —— 跨游戏的管理页（/account/）靠它才能拿到令牌。
   */
  function clientForToken(opts) {
    opts = opts || {};
    if (opts.clientId)
      return String(opts.clientId);
    var resolved = resolveClient(opts.game, null);
    if (tokenFor(resolved))
      return resolved;
    return activeClientId();
  }

  /** 待刷新的令牌：按 clientForToken 决定用哪个身份 */
  async function getAccessToken(opts) {
    opts = opts || {};
    var clientId = clientForToken(opts);
    var entry = tokenFor(clientId);
    if (!entry || !entry.access)
      return null;
    if (entry.exp - REFRESH_SKEW_MS > nowMs())
      return entry.access;
    if (!entry.refresh)
      return null;
    if (!inflightRefresh[clientId]) {
      inflightRefresh[clientId] = refreshTokens(clientId, entry.refresh).finally(function () {
        delete inflightRefresh[clientId];
      });
    }
    var fresh = await inflightRefresh[clientId];
    return fresh && fresh.access ? fresh.access : null;
  }

  /** 带令牌的 fetch：401 时强制刷新重试一次 */
  async function authFetch(url, opts) {
    opts = opts || {};
    var clientId = clientForToken(opts);
    var token = await getAccessToken({ clientId: clientId });
    if (!token)
      throw new Error(lastError || '还没有授权登录');
    var headers = Object.assign({}, opts.headers || {});
    headers.Authorization = 'Bearer ' + token;
    var res = await fetch(url, Object.assign({}, opts, { headers: headers }));
    if (res.status !== 401)
      return res;
    var entry = tokenFor(clientId);
    if (!entry || !entry.refresh)
      return res;
    var fresh = await refreshTokens(clientId, entry.refresh);
    if (!fresh || !fresh.access)
      return res;
    headers.Authorization = 'Bearer ' + fresh.access;
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  // ───────────────────────── 站点会话 / 登出 / 状态 ─────────────────────────

  /** 站点级登录态（域级 Cookie），用于判断"要不要先让他去登录站点账号" */
  function siteSession() {
    return fetchTimeout(endpoint(API.siteMe), { credentials: 'include', cache: 'no-store' }, 8000)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /**
   * 站点登录页地址。
   * 登录页是**静态页面**，线上与授权端点同源（bobbycn.cc/login/）；
   * 本机开发时静态站在另一个端口，故允许 override 单独指定（见 overrideLoginBase）。
   */
  function siteLoginUrl(next) {
    var target = String(next || location.href);
    var path = target.replace(siteBase(), '');
    var base = overrideLoginBase();
    if (base) return base + API.siteLogin + '?next=' + encodeURIComponent(path);
    return endpoint(API.siteLogin) + '?next=' + encodeURIComponent(path);
  }

  /** 登出：撤销刷新令牌（整条授权）；opts.global=true 时连站点会话一起登出 */
  async function signOut(opts) {
    opts = opts || {};
    var clientId = resolveClient(opts.game, opts.clientId);
    var entry = tokenFor(clientId);
    if (entry && entry.refresh) {
      try {
        var body = new URLSearchParams({ client_id: clientId, token: entry.refresh });
        await fetchTimeout(endpoint(API.revoke), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }, 8000);
      } catch (e) { /* 网络失败也要清本地，避免"看着还登录着" */ }
    }
    clearTokens(clientId);
    if (opts.global) {
      try {
        await fetchTimeout(endpoint('/api/auth/identity/logout'), { method: 'POST', credentials: 'include' }, 8000);
      } catch (e) { /* ignore */ }
    }
    return { ok: true };
  }

  /**
   * "当前页面在用的 client_id"。
   *
   * 页面目录能唯一确定 client 时（/games/xxx/）就用它；像 `/account/` 这种**跨游戏的管理页**，
   * 目录名不对应任何 client —— 那就回退到"这个浏览器里最近登录过的那个 client"，
   * 否则用户会遇到"明明登录了，账号页却说不认识我"。
   */
  function activeClientId() {
    var resolved = resolveClient(null, null);
    if (tokenFor(resolved))
      return resolved;
    var known = readJSON(localStorage, STORE.known, '');
    if (known && tokenFor(known))
      return known;
    var box = allTokens();
    var keys = Object.keys(box);
    for (var i = 0; i < keys.length; i++) {
      if (box[keys[i]] && box[keys[i]].access)
        return keys[i];
    }
    return resolved;
  }

  function status() {
    var clientId = activeClientId();
    var entry = tokenFor(clientId);
    var alive = !!entry && (entry.exp - REFRESH_SKEW_MS > nowMs() || !!entry.refresh);
    return {
      version: VERSION,
      available: probe.result === true,
      probed: probe.result !== null,
      clientId: clientId,
      signedIn: alive,
      expired: !!entry && entry.exp - REFRESH_SKEW_MS <= nowMs() && !entry.refresh,
      user: entry && entry.user ? entry.user : null,
      scope: entry ? entry.scope : '',
      error: lastError,
    };
  }

  function user() {
    return userCache(activeClientId());
  }

  /** 主动拉一次 /userinfo 并缓存（用于显示头像/昵称；失败时静默返回缓存） */
  function refreshProfile(opts) {
    opts = opts || {};
    var clientId = clientForToken(opts);
    return authFetch(endpoint(API.userinfo), { clientId: clientId }).then(function (res) {
      if (!res.ok) return userCache(clientId);
      return res.json().then(function (u) { cacheUser(clientId, u); return u; });
    }).catch(function () { return userCache(clientId); });
  }

  // ───────────────────────── 初始化 ─────────────────────────

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async function () {
      var redirected = { handled: false };
      try { redirected = await handleRedirect(); } catch (e) { /* 回跳失败也别卡住页面 */ }
      await available();
      // 有本地令牌但还没拉过用户信息：补一次（失败不影响可用性）
      var clientId = resolveClient(null, null);
      var entry = tokenFor(clientId);
      if (entry && !entry.user) {
        try { await refreshProfile({ clientId: clientId }); } catch (e) { /* ignore */ }
      }
      var snap = status();
      snap.redirect = redirected;
      try { global.dispatchEvent(new CustomEvent('site-auth:ready', { detail: snap })); } catch (e) { /* ignore */ }
      emit();
      return api;
    })();
    return readyPromise;
  }

  var api = {
    version: VERSION,
    ready: ready,
    available: available,
    scopeCatalog: scopeCatalog,
    clientCatalog: clientCatalog,
    status: status,
    user: user,
    refreshProfile: refreshProfile,
    signIn: signIn,
    signInPopup: signInPopup,
    signOut: signOut,
    getAccessToken: getAccessToken,
    authFetch: authFetch,
    siteSession: siteSession,
    siteLoginUrl: siteLoginUrl,
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    onReady: ready,
    _internal: { endpoint: endpoint, siteBase: siteBase, resolveClient: resolveClient, redirectUri: redirectUri, api: API, handleRedirect: handleRedirect, probe: function () { return probe; } },
  };

  global.SiteAuth = api;
  // 自动跑一次初始化：游戏脚本通常在 DOMContentLoaded 之后才读 SiteAuth，
  // 但页面加载即开始处理回跳，能少一次"先闪未登录再变已登录"
  ready();
})(typeof window !== 'undefined' ? window : globalThis);
