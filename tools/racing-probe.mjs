/* 赛车页自检（/games/racing3d/）：注入脚本 → 6 赛道 9 车型 → 排行榜面板 → 线上读榜 → 截图
   用法（两种模式）：
     ① 站点回归（与 vs-probe 同一套签名，reg-site.ps1 会这么调）：
        node tools/racing-probe.mjs <cdpPort> <url> <outDir>      # 复用 reg-site 那个已开好的标签
     ② 独立跑（自己拉起无头 Thorium）：
        node tools/racing-probe.mjs <url> [--api=<后端地址>]
     默认 url = https://bobbychina.github.io/games/racing3d/
   输出：截图 + .probe/racing-probe.json（退出码 0 = 全绿）

   为什么要单独一个探针：这个页面是**同步来的构建产物**（racing3d/tools/sync-site.mjs），
   三个 <script> 注入一丢，排行榜就整块失效（而且页面本身不会报错，只是面板提示"本地模式"），
   所以必须把"注入还在 + 账号库在 + 能真读到榜"当成硬断言。 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const THORIUM = 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe';

const argv = process.argv.slice(2);
const cdpMode = /^\d+$/.test(argv[0] || '');
const cdpPort = cdpMode ? argv[0] : '';
let url = (cdpMode ? argv[1] : argv.find(a => a && !a.startsWith('--'))) || 'https://bobbychina.github.io/games/racing3d/';
const outDir = (cdpMode ? argv[2] : '') || 'E:/Files/bobbychina-pages/.probe/racing';
const apiArg = (argv.find(a => a.startsWith('--api=')) || '').slice(6);
mkdirSync(outDir, { recursive: true });

const out = { url, mode: cdpMode ? ('cdp:' + cdpPort) : 'standalone', api: apiArg || '(页面自带)', checks: [], errors: [] };
const ok = (name, cond, extra) => {
  out.checks.push({ name, ok: !!cond, extra: extra === undefined ? '' : String(extra).slice(0, 200) });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (extra !== undefined && !cond ? '  -> ' + String(extra).slice(0, 160) : ''));
};

/* 独立模式自己开浏览器；CDP 模式接上 reg-site 已经开好的那个（_fresh_target.mjs 刷过的标签） */
const browser = cdpMode
  ? await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort, { timeout: 20000 })
  : await chromium.launch({ headless: true, executablePath: THORIUM });
const ctx = cdpMode ? (browser.contexts()[0] || await browser.newContext()) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
/* CDP 模式下**自己开一个新标签**，不要复用 pages()[0]：
   reg-site 里前后还有别的探针，共用标签会把别人的页面导航掉（也容易读到别的游戏的残留状态） */
const page = await ctx.newPage();
if (cdpMode) await page.bringToFront();
page.on('pageerror', e => out.errors.push('pageerror:' + String(e.message).slice(0, 160)));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const u = (m.location && m.location().url) || '';
  /* 游戏页没有 favicon（站里其它页是内联的），这个 404 与功能无关；
     但**别的** 404 必须算失败——少一个 /games/account.js 就是排行榜整块失效 */
  if (/favicon\.ico$/.test(u)) { out.favicon404 = true; return; }
  out.errors.push('console:' + m.text().slice(0, 120) + (u ? ' @' + u : ''));
});
page.on('response', r => {
  if (r.status() === 404 && /\.(js|css)$/.test(new URL(r.url()).pathname)) out.errors.push('404:' + r.url());
});

console.log('\n=== 赛车页自检 ' + url + ' (' + out.mode + ') ===');
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2500);

