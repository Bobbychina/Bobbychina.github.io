/* 站点自检：渲染 → 截图 → 检查文本/链接/控制台 → 输出 JSON。
   用法：node tools/site-probe.mjs [url]   （默认本地 http://127.0.0.1:5180/） */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');

const url = process.argv[2] || 'http://127.0.0.1:5180/';
const outDir = 'E:/Files/bobbychina-pages/.probe';
mkdirSync(outDir, { recursive: true });
const out = { url, steps: {}, errors: [] };
const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Users\\lenovo\\AppData\\Local\\Thorium\\Application\\thorium.exe' });

for (const [tag, vp] of Object.entries({ desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } })) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  page.on('pageerror', e => out.errors.push(tag + ':' + String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error') out.errors.push(tag + ':console:' + m.text().slice(0, 120)); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(3200);
  const info = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      title: document.title,
      desc: (document.querySelector('meta[name=description]') || {}).content,
      h1: (document.querySelector('h1') || {}).innerText,
      cards: [...document.querySelectorAll('.card h3')].map(e => e.innerText.trim()),
      sections: [...document.querySelectorAll('section')].map(e => e.id || e.querySelector('h2').innerText.trim()),
      links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')),
      bannedWords: ['主人', '奶茶', 'AI 日记', '冷知识', '省下的 API', 'SimCompanies', 'STATUS: ONLINE']
        .filter(w => txt.includes(w)),
      termLines: document.querySelectorAll('#term .ln').length,
      diaryPresent: !!document.getElementById('diary') || /日记/.test(txt),
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 2,
    };
  });
  out.steps[tag] = info;
  await page.screenshot({ path: outDir + '/' + tag + '.png', fullPage: true });
  /* 移动端再截一张首屏（不滚动） */
  if (tag === 'mobile') await page.screenshot({ path: outDir + '/mobile-fold.png' });
  await page.close();
}
await browser.close();
writeFileSync(outDir + '/site-probe.json', JSON.stringify(out, null, 1), 'utf8');
console.log(JSON.stringify(out.steps.desktop, null, 1).slice(0, 1500));
console.log('mobile:', JSON.stringify(out.steps.mobile).slice(0, 400));
console.log('errors:', JSON.stringify(out.errors));
