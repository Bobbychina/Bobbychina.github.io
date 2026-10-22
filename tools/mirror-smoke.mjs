// Exercise the generated release at both real mirror origins without publishing or logging in.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const [root, output] = process.argv.slice(2).map(p => resolve(p));
if (!root || !output) throw new Error('Usage: node tools/mirror-smoke.mjs <release> <evidence>');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXE || 'C:/Users/lenovo/AppData/Local/Thorium/Application/thorium.exe' });
const results = [];
try {
  for (const host of ['bobbychina.github.io', 'bobbychina-games.pages.dev']) {
    const origin = 'https://' + host;
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [], missing = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) {
        const data = url.pathname.startsWith('/api/blog/comments') ? { comments: [], total: 0 } : url.pathname.startsWith('/api/blog') ? { views: {} } : { clients: [], ok: false };
        return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (url.hostname === 'bobbycn.cc' || url.hostname === 'game.bobbycn.cc')
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Main site destination</title><body>Main site</body>' });
      if (url.origin !== origin) return route.abort();
      const name = decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : '');
      const file = resolve(root, '.' + name);
      if (!file.startsWith(root + sep)) return route.fulfill({ status: 403, body: 'Forbidden' });
      try {
        return route.fulfill({ status: 200, contentType: mime[extname(file)] || 'application/octet-stream', body: await readFile(file) });
      } catch {
        if (extname(file) && extname(file) !== '.html') missing.push(url.pathname);
        return route.fulfill({ status: 404, contentType: 'text/html', body: await readFile(join(root, '404.html')) });
      }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/');
    await page.locator('#mirror-notice').waitFor();
    assert.match(await page.locator('#btnIn').getAttribute('href'), /^https:\/\/bobbycn.cc\/login\//);
    const homeTitle = await page.title();
    await page.screenshot({ path: join(output, host + '-home.png') });
    await page.locator('.tabs a[href="/posts/"]').click();
    assert.equal(new URL(page.url()).pathname, '/posts/');
    assert.notEqual(await page.title(), homeTitle);
    assert.doesNotMatch(await page.title(), /blog\.pageTitle/);
    await page.screenshot({ path: join(output, host + '-posts.png') });
    await page.locator('a[href="/posts/self-hosted-in-tokyo/"]').first().click();
    await page.locator('#post').waitFor({ state: 'visible' });
    assert.equal(new URL(page.url()).origin, origin);
    assert.match(await page.title(), /把站搬到自己机器上/);
    assert.ok((await page.locator('#post').innerText()).length > 300);
    for (const route of ['/posts/WeirdStuff2/', '/posts/pure-test/', '/sponsor/']) {
      await page.goto(origin + route);
      assert.equal(await page.locator('#mirror-notice').count(), 1);
      assert.doesNotMatch(await page.title(), /^site\.copy\./);
    }
    await page.goto(origin + '/games/');
    await page.screenshot({ path: join(output, host + '-games.png') });
    for (const route of ['/games/zombie-survival/', '/games/racing3d/', '/games/vampire-survivors/']) {
      await page.goto(origin + route, { waitUntil: 'load' });
      assert.equal(await page.locator('#mirror-notice').count(), 1);
      assert.deepEqual(await page.evaluate(() => [!!window.SiteAuth, !!window.SiteSaves, !!window.DSHAccount]), [true, true, true]);
      if (route.includes('zombie-survival')) assert.equal(await page.evaluate(() => Number.isFinite(window.baseLevel())), true);
      if (route.includes('vampire-survivors')) {
        await page.locator('#startBtn').click();
        assert.equal(await page.evaluate(() => window.VS.Game.current.state), 'playing');
      }
    }
    await page.goto(origin + '/not-a-real-page/');
    assert.match(await page.title(), /404/);
    await page.goto(origin + '/login/?next=%2Faccount%2F');
    await page.waitForURL('https://bobbycn.cc/login/**');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/account/');
    for (const route of ['/', '/posts/', '/games/']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(origin + route);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    }
    results.push({ host, passed: true, errors, missing });
    assert.deepEqual(errors, []);
    assert.deepEqual(missing, []);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