/* 1. 注入与账号库 */
const env = await page.evaluate(() => ({
  title: document.title,
  cfg: !!window.DSH_AUTH_CONFIG,
  acct: !!window.DSHAccount,
  mac: !!document.querySelector('script[src="/mac-block.js"]'),
  game: !!window.RACEGAME,
  tracks: window.RACEGAME ? Object.keys(window.RACEGAME.TRACK_DEFS) : [],
  cars: window.RACEGAME ? window.RACEGAME.CAR_MODELS.map(c => c.id) : [],
  api: (window.DSH_AUTH_CONFIG || {}).api || '',
  relay: ((window.DSH_AUTH_CONFIG || {}).github || {}).relay || '',
  onlineAvailable: window.RACEGAME ? window.RACEGAME.onlineAvailable() : false,
  startBtnVisible: (() => {
    const b = document.getElementById('btnStart');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight + 1;
  })(),
  /* AI 难度三档开关（2026-09-23 新增）: 按钮都在、点"硬核"能真的改掉 AI 参数与高亮 */
  diffBtns: Array.prototype.map.call(document.querySelectorAll('.dbtn'), b => b.getAttribute('data-diff')),
  diffNow: window.RACEGAME ? window.RACEGAME.CFG.AI_DIFFICULTY : '',
  diffHard: (() => {
    const G = window.RACEGAME;
    if (!G || !G.selectDiff) return null;
    G.selectDiff('hard');
    const tune = G.CFG.AI_TUNE[G.CFG.AI_DIFFICULTY] || {};
    const on = document.querySelector('.dbtn.on');
    const obs = {
      set: G.CFG.AI_DIFFICULTY,
      onBtn: on ? on.getAttribute('data-diff') : '',
      skill: tune.skill,
      name: (document.getElementById('diffName') || {}).textContent || ''
    };
    G.selectDiff('normal');   // 复原, 免得影响后面的检查
    return obs;
  })(),
}));
out.env = env;
ok('页面标题正常（不是错误页）', /赛车|极速|Racing/i.test(env.title), env.title);
ok('注入了 /games/auth-config.js', env.cfg);
ok('注入了 /games/account.js 且账号库已加载', env.acct);
ok('注入了 /mac-block.js（站点 macOS 拦截）', env.mac);
ok('游戏引擎已启动（window.RACEGAME）', env.game);
ok('6 条赛道都在', env.tracks.length === 6, env.tracks.join('/'));
ok('9 款车型都在', env.cars.length === 9, env.cars.join('/'));
ok('云后端地址已配（api + pages.dev 中继）', !!env.api && !!env.relay, env.api + ' / ' + env.relay);
ok('排行榜判定为可用', env.onlineAvailable);
ok('开场卡片上「开始比赛」在首屏内（1440×900）', env.startBtnVisible);
ok('开场卡片有 AI 难度三档开关（休闲/标准/硬核）',
  env.diffBtns.join(',') === 'easy,normal,hard', env.diffBtns.join('/'));
ok('默认档位是「标准」', env.diffNow === 'normal', env.diffNow);
ok('点「硬核」真的换档（CFG 变 hard + 按钮高亮跟随 + skill=1.06 + 文案更新）',
  !!env.diffHard && env.diffHard.set === 'hard' && env.diffHard.onBtn === 'hard' &&
  env.diffHard.skill === 1.06 && /硬核/.test(env.diffHard.name),
  JSON.stringify(env.diffHard));

await page.screenshot({ path: outDir + '/intro.png' });

/* 页面不是游戏（典型：GitHub Pages 还没发布完，返回 404 错误页）时，
   后面的 evaluate 会直接抛异常把探针整个打断 —— 那样只会看到一堆堆栈，
   真正原因（页面没上线）反而被埋掉。所以这里显式早退，并把原因写清楚。 */
if (!env.game) {
  ok('页面已经发布（不是 404/错误页）', false, '页面标题：' + env.title + '；跳过后面的游戏内检查');
  out.aborted = 'window.RACEGAME 不存在 —— 页面没上线或不是游戏页';
  if (!cdpMode) await browser.close();
  writeFileSync(outDir + '/../racing-probe.json', JSON.stringify(out, null, 1), 'utf8');
  const p = out.checks.filter(c => c.ok).length, f = out.checks.length - p;
  console.log('\n有失败：' + p + ' 通过 / ' + f + ' 失败（' + out.aborted + '）  探针：racing-probe');
  process.exit(1);
}

