import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../i18n/i18n.js',import.meta.url),'utf8');
function setup({search='',saved='',languages=['en-US']}={}) {
  const writes=[],pending=[],events={},store=new Map(saved?[['bobbychina.lang',saved]]:[]);
  const document={nodeType:9,readyState:'loading',currentScript:{src:'https://example.test/i18n/i18n.js'},documentElement:{setAttribute(){}},write:s=>writes.push(s),addEventListener:(name,fn)=>events[name]=fn,dispatchEvent(){},querySelectorAll:()=>[],createElement:tag=>({tag}),head:{appendChild:s=>pending.push(s)}};
  const c=vm.createContext({document,location:new URL('https://example.test/'+search),navigator:{languages},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},URL,URLSearchParams,Intl,Map,console,history:{state:null,replaceState(){}},CustomEvent:class{}});c.window=c;vm.runInContext(source,c);
  function load(lang){vm.runInContext(fs.readFileSync(new URL('../i18n/'+lang+'.js',import.meta.url),'utf8'),c);}
  load(c.I18N.current());return {c,writes,pending,store,load,ready:events.DOMContentLoaded};
}

test('language selection prioritizes URL and stored choice, and recognizes traditional variants',()=>{
  assert.equal(setup({search:'?lang=zh-Hant',saved:'en'}).c.I18N.current(),'zh-TW');
  assert.equal(setup({saved:'zh-TW'}).c.I18N.current(),'zh-TW');
  assert.equal(setup({languages:['fr-FR','zh-HK']}).c.I18N.current(),'zh-TW');
  assert.equal(setup({languages:['zh-CN','en']}).c.I18N.current(),'zh-CN');
  assert.equal(setup({languages:['fr-FR']}).c.I18N.current(),'zh-CN');
});

test('a failed dictionary request preserves the active and stored language',()=>{
  const {c,pending,store}=setup({saved:'zh-CN'});c.I18N.set('en');pending.at(-1).onerror();
  assert.equal(c.I18N.current(),'zh-CN');assert.equal(store.get('bobbychina.lang'),'zh-CN');
});

test('a direct language URL persists its choice for subsequent page navigation',()=>{
  const {c,ready,store}=setup({search:'?lang=zh-TW',saved:'en'});ready();
  assert.equal(c.I18N.current(),'zh-TW');assert.equal(store.get('bobbychina.lang'),'zh-TW');
});

test('a delayed language response cannot override a later selection',()=>{
  const {c,pending,load,store}=setup({saved:'zh-CN'});c.I18N.set('en');const first=pending.at(-1);c.I18N.set('zh-TW');const second=pending.at(-1);
  load('zh-TW');second.onload();load('en');first.onload();
  assert.equal(c.I18N.current(),'zh-TW');assert.equal(store.get('bobbychina.lang'),'zh-TW');
});

test('bindings preserve later writes and subscriptions can be removed',()=>{
  const {c,load}=setup({saved:'zh-CN'});load('en');
  const node={isConnected:true,textContent:''};c.I18N.bind(node,'textContent',()=>c.I18N.t('common.error.password'));
  let called=0;const off=c.I18N.onChange(()=>called++);off();c.I18N.set('en');
  assert.equal(node.textContent,'Incorrect email or password.');assert.equal(called,0);
  node.textContent='User-owned content';c.I18N.set('zh-CN');assert.equal(node.textContent,'User-owned content');
});

test('system errors and interpolation use the active language',()=>{
  const {c}=setup();vm.runInContext(fs.readFileSync(new URL('../i18n/errors.js',import.meta.url),'utf8'),c);
  assert.equal(c.I18N.error({message:'邮箱尚未验证，请先完成邮箱验证'},403),'Verify your email before signing in.');
  assert.equal(c.I18N.t('blog.views',{count:12}),'12 views');
  assert.match(c.I18N.error({message:'服务器内部详情'},500),/service is unavailable/);
  assert.match(c.I18N.errorText('Failed to fetch'),/Network error/);
});
