/* 把 OAuth 中继部署到 Cloudflare Pages（*.pages.dev）
   ----------------------------------------------------------------------------
   为什么单独部署：本站是 **GitHub Pages**（纯静态），functions/ 目录只能被 Cloudflare Pages 执行；
   而 `*.workers.dev` 在部分网络（校园网/运营商）被整段 DNS 黑洞，`*.pages.dev` 实测可用。

   用法：node tools/deploy-relay.mjs [项目名]
        需要先 `npx wrangler login`（或用 CLOUDFLARE_API_TOKEN 环境变量）。
   部署内容：只用 functions/[[path]].js + 一个说明页（不把整个站点传上去）。
   部署完把输出的 https://<项目名>.pages.dev 填进 games/auth-config.js 的 github.relay。
*/
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.argv[2] || 'bobbychina-games';
const stage = join(tmpdir(), 'dsh-relay-pages');

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(root, 'functions'), join(stage, 'functions'), { recursive: true });
await writeFile(join(stage, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>dsh oauth relay</title>' +
  '<body style="font:14px/1.7 system-ui;background:#0b0d10;color:#cfd2d6;padding:32px">' +
  '<h1 style="font-size:18px">dsh oauth relay（Cloudflare Pages Function）</h1>' +
  '<p>这个域名只干一件事：把 GitHub 的 <code>/login/device/code</code> 与 <code>/oauth/access_token</code> ' +
  '原样转发并补上 CORS 头，供 <a style="color:#7fd6a5" href="https://bobbychina.github.io/games/">bobbychina.github.io/games</a> 的登录使用。</p>' +
  '<p>只放行上面两个路径、只转发、不记录不落盘；不需要 client secret。源码见主页仓库 <code>functions/[[path]].js</code>。</p>' +
  '</body>', 'utf8');

console.log('[deploy-relay] staged at ' + stage + '（functions/ + index.html）');
const r = spawnSync('npx', ['--yes', 'wrangler@3', 'pages', 'deploy', stage, '--project-name', project, '--branch', 'main', '--commit-dirty=true'],
  { stdio: 'inherit', cwd: root, shell: true });
console.log('[deploy-relay] wrangler exit=' + r.status);
process.exit(r.status ?? 1);