/* 2. 排行榜面板：能打开、能真读到榜（GET 是公开只读，不需要登录） */
if (apiArg) {
  await page.evaluate(a => { window.DSH_AUTH_CONFIG.api = a; window.DSH_AUTH_CONFIG.github.relay = ''; window.RACEGAME.Online.base = ''; }, apiArg);
}
const board = await page.evaluate(async () => {
  const R = window.RACEGAME;
  R.onlineTogglePanel(true);
  const r = await R.onlineFetchBoard();
  const rows = document.querySelectorAll('#lbList tr').length;
  const info = (document.getElementById('lbInfo') || {}).textContent || '';
  /* 没登录时面板必须把「注册云账号」摆在第一位（口径：云账号是主路径，GitHub 只是附带项） */
  const form = (document.getElementById('lbForm') || {}).textContent || '';
  return {
    ok: !!(r && r.ok), state: R.Online.state, count: R.Online.board.length, rows,
    info: info.slice(0, 120), record: R.Online.recordLap, err: (r && r.err) || '',
    hasRegBtn: !!document.getElementById('btnLbReg'), formText: form.slice(0, 120),
  };
});
/* 2b. 赛后/暂停回主菜单（2026-09-23 修: 以前跑完一局只能刷新页面换图）—— 走真实点击路径 */
const pausedInfo = await page.evaluate(() => {
  const R = window.RACEGAME;
  R.onlineTogglePanel(false);                     // 先关掉榜表面板, 免得挡住暂停卡片
  R.startNow();                                   // 直接开跑, 不用真等一圈
  const racing = R.G.state;
  /* 按 Esc 暂停 => 出现暂停卡片（这张卡片上就有「返回主菜单」） */
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  const pc = document.getElementById('cardPause');
  const ov = document.getElementById('overlay');
  return {
    racing, paused: !!pc && pc.style.display !== 'none' && R.G.state === 'paused',
    disp: pc ? pc.style.display : '(无卡片)',
    overlay: ov ? ov.className : '',
  };
});
/* 存档一张"暂停卡片"的截图当视觉证据（新按钮就在上面） */
if (pausedInfo.paused) {
  await page.waitForTimeout(400);                 // 留一帧给渲染
  const stillPaused = await page.evaluate(() => (document.getElementById('cardPause') || {}).style.display);
  pausedInfo.stillPaused = stillPaused;
  await page.screenshot({ path: outDir + '/pause.png' });
}
const menu = await page.evaluate(() => {
  const R = window.RACEGAME;
  const btn = document.getElementById('btnMenu');
  const btn2 = document.getElementById('btnMenu2');
  if (btn2) btn2.click();                         // 点「返回主菜单」=> 应回到开场卡片
  const startCard = document.getElementById('cardStart');
  return {
    hooked: typeof R.backToMenu === 'function',
    hasResultBtn: !!btn && /返回主菜单/.test(btn.textContent),
    hasPauseBtn: !!btn2,
    after: R.G.state,
    startVisible: !!startCard && startCard.style.display !== 'none',
    cars: R.G.cars.length,
  };
});
menu.racing = pausedInfo.racing;
menu.paused = pausedInfo.paused;
out.menu = menu;
ok('结算卡片上有「返回主菜单」按钮（换图不用刷新页面）',
  menu.hooked && menu.hasResultBtn, JSON.stringify(menu).slice(0, 160));
ok('暂停 → 点「返回主菜单」→ 真的回到开场卡片（state=intro, 车阵重建）',
  menu.racing === 'racing' && menu.paused && menu.after === 'intro' && menu.startVisible && menu.cars === 6,
  JSON.stringify(menu).slice(0, 160) + ' | 暂停卡片 display=' + pausedInfo.disp +
  ', overlay=' + pausedInfo.overlay + ', 截图前 still=' + pausedInfo.stillPaused);

