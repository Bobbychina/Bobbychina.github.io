import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { injectSiteAuth } from './site-shell.mjs';

const source = name => readFileSync(new URL('../games/' + name, import.meta.url), 'utf8');
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
function browser(fetch, options = {}) {
  const location = new URL(options.url || 'http://localhost:5180/games/dreamcore/');
  const context = vm.createContext({ location, history: { replaceState() {} }, localStorage: storage(), sessionStorage: storage(),
    URL, URLSearchParams, Headers, TextEncoder, TextDecoder, Uint8Array, AbortController, crypto: webcrypto,
    btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout, setInterval, clearInterval, fetch, console, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, ...options });
  context.window = context;
  return context;
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('online shell injects config/auth/saves in order and is idempotent', () => {
  const html = '<head><script defer src="/games/auth-config.js"></script><script defer src="/games/account.js"></script></head><body>game</body>';
  const result = injectSiteAuth(html);
  assert.equal(injectSiteAuth(result), result);
  assert.equal((result.match(/auth-config\.js/g) || []).length, 1);
  assert.ok(result.indexOf('site-auth.js') < result.indexOf('site-saves.js'));
  assert.ok(result.indexOf('site-saves.js') < result.indexOf('account.js'));
  assert.ok(result.includes('<body>game'));
  assert.ok(result.endsWith('</body>'));
  assert.equal((result.match(/id="site-language"/g) || []).length, 1);
  assert.ok(result.indexOf('i18n/i18n.js') < result.indexOf('auth-config.js'));
});
const tokens = c => c.localStorage.setItem('siteauth.tokens.v1', JSON.stringify({ 'dreamcore-walk': {
  access: 'old', refresh: 'refresh', exp: Date.now() + 600000, user: { sub: 'A' }, scope: 'saves' } }));

test('nested site config maps directory and keeps callback on the frontend origin', async () => {
  const c = browser(async () => response({ clients: [] }), { DSH_AUTH_CONFIG: { site: { relay: 'http://localhost:8099', games: { dreamcore: 'dreamcore-walk' } }, github: { relay: 'https://bobbycn.cc' } } });
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  assert.equal(c.SiteAuth._internal.endpoint('/api/test'), 'http://localhost:8099/api/test');
  assert.equal(c.SiteAuth._internal.resolveClient(), 'dreamcore-walk');
  assert.equal(c.SiteAuth._internal.redirectUri('dreamcore-walk'), 'http://localhost:5180/games/oauth-callback.html');
});

test('concurrent 401 responses rotate once and retain the user snapshot', async () => {
  let refreshes = 0;
  const c = browser(async (url, opts) => {
    if (url.includes('/clients')) return response({ clients: [] });
    if (url.includes('/token')) { refreshes++; await new Promise(r => setTimeout(r, 15)); return response({ access_token: 'new', refresh_token: 'rotated', expires_in: 600, scope: 'saves' }); }
    return response({}, opts.headers.get('Authorization') === 'Bearer new' ? 200 : 401);
  });
  tokens(c);
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  const results = await Promise.all([c.SiteAuth.authFetch('/one'), c.SiteAuth.authFetch('/two')]);
  assert.equal(refreshes, 1);
  assert.ok(results.every(r => r.ok));
  assert.equal(c.SiteAuth.user().sub, 'A');
});

test('callback without state must never exchange a code', async () => {
  let exchanges = 0;
  const c = browser(async url => { if (url.includes('/token')) exchanges++; return response({ clients: [] }); }, { url: 'http://localhost:5180/games/dreamcore/oauth-callback.html?code=untrusted' });
  c.sessionStorage.setItem('siteauth.pkce.v1', JSON.stringify({ state: 'expected', verifier: 'verifier', clientId: 'dreamcore-walk', redirectUri: c.location.origin + c.location.pathname }));
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  assert.equal(exchanges, 0);
});

test('switching accounts invalidates the cached encryption key', async () => {
  let subject = 'A', requests = 0;
  const c = browser(async () => response({}));
  c.SiteAuth = { status: () => ({ clientId: 'game', signedIn: true, user: { sub: subject } }),
    authFetch: async () => { requests++; return response({ key: Buffer.alloc(32, subject === 'A' ? 1 : 2).toString('base64') }); } };
  vm.runInContext(source('site-saves.js'), c);
  const first = await c.SiteSaves.key();
  subject = 'B';
  const second = await c.SiteSaves.key();
  assert.notEqual(first, second);
  assert.equal(requests, 2);
});

test('record synchronization reads the cloud before stamping a new local save', async () => {
  let local = { bestTime: 10, runs: 1, muted: true }, slot;
  let remote = { bestTime: 100, runs: 5, muted: false };
  const c = browser(async () => response({}));
  c.VS = { register(name, value) { this[name] = value; }, Save: { load: () => local, persist: value => { local = value; } } };
  c.DSHAccount = { currentUid: () => 'A', backend: () => 'server', savePut: (game, name, value) => { slot = { ...value }; return { ok: true }; },
    saveGet: () => slot, cloudPull: async () => { slot = { ...remote }; return { ok: true }; },
    cloudPush: async () => { remote = { ...slot }; return { ok: true }; },
    syncNow: async () => { remote = { ...slot }; return { ok: true }; } };
  vm.runInContext(source('vampire-survivors/js/core/cloud.js'), c);
  const out = await c.VS.Cloud.sync();
  assert.equal(out.ok, true);
  assert.equal(remote.bestTime, 100);
  assert.equal(local.runs, 5);
  assert.equal(local.muted, true);
});

test('mirror API routing is explicit and callback stays on the mirror', async () => {
  const c = browser(async () => response({ clients: [] }), { url: 'https://bobbychina.github.io/games/racing3d/' });
  vm.runInContext(source('auth-config.js'), c);
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  assert.equal(c.SiteAuth._internal.endpoint('/api/test'), 'https://bobbycn.cc/api/test');
  assert.equal(c.SiteAuth._internal.redirectUri('racing3d'), 'https://bobbychina.github.io/games/oauth-callback.html');
});

test('late refresh response cannot resurrect a logged-out session', async () => {
  let release, began;
  const started = new Promise(r => { began = r; });
  const c = browser(async url => {
    if (url.includes('/token')) { began(); await new Promise(r => { release = r; }); return response({ access_token: 'new', refresh_token: 'new-refresh' }); }
    return response({ clients: [] });
  });
  tokens(c);
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  const stored = JSON.parse(c.localStorage.getItem('siteauth.tokens.v1'));
  stored['dreamcore-walk'].exp = 0;
  c.localStorage.setItem('siteauth.tokens.v1', JSON.stringify(stored));
  const pending = c.SiteAuth.getAccessToken();
  await started;
  await c.SiteAuth.signOut();
  release();
  assert.equal(await pending, null);
  assert.equal(c.SiteAuth.status().signedIn, false);
});

test('a key response from an old account is rejected rather than cached', async () => {
  let subject = 'A', release;
  const c = browser(async () => response({}));
  c.SiteAuth = { status: () => ({ signedIn: true, user: { sub: subject } }), authFetch: async () => {
    await new Promise(r => { release = r; });
    return response({ key: Buffer.alloc(32, 1).toString('base64') });
  } };
  vm.runInContext(source('site-saves.js'), c);
  const pending = c.SiteSaves.key();
  subject = 'B'; release();
  await assert.rejects(pending, /账号已变更/);
  assert.equal(c.SiteSaves.rawKey(), '');
});

test('popup validates source/state and reports access_denied', async () => {
  let handler, opened = false, exchanges = 0;
  const popup = { location: {}, close() { this.closed = true; }, closed: false };
  const c = browser(async url => { if (url.includes('/token')) exchanges++; return response({ clients: [{ clientId: 'dreamcore-walk' }] }); }, {
    open() { opened = true; return popup; }, addEventListener(type, fn) { if (type === 'message') handler = fn; },
  });
  vm.runInContext(source('auth-config.js'), c);
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  const pending = c.SiteAuth.signInPopup();
  assert.equal(opened, true);
  while (!handler) await new Promise(r => setTimeout(r, 1));
  const box = JSON.parse(c.sessionStorage.getItem('siteauth.pkce.v1'));
  handler({ origin: c.location.origin, source: {}, data: { type: 'siteauth:done', state: box.state, code: 'bad' } });
  assert.equal(exchanges, 0);
  handler({ origin: c.location.origin, source: popup, data: { type: 'siteauth:error', state: box.state, error: 'access_denied' } });
  await assert.rejects(pending, /拒绝/);
});

test('a late 401 cannot retry an old write under the newly signed-in account', async () => {
  let release, began, writes = 0;
  const started = new Promise(r => { began = r; });
  const c = browser(async url => {
    if (url.includes('/clients')) return response({ clients: [] });
    writes++; began();
    await new Promise(r => { release = r; });
    return response({}, 401);
  });
  tokens(c);
  vm.runInContext(source('site-auth.js'), c);
  await c.SiteAuth.ready();
  const pending = c.SiteAuth.authFetch('/write', { method: 'PUT', body: 'account-A-save' });
  await started;
  c.localStorage.setItem('siteauth.tokens.v1', JSON.stringify({ 'dreamcore-walk': { access: 'B', refresh: 'B-refresh', exp: Date.now() + 600000, user: { sub: 'B' } } }));
  release();
  await assert.rejects(pending, /账号已变更/);
  assert.equal(writes, 1);
});

test('game shortcuts neither steal login text nor repeat toggle actions', () => {
  const handlers = {};
  let paused = 0;
  const c = browser(async () => response({}), { document: { activeElement: null }, addEventListener(type, fn) { handlers[type] = fn; } });
  c.VS = { register(name, value) { this[name] = value; } };
  vm.runInContext(source('vampire-survivors/js/core/input.js'), c);
  c.VS.Input.init({ onPause: () => { paused++; } });
  handlers.keydown({ key: 'w', code: 'KeyW', target: { tagName: 'INPUT' }, preventDefault() { throw new Error('blocked text input'); } });
  assert.equal(c.VS.Input.getAxis().y, 0);
  handlers.keydown({ key: 'p', target: { tagName: 'CANVAS' }, repeat: false });
  handlers.keydown({ key: 'p', target: { tagName: 'CANVAS' }, repeat: true });
  assert.equal(paused, 1);
});
