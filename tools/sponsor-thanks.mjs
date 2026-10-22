import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const path=fileURLToPath(new URL('../sponsor/thanks.json',import.meta.url));
const args=process.argv.slice(2);
if(args[0]!=='add') {
 console.log('核实到账并取得展示昵称的同意后：\nnode tools/sponsor-thanks.mjs add --name "公开昵称" --month 2026-10 --confirmed --consent\n可选公开金额：--amount 10.00 --amount-consent\n只更新本地感谢名单，发布后网站才会更新。');
 process.exit(args.length?1:0);
}
const opts={};
for(let i=1;i<args.length;i++){
 const key=args[i];
 if(['--confirmed','--consent','--amount-consent'].includes(key))opts[key]=true;
 else if(['--name','--month','--amount'].includes(key)&&args[i+1]&&!args[i+1].startsWith('--'))opts[key]=args[++i];
 else throw new Error('未知或缺少参数：'+key);
}
if(!opts['--confirmed']||!opts['--consent'])throw new Error('必须先核实到账并取得昵称公开同意；需要 --confirmed --consent。');
const name=(opts['--name']||'').trim(),month=opts['--month'];
if(!name||name.length>40||/[\x00-\x1f\x7f]/.test(name))throw new Error('公开昵称必须为 1–40 个字符。');
if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('月份格式应为 YYYY-MM。');
let amountCny=null;
if(opts['--amount']!==undefined){
 if(!opts['--amount-consent'])throw new Error('公开金额需要单独确认：--amount-consent。');
 if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(opts['--amount'])||Number(opts['--amount'])<=0)throw new Error('金额必须为正数，最多两位小数。');
 amountCny=Number(opts['--amount']).toFixed(2);
}
const data=JSON.parse(readFileSync(path,'utf8'));
if(data.version!==1||!Array.isArray(data.sponsors)||data.sponsors.length>=1000)throw new Error('感谢名单格式不正确或记录过多。');
if(data.sponsors.some(x=>x.name===name&&x.month===month))throw new Error('本月已有这个昵称，先核对记录，避免重复。');
data.sponsors.push({name,month,...(amountCny?{amountCny}:{})});
data.updatedAt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const temp=path+'.'+process.pid+'.tmp';
writeFileSync(temp,JSON.stringify(data,null,2)+'\n','utf8');renameSync(temp,path);
console.log('已更新本地公开感谢名单；核对后发布 sponsor/thanks.json 即可。');