out.board = board;
ok('面板打开后读到榜单（GET /api/score 公开只读）', board.ok && board.state === 'ok', JSON.stringify(board).slice(0, 180));ok('榜单渲染成表格行', board.rows >= 1, 'rows=' + board.rows);
ok('未登录时面板给的是「注册云账号」入口（云账号=主路径）',
  board.hasRegBtn || /可以上榜/.test(board.formText),
  'hasRegBtn=' + board.hasRegBtn + ' form=' + board.formText.replace(/\s+/g, ' ').slice(0, 70));
await page.screenshot({ path: outDir + '/board.png' });

/* 3. 切一条起伏赛道（雪山盘山）看画面有没有崩 */
const after = await page.evaluate(async () => {
  const R = window.RACEGAME;
  R.selectTrack('alpine');
  await new Promise(r => setTimeout(r, 1200));
  const b = await R.onlineFetchBoard();
  return { mode: R.CFG.TRACK_MODE, track: R.trackDef().name, boardOk: !!(b && b.ok), lap: R.Online.recordLap, terrain: R.GROUND.ready, err: (b && b.err) || '' };
});
out.switchTrack = after;
ok('能切到雪山盘山道且赛道数据正常', after.mode === 'alpine' && after.terrain === true, JSON.stringify(after).slice(0, 160));
ok('切换赛道后按新赛道重新读榜', after.boardOk, after.err || 'ok');
await page.screenshot({ path: outDir + '/alpine.png' });

ok('全程 0 个未捕获异常 / 控制台报错', out.errors.length === 0, out.errors.join(' | '));

/* 4. 故障降级：后端不认识 racing3d（worker 还没部署时就是这状态）→ 页面不许崩、游戏照玩
      做法：把 /api/score 拦下来回一个 400 bad_game，再看面板文案与游戏状态。
      这一段在"0 报错"断言之后，故意制造的 400 不会污染前面的结论。 */
const errsBefore = out.errors.length;
await page.route('**/api/score*', route => route.fulfill({
  status: 400, contentType: 'application/json',
  body: JSON.stringify({ error: 'bad_game', message: '没有这个榜：vampire-survivors' }),
}));
const degrade = await page.evaluate(async () => {
  const R = window.RACEGAME;
  R.Online.base = '';
  R.onlineTogglePanel(true);
  const b = await R.onlineFetchBoard();
  let threw = '';
  try { await R.onlineAfterRace(); } catch (e) { threw = String(e && e.message || e); }
  return {
    ok: !!(b && b.ok), state: R.Online.state,
    info: ((document.getElementById('lbInfo') || {}).textContent || '').slice(0, 140),
    gameState: R.G.state, hasCanvas: !!document.querySelector('canvas'),
    cars: R.G.cars.length, threw,
  };
});
out.degrade = degrade;
ok('后端 400 时面板给人话提示（不是异常堆栈/机器码）',
  degrade.state === 'err' && /官方榜还没开|读排行榜失败/.test(degrade.info) &&
  !/undefined|NaN|TypeError|vampire-survivors/.test(degrade.info),
  degrade.info);
ok('后端 400 时游戏照常可玩（车还在、画布还在、结算钩子不抛异常）',
  degrade.gameState === 'intro' && degrade.hasCanvas && degrade.cars >= 6 && degrade.threw === '',
  JSON.stringify({ state: degrade.gameState, cars: degrade.cars, threw: degrade.threw }));
await page.screenshot({ path: outDir + '/degrade.png' });
await page.unroute('**/api/score*');
out.errorsAfterDegrade = out.errors.slice(errsBefore);   // 故障注入期间的报错单独记，不算失败

/* CDP 模式复用 reg-site 的浏览器：关掉自己开的标签就行，别把浏览器关了 */
if (cdpMode) await page.close(); else await browser.close();
writeFileSync(outDir + '/../racing-probe.json', JSON.stringify(out, null, 1), 'utf8');
const pass = out.checks.filter(c => c.ok).length, fail = out.checks.length - pass;
console.log('\n' + (fail === 0 ? '全绿' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败  探针：racing-probe');
console.log('截图与 JSON：' + outDir + ' 、 .probe/racing-probe.json');
process.exit(fail === 0 ? 0 : 1);
