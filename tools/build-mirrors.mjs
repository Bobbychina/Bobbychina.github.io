// Build both providers from the same audited export of production's public files.
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function buildMirror(source, destination) {
  const manifest = JSON.parse(await readFile(join(source, 'mirror-source.json'), 'utf8'));
  // A new directory prevents stale files and avoids deleting any caller-owned path.
  await mkdir(destination);
  const runtime = await readFile(new URL('./mirror-runtime.js', import.meta.url), 'utf8');
  let bytes = 0;
  for (const [name, entry] of Object.entries(manifest.files)) {
    if (!/^(?:[\w-]+\/)*[\w.-]+$/.test(name) || name.split('/').some(p => p.startsWith('.')))
      throw new Error('Unsafe export path: ' + name);
    const data = await readFile(join(source, name));
    if (createHash('sha256').update(data).digest('hex') !== entry.sha256)
      throw new Error('Export changed: ' + name);
    let content = data;
    if (name.endsWith('.html')) {
      const html = data.toString('utf8');
      if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error('Missing document head: ' + name);
      content = Buffer.from(html.replace(/<head(\s[^>]*)?>/i, match => match + '\n<script src="/mirror-runtime.js?v=20261015a"></script>'));
    }
    if (name === 'games/auth-config.js') {
      content = Buffer.from(data.toString('utf8') + '\n// Static mirrors keep account sessions on the main site.\n' +
        'window.DSH_AUTH_CONFIG.site.sites[location.hostname] = location.origin;\n' +
        'window.DSH_AUTH_CONFIG.github.relay = "https://bobbychina-games.pages.dev";\n');
    }
    await mkdir(dirname(join(destination, name)), { recursive: true });
    await writeFile(join(destination, name), content);
    bytes += content.length;
  }
  await writeFile(join(destination, 'mirror-runtime.js'), runtime);
  await writeFile(join(destination, '.nojekyll'), '');
  // A real 404 prevents Cloudflare's SPA fallback from returning the homepage at missing paths.
  await writeFile(join(destination, '404.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>404 · Bobbychina</title><h1>404</h1><p>页面不存在 / Page not found</p><a href="/">首页 / Home</a></html>');
  const dynamic = ['login', 'register', 'account', 'reset-password', 'verify-email', 'admin', 'stock'];
  const redirects = [];
  for (const path of dynamic) {
    const target = path === 'stock' ? 'https://game.bobbycn.cc/' : 'https://bobbycn.cc/' + path + '/';
    await mkdir(join(destination, path), { recursive: true });
    await writeFile(join(destination, path, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Bobbychina</title><script>location.replace(' + JSON.stringify(target) + '+location.search+location.hash)</script></head><body><a href="' + target + '">前往主站 / Open the main site</a></body></html>');
    redirects.push(`/${path} ${target} 302`, `/${path}/* ${target}:splat 302`);
  }
  await writeFile(join(destination, '_redirects'), redirects.join('\n') + '\n');
  // A static copy cannot use /api on GitHub; only the public blog relay is used there.
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await cp(join(sourceRoot, 'functions'), join(destination, 'functions'), { recursive: true });
  // Restrict function invocation to APIs/OAuth; static paths never pass through a wildcard function.
  await writeFile(join(destination, '_routes.json'), JSON.stringify({ version: 1, include: ['/api', '/api/*', '/oauth/access_token', '/login/device/code'], exclude: [] }, null, 2));
  const report = { source: manifest.source, files: Object.keys(manifest.files).length, bytes, articles: Object.keys(manifest.files).filter(p => /^posts\/.+\/index\.html$/.test(p)) };
  await writeFile(join(destination, 'mirror-release.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node tools/build-mirrors.mjs <export-directory> <new-output-directory>');
  console.log(JSON.stringify(await buildMirror(resolve(process.argv[2]), resolve(process.argv[3])), null, 2));
}
