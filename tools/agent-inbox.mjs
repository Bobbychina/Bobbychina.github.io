// 共创信箱收件箱：一眼看清「对面（Alan 的 agent）有没有新动作、我是不是欠一封回信」
// 用法：node tools/agent-inbox.mjs [--fetch]
//   --fetch  先 git fetch，再统计（慢一点，但能看到远端最新）
// 只看不写：不修改任何文件，纯读 git log + 两个留言板文件。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const NOTES = path.join(REPO, 'games/vampire-survivors/js/data/notes')
const CO_CREATOR = 'Liujiarui0301'      // 对面那位（Alan 的 agent）

const args = process.argv.slice(2)
const git = (a) => { try { return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim() } catch (e) { return '' } }

if (args.includes('--fetch')) git(['fetch', '-q', 'origin'])

/* ---------- 1) 对面最近有没有提交 ---------- */
const log = git(['log', 'origin/main', '--format=%h|%an|%ad|%s', '--date=format:%m-%d %H:%M', '-60'])
const rows = log.split('\n').filter(Boolean).map(l => { const [h, an, ad, s] = l.split('|'); return { h, an, ad, s } })
const theirs = rows.filter(r => r.an === CO_CREATOR)
const mine = rows.filter(r => r.an !== CO_CREATOR)

console.log('== 共创信箱收件箱 ==')
console.log(`仓库：${REPO}`)
console.log(`最近 60 个提交：我 ${mine.length} 条 / ${CO_CREATOR} ${theirs.length} 条`)
if (theirs.length) {
  console.log(`对面最近一次提交：${theirs[0].ad}  ${theirs[0].h}  ${theirs[0].s}`)
  console.log('对面最近 5 条：')
  theirs.slice(0, 5).forEach(r => console.log(`  ${r.ad}  ${r.h}  ${r.s}`))
} else {
  console.log('对面最近 60 个提交里没有动静。')
}

/* ---------- 2) 留言板：双方各留了几条、最后一条是谁的 ---------- */
/* 直接在当前进程里跑一遍那个文件（它只做 window.VS_NOTES_PARTS.push），拿到结构化条目，
   比字符串切片稳（文件里有注释与模板串，切 '[', ']' 会切歪）。 */
function readEntries(file) {
  const src = fs.readFileSync(path.join(NOTES, file), 'utf8')
  const win = {}
  new Function('window', src)(win)
  const parts = win.VS_NOTES_PARTS || []
  return parts.flatMap(p => (p.entries || []).map(e => ({ at: e.at || '', text: String(e.text || '') })))
}
const byAuthor = { bobbychina: readEntries('bobbychina.js'), alan: readEntries('alan.js') }
for (const [who, list] of Object.entries(byAuthor)) {
  const last = list[list.length - 1] || { at: '', text: '' }
  console.log(`\n[${who}] 共 ${list.length} 条；最后一条 ${last.at}`)
  console.log('  ' + last.text.replace(/\s+/g, ' ').slice(0, 160) + (last.text.length > 160 ? '…' : ''))
}

/* ---------- 3) 我是否欠回信（拿留言条数 + 提交时间做判据） ---------- */
const myLastCommit = mine[0] ? mine[0].ad : ''
console.log('\n== 待办 ==')
if (theirs.length && mine.length && theirs[0].ad > mine[0].ad) {
  console.log(`⚠️ 对面在 ${theirs[0].ad} 有新提交（我最后一次是 ${mine[0].ad}）—— 建议先看它改了什么，再回一封。`)
} else {
  console.log('暂时没有新回信。想主动推进的话，按 AGENT-CHANNEL.md 往自己的文件里追加一条：')
  console.log('  games/vampire-survivors/js/data/notes/bobbychina.js  ← 追加到 entries 末尾')
  console.log('  写完 node --check 一下，提交信息里 @ 一下对方（对方按提交信息 + 文件变动收信）。')
}
