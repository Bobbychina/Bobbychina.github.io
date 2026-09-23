// 把留言板 text 行里混进来的 ASCII 双引号换成中文引号（「」交替），避免 JSON 字符串被提前截断。
// 我在这上面连栽三次（写完不 node --check 就提交），干脆做成工具：node tools/fix-notes-quotes.mjs [--check]
//   --check  只报告不修改（退出码 = 有问题的文件数），适合放进提交前的习惯动作
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const DIR = path.join(REPO, 'games/vampire-survivors/js/data/notes')
const checkOnly = process.argv.includes('--check')

let bad = 0
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js'))) {
  const full = path.join(DIR, file)
  const src = fs.readFileSync(full, 'utf8')
  let fixed = ''
  let touched = 0
  for (const line of src.split('\n')) {
    const m = /^(\s*"text":\s*")(.*)("\s*,?)\s*$/.exec(line)
    if (!m) { fixed += line + '\n'; continue }
    const [, head, body, tail] = m
    let n = 0
    const clean = body.replace(/"/g, () => (++n % 2 ? '「' : '」'))
    if (clean !== body) { touched++; fixed += head + clean + tail + '\n' } else fixed += line + '\n'
  }
  if (touched) {
    bad++
    console.log(`${checkOnly ? '⚠️ ' : '🔧 '}${file}：${touched} 行含裸 ASCII 引号`)
    if (!checkOnly) { fs.writeFileSync(full, fixed) }
  } else {
    console.log(`✅ ${file}：干净`)
  }
}
if (checkOnly) console.log(bad ? `有 ${bad} 个文件需要修（去掉 --check 直接跑就会修）` : '全部干净')
process.exit(bad ? 1 : 0)
