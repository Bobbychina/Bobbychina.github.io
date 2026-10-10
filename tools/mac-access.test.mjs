import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const client = await readFile(new URL('../mac-block.js', import.meta.url), 'utf8');
const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(middleware).toString('base64'));
const platforms = [
  ['Safari macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15', ''],
  ['Chrome macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/138.0.0.0', 'macOS'],
  ['Firefox macOS', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:130.0) Firefox/130.0', ''],
  ['iPad', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148 Safari/604.1', 'iPadOS'],
  ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'],
];
let count = 0;
for (const [name, userAgent, platform] of platforms) {
  for (const path of ['/', '/games/', '/games/zombie-survival/', '/games/vampire-survivors/', '/games/racing3d/', '/login/', '/account/', '/api/score', '/beta-notice.js']) {
    const document = new Proxy({}, { get() { throw new Error('Platform script must not alter the document'); } });
    const window = {};
    vm.runInNewContext(client, { navigator: { userAgent, userAgentData: { platform }, maxTouchPoints: name === 'iPad' ? 5 : 0 }, location: { pathname: path }, document, window });
    assert.equal(window.__MAC_BLOCKED__, undefined);
    const request = new Request('https://example.test' + path, { headers: { 'user-agent': userAgent, 'sec-ch-ua-platform': JSON.stringify(platform) } });
    for (const status of [200, 401, 403]) {
      const response = new Response('downstream response', { status });
      let calls = 0;
      assert.equal(await onRequest({ request, next: async () => { calls++; return response; } }), response);
      assert.equal(calls, 1);
    }
    count++;
  }
}
console.log(`PASS ${count} platform/path combinations; downstream authentication responses preserved`);
