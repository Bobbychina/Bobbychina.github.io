// Publish a verified complete mirror, never an explanation-only homepage.
// Usage: WRANGLER_CLI=<installed cli.js> node tools/deploy-relay.mjs <project> <release>
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join, extname } from 'node:path';

const [project, directory] = process.argv.slice(2);
if (!project || !directory || !/^[a-z0-9-]+$/.test(project))
  throw new Error('Usage: node tools/deploy-relay.mjs <project> <verified-release-directory>');
const release = resolve(directory);
const report = JSON.parse(await readFile(join(release, 'mirror-release.json'), 'utf8'));
if (!Array.isArray(report.articles) || !report.articles.length)
  throw new Error('Refusing to publish a mirror without production articles');
for (const path of ['index.html', 'posts/index.html', '404.html', '_routes.json', ...report.articles])
  await stat(join(release, path));
const extensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.mp3', '.ogg', '.wav', '.wasm', '.glb', '.gltf', '.bin', '.xml', '.webmanifest']);
async function audit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (entry.name.startsWith('.') && entry.name !== '.nojekyll') ||
        /^(?:tools|docs|node_modules|partner-kit|prod\.env)$/i.test(entry.name))
      throw new Error('Unexpected deployment file: ' + entry.name);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await audit(path);
    else {
      if (!extensions.has(extname(path)) && !['.nojekyll', '_redirects'].includes(entry.name) && !/^(LICENSE|COPYING)/.test(entry.name))
        throw new Error('Unexpected deployment extension: ' + entry.name);
      if ((await stat(path)).size >= 25 * 1024 * 1024) throw new Error('Pages file exceeds 25 MiB: ' + entry.name);
    }
  }
}
await audit(release);
if (process.env.MIRROR_VALIDATE_ONLY === '1') {
  console.log('Mirror release passed deployment checks: ' + release);
} else {
  const args = ['pages', 'deploy', release, '--project-name', project, '--branch', 'main', '--commit-dirty=true'];
  const cli = process.env.WRANGLER_CLI;
  if (!cli) throw new Error('Set WRANGLER_CLI to an installed wrangler CLI; this tool never installs software');
  const result = spawnSync(process.execPath, [resolve(cli), ...args], { stdio: 'inherit', cwd: release, env: { ...process.env, CI: 'true' } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
