import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
const languages=['zh-CN','zh-TW','en'], dictionaries={};
for(const language of languages)vm.runInNewContext(fs.readFileSync(path.join(root,'i18n',language+'.js'),'utf8'),{I18N:{define:(code,dict)=>dictionaries[code]=dict}});
const problems=[],used=new Map();
const add=(key,file)=>{if(!key)return;if(!used.has(key))used.set(key,new Set());used.get(key).add(file);};
const files=[];
function walk(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.name.startsWith('.')||['tools','docs','i18n'].includes(file))continue;if(entry.isDirectory())walk(file);else if(/\.(html|js)$/.test(file))files.push(file);}}
walk('');
for (const file of ['../bobbychina-blog/build.mjs','../Games/zombieSurvival/src/v4/account-ui.ts',"../Games/Femboy's game/racing3d/index.html"]) if(fs.existsSync(path.join(root,file))) files.push(file);
for(const file of files){const src=fs.readFileSync(path.join(root,file),'utf8');for(const m of src.matchAll(/data-i18n(?:-html)?=["']([^"']+)["']/g))add(m[1],file);for(const m of src.matchAll(/data-i18n-attr=["']([^"']+)["']/g))for(const pair of m[1].split(';'))add(pair.slice(pair.indexOf(':')+1).trim(),file);for(const m of src.matchAll(/\b(?:I18N\.t|global\.I18N\.t|T|siteText)\(\s*["']([^"']+)["']/g)){if(!m[1].endsWith('.'))add(m[1],file);}for(const m of src.matchAll(/["'](thanks\.[\w.]+)["']/g))add(m[1],file);}
for(const file of files){const src=fs.readFileSync(path.join(root,file),'utf8');for(const m of src.matchAll(/["']((?:cloud|arcade|racing|site)\.copy\.[a-f0-9]{12})["']/g))add(m[1],file);}
const baseline=dictionaries['zh-CN'];
const emoji=s=>[...s.matchAll(/\p{Extended_Pictographic}/gu)].map(m=>m[0]).join('');
for(const key of Object.keys(baseline)) if(emoji(baseline[key])!==emoji(dictionaries['zh-TW'][key] || ''))problems.push(`zh-TW emoji differ: ${key}`);
for(const language of languages){const dict=dictionaries[language];for(const key of Object.keys(baseline)){if(typeof dict[key]!=='string'){problems.push(`${language} missing ${key}`);continue;}const vars=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');if(vars(dict[key])!==vars(baseline[key]))problems.push(`${language} placeholders differ: ${key}`);}for(const key of Object.keys(dict))if(!(key in baseline))problems.push(`${language} unexpected ${key}`);for(const [key,places] of used)if(!(key in dict))problems.push(`${language} missing used key ${key}: ${[...places].join(', ')}`);}
console.log(`${files.length} source files; ${used.size} referenced keys; ${languages.map(l=>l+'='+Object.keys(dictionaries[l]).length).join(', ')}`);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log('All languages, used keys and interpolation variables match.');
