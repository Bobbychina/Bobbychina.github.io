'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { serve } = require('./markdown.cjs');

test('negotiates public pages and reads current blog content', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-public-post-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const env = { PORTAL_ROOT: process.env.PORTAL_ROOT, BLOG_POSTS_ROOT: process.env.BLOG_POSTS_ROOT };
  t.after(() => {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.PORTAL_ROOT = path.resolve(__dirname, '../..');
  process.env.BLOG_POSTS_ROOT = fixture;
  const postPath = '/posts/New-Post/';
  const folder = path.join(fixture, 'New-Post');
  await fs.mkdir(folder);
  const source = '<!doctype html><title>测试</title><nav>导航</nav><main><h1>中文标题</h1><p>文章内容 <a href="../">阅读目录</a></p><p><code><i>示例</code></i></p><script>unwanted()</script></main>';
  await fs.writeFile(path.join(folder, 'index.html'), source);
  const server = http.createServer((req, res) => serve(req, res).catch((e) => res.writeHead(500).end(e.message)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/_agent/content';
  const get = (page, accept, method = 'GET') => fetch(url, { method, headers: { 'X-Agent-Page': page, Accept: accept } });

  const rendered = await get(postPath, 'text/markdown');
  assert.equal(rendered.status, 200);
  assert.equal(rendered.headers.get('vary'), 'Accept');
  assert.equal(rendered.headers.get('cache-control'), 'no-store');
  assert.match(rendered.headers.get('content-signal'), /ai-train=no/);
  const body = await rendered.text();
  assert.match(body, /# 中文标题/);
  assert.match(body, /\[阅读目录\]\(https:\/\/bobbycn\.cc\/posts\/\)/);
  assert.doesNotMatch(body, /导航|unwanted/);
  const head = await get(postPath + 'index.html', 'text/markdown', 'HEAD');
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(body)));
  assert.equal(await head.text(), '');
  for (const header of ['*/*', 'text/*', 'text/html, text/markdown;q=0.5', 'text/markdown;q=0, */*']) {
    const response = await get(postPath, header);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(await response.text(), source);
  }
  for (const header of ['TEXT/MARKDOWN', 'text/markdown, */*', 'text/html;q=0.1, text/markdown;q=0.9', 'text/markdown; charset=utf-8']) {
    const response = await get(postPath, header);
    assert.match(response.headers.get('content-type'), /^text\/markdown/);
  }
  assert.equal((await get(postPath, 'text/markdown;q=0, text/html;q=0')).status, 406);
  for (const page of ['/account/', '/games/secret/', '/posts/../', '/posts/New-Post/?a=1', '/posts/absent/', '/assets/site.css']) {
    assert.equal((await get(page, 'text/markdown')).status, 404, page);
  }
  for (const page of ['/', '/index.html', '/games/', '/sponsor/', '/resources/index.html']) {
    const response = await get(page, 'text/markdown, text/html;q=0.5');
    assert.match(response.headers.get('content-type'), /^text\/markdown/);
    const content = await response.text();
    assert.match(content, /^# /m, page);
    assert.match(content, /https:\/\/bobbycn\.cc\//, page);
  }
  await fs.writeFile(path.join(folder, 'index.html'), source.replace('中文标题', '修改后的标题'));
  assert.match(await (await get(postPath, 'text/markdown')).text(), /# 修改后的标题/);
  await fs.writeFile(path.join(folder, 'index.html'), 'NOT AN HTML DOCUMENT');
  assert.equal((await get(postPath, 'text/markdown')).status, 404);
});
