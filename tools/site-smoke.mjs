// Read-only local browser checks. No production API calls or existing browser sessions.
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const root = process.env.SITE_SMOKE_ROOT ? path.resolve(process.env.SITE_SMOKE_ROOT) + path.sep : fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] || path.join(os.tmpdir(), 'bobbycn-site-smoke');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.split('/').some(p => p.startsWith('.'))) { res.writeHead(403).end(); return; }
    const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' }).end(content);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXE || 'C:/Users/lenovo/AppData/Local/Thorium/Application/thorium.exe' });
  const routes = process.env.SITE_SMOKE_ROUTES ? JSON.parse(process.env.SITE_SMOKE_ROUTES) : process.env.SITE_SMOKE_ROOT ? ['/zombie-survival/', '/racing3d/', '/nightfall-survivors/'] : ['/', '/portal.index.html', '/games/', '/games/oauth-callback.html', '/login/', '/account/', '/games/zombie-survival/', '/games/vampire-survivors/', '/games/racing3d/'];
  for (const route of routes) {
    const context = await browser.newContext({ viewport: { width: Number(process.env.SITE_SMOKE_WIDTH || 1440), height: Number(process.env.SITE_SMOKE_HEIGHT || 900) } });
    const page = await context.newPage();
    const errors = [], missing = [];
    await page.route('**/*', async r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/health')) {
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clients: [], ok: false, authenticated: false }) });
      } else if (u.origin !== origin) await r.abort();
      else await r.continue();
    });
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() === 404 && /\.(js|css|png|jpg|svg|webp)(?:\?|$)/.test(r.url())) missing.push(r.url().replace(origin, '')); });
    await page.goto(origin + route, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1000);
    let interaction = null;
    if (/vampire-survivors|nightfall-survivors/.test(route)) {
      await page.screenshot({ path: path.join(output, 'nightfall-menu.png') });
      await page.locator('#startBtn').click({ timeout: 15000 });
      await page.waitForTimeout(500);
      interaction = await page.evaluate(() => ({ state: window.VS.Game.current.state, time: window.VS.Game.current.time }));
    }
    const info = await page.evaluate(() => ({ title: document.title, text: document.body.innerText.length, canvases: document.querySelectorAll('canvas').length, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 }));
    if (/zombie-survival/.test(route)) {
      info.baseLevel = await page.evaluate(() => window.baseLevel());
      if (!Number.isFinite(info.baseLevel)) errors.push('base level is not numeric');
    }
    if (/\/games\/(zombie-survival|racing3d|vampire-survivors)\//.test(route)) {
      const shell = await page.evaluate(() => ({ auth: !!window.SiteAuth, saves: !!window.SiteSaves, account: !!window.DSHAccount }));
      info.shell = shell;
      if (!shell.auth || !shell.saves || !shell.account) errors.push('shared account SDK was not loaded');
    }
    const tag = route.replace(/[^a-z0-9]+/gi, '-') || 'home';
    await page.screenshot({ path: path.join(output, tag + '.png') });
    results.push({ route, ...info, interaction, errors, missing });
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (results.some(r => r.errors.length || r.missing.length || !r.text)) process.exitCode = 1;
