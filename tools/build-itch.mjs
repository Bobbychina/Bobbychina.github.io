// Build public HTML5 packages using an explicit allowlist. Never copy deploy keys/profiles.
import { mkdir, readFile, writeFile, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'bobbycn-itch-release'));
if (output.startsWith('E:')) throw new Error('Release artifacts belong on C:, not the games disk');
const zombie = path.resolve(root, '../Games/zombieSurvival');
const racing = path.resolve(root, "../Games/Femboy's game/racing3d");
const games = [
  { slug: 'zombie-survival', title: '丧尸末日生存 · 余烬 / Zombie Survival: Embers', source: path.join(zombie, 'docs/index.html'), genre: 'Role Playing', tags: ['survival','zombies','turn-based','singleplayer'], controls: '鼠标操作，回合制；建议桌面浏览器。', pitch: '在丧尸末日中搜刮、战斗、经营营地，争取活到撤离。大世界探索与回合制生存 RPG。', credits: 'Bobbychina；开发过程使用 AI 协助。' },
  { slug: 'racing3d', title: '极速椭圆 / Oval Rush', source: path.join(racing, 'index.html'), genre: 'Racing', tags: ['racing','3d','singleplayer','cars'], controls: 'WASD/方向键驾驶；Space 漂移；Esc 暂停；R 重开。', pitch: '十条赛道、九款车型和 AI 对手的 3D 竞速小游戏。选择赛道与难度，刷新你的个人最佳单圈。', credits: 'Bobbychina；Three.js authors；开发过程使用 AI 协助。' },
  { slug: 'nightfall-survivors', title: '夜幕幸存者 / Nightfall Survivors', source: path.join(root, 'games/vampire-survivors/index.html'), genre: 'Action', tags: ['survivors-like','action','roguelite','singleplayer'], controls: 'WASD/方向键移动；Shift 闪避；1/2/3 选卡；Esc 暂停。', pitch: '自动攻击、升级选卡、宠物与 Boss 机制的俯视角生存动作游戏。玩法与数值由 Alan.Liu 共创。', credits: 'Bobbychina 与 Alan.Liu（Liujiarui0301）共同创作；开发过程使用 AI 协助。' },
];
const projectLicense = await readFile(path.join(root, 'LICENSE'), 'utf8');
await mkdir(output, { recursive: true });
for (const game of games) {
  const dir = path.join(output, game.slug);
  await mkdir(dir, { recursive: true });
  let html = await readFile(game.source, 'utf8');
  // Standalone builds are local-save editions. The website's OAuth/Cookie endpoints
  // cannot work inside itch's CDN iframe and must not be silently requested there.
  html = html.replace(/<script\b[^>]*src=["']\/[^"']+["'][^>]*>\s*<\/script>/gi, '');
  if (game.slug === 'nightfall-survivors') {
    for (const folder of ['js', 'css']) await cp(path.join(root, 'games/vampire-survivors', folder), path.join(dir, folder), { recursive: true });
    html = html.replace(/<div id="site-bar"[\s\S]*?<\/div>/, '');
    html = html.replace('<title>吸血鬼幸存者 · Vampire Survivors</title>', '<title>夜幕幸存者 / Nightfall Survivors</title>').replace('<h1>吸血鬼幸存者</h1>', '<h1>夜幕幸存者</h1>');
  }
  await writeFile(path.join(dir, 'index.html'), html, 'utf8');
  await writeFile(path.join(dir, 'LICENSE.txt'), projectLicense, 'utf8');
  await writeFile(path.join(dir, 'README.txt'), `${game.title}\n\n${game.pitch}\n\n操作：${game.controls}\n本版本无需账号，使用本机存档；清除浏览器数据会清除进度，浏览器版和下载版存档不自动互通。\n源码公开，适用 PolyForm Noncommercial 1.0.0（并非无限制商用许可）。\n${game.credits}\n`, 'utf8');
  await writeFile(path.join(output, game.slug + '-page.md'), `# ${game.title}\n\n${game.pitch}\n\n**免费试玩；喜欢的话可自愿支持开发。付费不会解锁额外内容，也不影响免费游玩。**\n\n${game.controls}\n\n这是中文 BETA 版本，主要面向桌面键鼠。本发行包使用本机存档，不要求注册站点账号；云存档与官方榜单请使用站点版本。\n\n${game.credits}\n\n## itch.io 设置\n\n- Project slug: ${game.slug}\n- Kind: HTML Game\n- Pricing: $0 minimum / pay what you want\n- Suggested donation: $2 USD（只是建议，玩家可以免费游玩）\n- Genre: ${game.genre}\n- Tags: ${game.tags.join(', ')}\n- Language: Chinese (Simplified)\n- Embed: click to launch fullscreen, fullscreen button enabled\n- Mobile friendly: 不勾选，尚未验证完整触屏流程\n- Release status: In development / BETA\n- Credits: ${game.credits}\n\n## English short description\n\nA browser-playable indie game with local saves. Chinese-language beta, designed for desktop keyboard and mouse. Free to play; optional donations support development. No account is required.\n`, 'utf8');
  console.log('built ' + game.slug);
}
const simplexLicense = await readFile(path.join(zombie, 'node_modules/simplex-noise/LICENSE'), 'utf8');
// seedrandom includes its copyright/license notice in the distributed source.
const seedrandom = await readFile(path.join(zombie, 'node_modules/seedrandom/seedrandom.js'), 'utf8');
const seedNotice = seedrandom.slice(0, seedrandom.indexOf('(function'));
await writeFile(path.join(output, 'zombie-survival/THIRD_PARTY_NOTICES.txt'), 'simplex-noise\n' + simplexLicense + '\nseedrandom\n' + seedNotice, 'utf8');
await writeFile(path.join(output, 'racing3d/THIRD_PARTY_NOTICES.txt'), 'Three.js r149\n' + await readFile(path.join(racing, 'vendor/LICENSE-three.txt'), 'utf8'), 'utf8');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(games.map(({ source, ...metadata }) => metadata), null, 2), 'utf8');
async function inspect(dir) {
  let count = 0, bytes = 0;
  async function walk(p) {
    for (const entry of await readdir(p, { withFileTypes: true })) {
      const file = path.join(p, entry.name);
      if (entry.isDirectory()) await walk(file);
      else { count++; bytes += (await readFile(file)).length; }
    }
  }
  await walk(dir);
  if (count > 1000 || bytes > 500 * 1024 * 1024) throw new Error('itch limits exceeded');
  return { count, bytes };
}
for (const game of games) console.log(game.slug + ': ' + JSON.stringify(await inspect(path.join(output, game.slug))));
