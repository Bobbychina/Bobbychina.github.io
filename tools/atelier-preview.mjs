import http from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blog = resolve(root, '../bobbychina-blog/dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: '本地美术预览：未连接账号服务' }));
      return;
    }
    const base = url.pathname.startsWith('/posts/') || ['/feed.xml', '/sitemap.xml'].includes(url.pathname) ? blog : root;
    let target = resolve(base, '.' + decodeURIComponent(url.pathname));
    if (target !== base && !target.startsWith(base + sep)) { res.writeHead(403); res.end(); return; }
    if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
    if (!existsSync(target) || !statSync(target).isFile()) { res.writeHead(404); res.end('Page not found'); return; }
    // Only public site assets are served; source, credentials and dotfiles stay private.
    const relative = target.slice(base.length).replaceAll('\\', '/');
    if (relative.split('/').some(part => part.startsWith('.')) || !types[extname(target)] || relative.startsWith('/tools/') || relative.startsWith('/docs/')) { res.writeHead(403); res.end(); return; }
    let content = readFileSync(target);
    if (base === blog && extname(target) === '.html' && !content.toString('utf8').includes('/assets/atelier.css')) {
      content = Buffer.from(content.toString('utf8').replace('</head>', '<link rel="stylesheet" href="/assets/atelier.css?v=20261010a">\n</head>'));
    }
    res.writeHead(200, { 'Content-Type': types[extname(target)], 'Cache-Control': 'no-store' });
    res.end(content);
  } catch { res.writeHead(400); res.end('Invalid request'); }
});
server.listen(Number(process.env.ATELIER_PORT || 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  if (process.env.ATELIER_READY_FILE) writeFileSync(process.env.ATELIER_READY_FILE, JSON.stringify({ url, pid: process.pid }), 'utf8');
  console.log(url);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
