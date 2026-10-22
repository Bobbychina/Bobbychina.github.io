// Browser regression checks with synthetic sessions; no production requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const user = { id: 'test-user', sub: 'test-user', username: 'TestPlayer', email: 'player@example.test' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

test('game hall uses site session and game authorization consistently', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXE || 'C:/Users/lenovo/AppData/Local/Thorium/Application/thorium.exe',
    ...(process.env.AUTH_PROXY ? { proxy: { server: process.env.AUTH_PROXY } } : {}) });
  t.after(() => browser.close());

  async function visit(t, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [], calls = [];
    let signedIn = options.signedIn !== false;
    page.on('pageerror', e => errors.push(e.message));
    await context.addInitScript(({ authorized, user }) => {
      localStorage.setItem('bobbychina.lang', 'zh-CN');
      if (authorized && !sessionStorage.getItem('fixture-seeded')) {
        localStorage.setItem('siteauth.tokens.v1', JSON.stringify({ 'bobbycn-games': {
          access: 'test-access', refresh: 'test-refresh', exp: Date.now() + 600000, user,
        } }));
        sessionStorage.setItem('fixture-seeded', 'yes');
      }
    }, { authorized: options.authorized, user });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://bobbycn.cc') return route.abort();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname.startsWith('/api/')) {
        calls.push(url.pathname);
        if (url.pathname.endsWith('/identity/me')) {
          if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
          return json(signedIn ? user : {}, signedIn ? 200 : 401);
        }
        if (url.pathname.endsWith('/clients')) return json({ clients: options.unavailable ? [] : [{ clientId: 'bobbycn-games' }] });
        if (url.pathname.endsWith('/logout')) signedIn = false;
        return json({ ok: true });
      }
      if (url.pathname === '/games/account.js' && options.authorized) {
        return route.fulfill({ contentType: 'text/javascript', body: `
          var hall = ${options.linkFail ? 'null' : JSON.stringify({ name: user.username, server: true })};
          window.DSHAccount = {
            current: () => hall, onChange() {},
            signInSite: async () => { window.linkAttempts = (window.linkAttempts || 0) + 1; return { ok: false }; },
            logout: async () => { hall = null; }
          };` });
      }
      if (process.env.AUTH_LIVE === '1') return route.continue();
      try {
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') + (url.pathname.endsWith('/') ? 'index.html' : '');
        const file = path.resolve(root, relative);
        if (!file.startsWith(root) || relative.split('/').some(part => part.startsWith('.'))) return route.abort();
        const body = process.env.AUTH_RELEASE_ROOT
          ? await readFile(path.join(process.env.AUTH_RELEASE_ROOT, relative)).catch(() => readFile(file))
          : await readFile(file);
        return route.fulfill({ contentType: mime[path.extname(file)] || 'application/octet-stream', body });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await page.goto('https://bobbycn.cc/games/');
    await page.waitForFunction(() => !document.querySelector('#acct-who').textContent.includes('正在读'));
    t.after(() => assert.deepEqual(errors, []));
    return { page, calls };
  }

  await t.test('Cookie login without grant shows the same user and an authorization action', async t => {
    const { page, calls } = await visit(t, { delay: 100 });
    assert.equal(await page.locator('#meName').textContent(), user.username);
    assert.match(await page.locator('#acct-who').textContent(), /TestPlayer.*已登录/);
    assert.equal(await page.locator('#btn-acct').textContent(), '授权游戏厅');
    assert.match(await page.locator('#acct-prov').textContent(), /授权游戏厅后开启云存档/);
    assert.equal(calls.filter(p => p.endsWith('/identity/me')).length, 1);
    if (process.env.AUTH_SCREENSHOT_DIR) {
      await mkdir(process.env.AUTH_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.AUTH_SCREENSHOT_DIR, 'games-auth-fixed.png') });
    }
    await page.evaluate(() => I18N.set('en'));
    await page.waitForFunction(() => document.querySelector('#btn-acct').textContent === 'Authorize arcade');
    assert.match(await page.locator('#acct-who').textContent(), /Signed in.*TestPlayer/);
    await page.locator('#btn-acct').click();
    await page.waitForURL('**/api/auth/identity/oauth/authorize?**');
    assert.equal(new URL(page.url()).searchParams.get('client_id'), 'bobbycn-games');
  });

  await t.test('guest remains signed out', async t => {
    const { page } = await visit(t, { signedIn: false });
    assert.equal(await page.locator('#meBox').isHidden(), true);
    assert.match(await page.locator('#acct-who').textContent(), /未登录/);
    assert.equal(await page.locator('#btn-acct').textContent(), '用站点账号登录');
  });

  await t.test('unavailable authorization does not mislabel a Cookie login', async t => {
    const { page } = await visit(t, { unavailable: true });
    assert.match(await page.locator('#acct-who').textContent(), /TestPlayer.*已登录/);
    assert.equal(await page.locator('#btn-acct').isDisabled(), true);
    assert.match(await page.locator('#acct-prov').textContent(), /暂不可用/);
  });

  await t.test('authorization changes immediately update the hall', async t => {
    const { page } = await visit(t, { authorized: true });
    assert.match(await page.locator('#acct-who').textContent(), /已登录 TestPlayer/);
    assert.equal(await page.locator('#btn-acct').textContent(), '账号与云存档');
    await page.evaluate(() => SiteAuth.signOut());
    assert.equal(await page.locator('#btn-acct').textContent(), '授权游戏厅');
    assert.match(await page.locator('#acct-who').textContent(), /TestPlayer.*已登录/);
  });

  await t.test('failed legacy connection stops loading and can retry without another login form', async t => {
    const { page } = await visit(t, { authorized: true, linkFail: true });
    await page.waitForFunction(() => document.querySelector('#acct-who').textContent.includes('连接失败'));
    assert.equal(await page.locator('#btn-acct').isEnabled(), true);
    assert.equal(await page.evaluate(() => window.linkAttempts), 1);
    await page.locator('#btn-acct').click();
    await page.waitForFunction(() => window.linkAttempts === 2);
    assert.equal(await page.locator('#ov').isVisible(), false);
  });

  await t.test('header logout clears site session and active game authorization', async t => {
    const { page, calls } = await visit(t, { authorized: true });
    await page.locator('#btnOut').click();
    await page.waitForFunction(() => document.querySelector('#acct-who')?.textContent.includes('未登录'));
    assert.equal(await page.locator('#meBox').isHidden(), true);
    assert.equal(await page.evaluate(() => SiteAuth.status().signedIn), false);
    assert.ok(calls.some(p => p.endsWith('/revoke')));
    assert.ok(calls.some(p => p.endsWith('/logout')));
  });
});
