import { readFile, writeFile } from 'node:fs/promises';
import { injectSiteAuth } from './site-shell.mjs';
const write = process.argv.includes('--write');
let stale = false;
for (const name of ['zombie-survival', 'racing3d', 'vampire-survivors']) {
  const file = new URL('../games/' + name + '/index.html', import.meta.url);
  const current = await readFile(file, 'utf8');
  const expected = injectSiteAuth(current);
  if (current !== expected) {
    stale = true;
    if (write) await writeFile(file, expected, 'utf8');
    console.log((write ? 'updated ' : 'outdated ') + name);
  } else console.log('ok ' + name);
}
if (stale && !write) process.exitCode = 1;
