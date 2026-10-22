import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'D:/npm-global/node_modules/@playwright/cli/node_modules/playwright');
const root=path.resolve(import.meta.dirname,'..'), output=path.resolve(process.argv[2]);
const blog=process.env.BLOG_PREVIEW_ROOT || path.join(output,'blog-preview');
await fs.mkdir(output,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');const part=decodeURIComponent(u.pathname);if(part.split('/').some(p=>p.startsWith('.')))return res.writeHead(403).end();const base=part.startsWith('/posts/')?blog:root;const file=path.resolve(base,'.'+part+(part.endsWith('/')?'index.html':''));if(!file.startsWith(base+path.sep))return res.writeHead(403).end();const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':(mime[path.extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-store'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const challenge="window.challengeLanguages=[];window.turnstile={render:function(el,o){window.challengeLanguages.push(o.language);return 0;},remove:function(){},reset:function(){},getResponse:function(){return 'test-response';}};";
let browser;const results=[];let apiCalls=[];
async function context(options={}){const ctx=await browser.newContext({viewport:{width:1440,height:900},...options});await ctx.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){if(url.hostname==='challenges.cloudflare.com')return route.fulfill({status:200,contentType:'text/javascript',body:challenge});return route.abort();}if(url.pathname.startsWith('/api/')){apiCalls.push({path:url.pathname,language:req.headers()['accept-language'],method:req.method()});const logged=!!options.fixtureLogged;let status=200,data={};if(/identity\/me$/.test(url.pathname)){status=logged?200:401;data=logged?{id:'fixture-user',email:'fixture@example.test',username:'fixture',role:'ADMIN'}:{message:'登录已失效，请重新登录'};}else if(/\/login$/.test(url.pathname)){status=401;data={message:'邮箱或密码错误'};}else if(/\/clients$/.test(url.pathname))data={clients:[]};else if(/grants$/.test(url.pathname))data={grants:[]};else if(/admin\/blog\/posts$/.test(url.pathname)){status=logged?200:401;data=logged?{posts:[]}:{message:'登录已失效，请重新登录'};}else if(/blog\/views/.test(url.pathname))data={views:{}};else if(/blog\/comments/.test(url.pathname))data={comments:[],total:0};else if(/\/quota/.test(url.pathname))data={used:0,limit:10,left:10};return route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});}return route.continue();});return ctx;}
async function leftovers(page){return page.evaluate(()=>{const out=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const p=n.parentElement;if(!p||p.closest('script,style,noscript,textarea,[data-i18n-ignore],.cmt-body,.cmt-head,#toc')||!p.getClientRects().length)continue;const text=n.textContent.trim();if(/[\u3400-\u9fff]/.test(text)&&text!=='汪henry'&&text!=='简体'&&text!=='繁體')out.push(text);}return [...new Set(out)];});}
try{browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXE||'C:/Users/lenovo/AppData/Local/Thorium/Application/thorium.exe'});
const routes=['/','/index.next.html','/portal.index.html','/games/','/login/','/register/','/reset-password/','/verify-email/','/account/','/admin/','/sponsor/','/secret/','/secret/room/','/games/oauth-callback.html','/posts/'];
for(const language of ['zh-CN','zh-TW','en'])for(const route of routes){const ctx=await context({locale:language});const page=await ctx.newPage(),errors=[],warnings=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='warning'&&m.text().includes('[i18n]'))warnings.push(m.text());});await page.goto(origin+route+'?lang='+language,{waitUntil:'load'});await page.waitForFunction(l=>window.I18N?.current()===l,language);const info=await page.evaluate(()=>({lang:document.documentElement.lang,title:document.title,switches:document.querySelectorAll('[data-i18n-switch] button').length,overflow:document.documentElement.scrollWidth>innerWidth+2}));const missing=language==='en'?await leftovers(page):[];results.push({route,language,...info,errors,warnings,missing});await page.screenshot({path:path.join(output,(route.replace(/[^a-z0-9]+/gi,'-')||'home')+'-'+language+'.png')});await ctx.close();}
const ctx=await context(),page=await ctx.newPage();await page.goto(origin+'/login/?lang=en');await page.locator('#btn').click();assert.match(await page.locator('#msg').innerText(),/Enter/);await page.locator('#id').fill('fixture@example.test');await page.locator('#pw').fill('test-password');await page.locator('#btn').click();await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('Incorrect'));await page.locator('[data-i18n-switch] button[aria-label="zh-TW"]').click();await page.waitForFunction(()=>I18N.current()==='zh-TW');assert.equal(await page.locator('#id').inputValue(),'fixture@example.test');assert.equal(await page.locator('#pw').inputValue(),'test-password');assert.match(await page.locator('#msg').innerText(),/密碼錯誤/);assert.equal(await page.evaluate(()=>challengeLanguages.at(-1)),'zh-tw');await page.reload();assert.equal(await page.evaluate(()=>I18N.current()),'zh-TW');await ctx.close();results.push({interaction:'login errors, live switch, preserved fields, challenge language, persisted language',passed:true});
const adminCtx=await context({fixtureLogged:true}),admin=await adminCtx.newPage();await admin.goto(origin+'/admin/?lang=en');await admin.waitForSelector('#fBody',{state:'visible'});await admin.locator('#fTitle').fill('Original article title 原文');await admin.locator('#fBody').fill('Original article body 原文');await admin.locator('[data-i18n-switch] button[aria-label="zh-TW"]').click();await admin.waitForFunction(()=>I18N.current()==='zh-TW');assert.equal(await admin.locator('#fTitle').inputValue(),'Original article title 原文');assert.equal(await admin.locator('#fBody').inputValue(),'Original article body 原文');await adminCtx.close();results.push({interaction:'admin language switch preserves unpublished article',passed:true});
for(const route of ['/','/games/','/register/','/admin/','/sponsor/']){const ctx=await context({viewport:{width:390,height:844},locale:'en'}),page=await ctx.newPage();await page.goto(origin+route+'?lang=en');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);results.push({route,language:'en',mobile:true,overflow});await page.screenshot({path:path.join(output,'mobile'+route.replace(/[^a-z0-9]+/gi,'-')+'.png')});await ctx.close();}
for(const game of ['zombie-survival','racing3d','vampire-survivors']) {
  const ctx=await context({locale:'en'}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/games/'+game+'/?lang=en',{waitUntil:'load'});
  await page.waitForFunction(()=>window.I18N?.current()==='en');
  if(game==='zombie-survival') {
    await page.waitForFunction(()=>window.V4Account?.legacyLogin);
    await page.evaluate(()=>V4Account.legacyLogin());
    await page.locator('#acc-name').fill('fixture-name');await page.locator('#acc-pass').fill('fixture-password');
    assert.equal(await page.locator('#acc-pass').getAttribute('placeholder'),'Password');
    await page.locator('#site-language button[aria-label="zh-TW"]').click();await page.waitForFunction(()=>I18N.current()==='zh-TW');
    assert.equal(await page.locator('#acc-name').inputValue(),'fixture-name');assert.equal(await page.locator('#acc-pass').inputValue(),'fixture-password');
    assert.match(await page.locator('#acc-pass').getAttribute('placeholder'),/密碼/);
  } else if(game==='racing3d') {
    await page.locator('#btnBoard').click();await page.waitForSelector('#lbName');await page.locator('#lbName').fill('fixture-name');await page.locator('#lbPass').fill('fixture-password');
    assert.match(await page.locator('#lbName').getAttribute('placeholder'),/Username/);
    await page.locator('#site-language button[aria-label="zh-TW"]').click();await page.waitForFunction(()=>I18N.current()==='zh-TW');
    assert.equal(await page.locator('#lbName').inputValue(),'fixture-name');assert.equal(await page.locator('#lbPass').inputValue(),'fixture-password');
  } else {
    await page.waitForSelector('.cloud');assert.match(await page.locator('.cloud-btns').innerText(),/Upload save/);
    await page.locator('#site-language button[aria-label="zh-TW"]').click();await page.waitForFunction(()=>I18N.current()==='zh-TW');
    assert.match(await page.locator('.cloud-btns').innerText(),/上傳存檔/);
    assert.match(await page.locator('.cloud-status').innerText(),/未登入/);
  }
  await page.screenshot({path:path.join(output,'panel-'+game+'.png')});results.push({interaction:game+' account panel live switch',errors,passed:true});await ctx.close();
}
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(output,'i18n-results.json'),JSON.stringify({results,apiCalls},null,2),'utf8');}
const failed=results.filter(r=>r.errors?.length||r.warnings?.length||r.missing?.length||r.overflow||r.lang&&r.lang!==r.language||r.switches===0);console.log(JSON.stringify({cases:results.length,failed},null,2));if(failed.length)process.exitCode=1;
