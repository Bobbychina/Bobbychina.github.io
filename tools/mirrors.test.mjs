import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildMirror } from './build-mirrors.mjs';

const source = await readFile(new URL('../functions/[[path]].js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('release contains production articles and a real 404 on both hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mirror-test-'));
  const input = join(root, 'source');
  await mkdir(join(input, 'posts', 'online-only'), { recursive: true });
  const files = {};
  for (const name of ['index.html', 'posts/index.html', 'posts/online-only/index.html']) {
    const data = '<!doctype html><html><head><title>' + name + '</title></head><body>production</body></html>';
    await writeFile(join(input, name), data);
    files[name] = { bytes: Buffer.byteLength(data), sha256: createHash('sha256').update(data).digest('hex') };
  }
  await writeFile(join(input, 'mirror-source.json'), JSON.stringify({ source: 'https://bobbycn.cc', files }));
  // Private/development files must not be copied just because they exist beside the export.
  await writeFile(join(input, 'prod.env'), 'fixture private file');
  const output = join(root, 'release');
  const result = await buildMirror(input, output);
  assert.deepEqual(result.articles, ['posts/online-only/index.html']);
  assert.match(await readFile(join(output, 'posts/online-only/index.html'), 'utf8'), /mirror-runtime.js/);
  assert.match(await readFile(join(output, '404.html'), 'utf8'), /Page not found/);
  assert.match(await readFile(join(output, 'login/index.html'), 'utf8'), /https:\/\/bobbycn.cc\/login\//);
  assert.match(await readFile(join(output, '_redirects'), 'utf8'), /\/stock https:\/\/game.bobbycn.cc\//);
  await assert.rejects(stat(join(output, 'prod.env')), { code: 'ENOENT' });
  await assert.rejects(buildMirror(input, output), { code: 'EEXIST' });
  files['index.html'].sha256 = 'wrong';
  await writeFile(join(input, 'mirror-source.json'), JSON.stringify({ files }));
  await assert.rejects(buildMirror(input, join(root, 'changed')), /Export changed/);
});

test('blog requests go to the production blog; legacy saves keep their Worker', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response('{"views":{"online-only":12}}', { status: 200 });
  };
  for (const host of ['bobbychina.github.io', 'bobbychina-games.pages.dev']) {
    const response = await onRequest({ request: new Request('https://bobbychina-games.pages.dev/api/blog/views?slugs=online-only', { headers: { origin: 'https://' + host } }), env: {} });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1).url, 'https://bobbycn.cc/api/blog/views?slugs=online-only');
    assert.equal(calls.at(-1).options.headers.cookie, undefined);
    assert.equal((await response.json()).views['online-only'], 12);
  }
  await onRequest({ request: new Request('https://bobbychina-games.pages.dev/api/save'), env: {} });
  assert.match(calls.at(-1).url, /^https:\/\/dsh-oauth-relay\./);
  const before = calls.length;
  const denied = await onRequest({ request: new Request('https://bobbychina-games.pages.dev/api/blog/views', { headers: { origin: 'https://example.invalid' } }), env: {} });
  assert.equal(denied.status, 403);
  assert.equal(calls.length, before);
});

test('static subpages reach the static server, never an API or homepage replacement', async () => {
  for (const route of ['/posts/', '/posts/online-only/', '/games/', '/not-a-page/']) {
    let passed = 0;
    const response = await onRequest({ request: new Request('https://bobbychina-games.pages.dev' + route), env: {}, next: () => { passed++; return new Response('static result', { status: route === '/not-a-page/' ? 404 : 200 }); } });
    assert.equal(passed, 1);
    assert.equal(response.status, route === '/not-a-page/' ? 404 : 200);
    assert.equal(await response.text(), 'static result');
  }
});
