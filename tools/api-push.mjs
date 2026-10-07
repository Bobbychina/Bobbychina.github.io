/* 用 GitHub API 把本地 main 的那一个提交推到远端
 *
 * 为什么需要它：git push 被服务端 "Internal Server Error" 拒了（连着 5 次），
 * 而 ls-remote / API 都正常 —— 是这个仓库后端层的故障，不是网络也不是内容。
 * API 写 blob → tree → commit → 更新 ref 是官方支持的路径，能绕过 git 接收端的故障。
 *
 * 只推「远端 HEAD 之后的那一个提交」，逐字节使用本地文件内容，不重写历史。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = 'Bobbychina/Bobbychina.github.io';
const WORK = 'E:/Files/bobbychina-pages';
const BRANCH = 'main';
const TMP = mkdtempSync(join(tmpdir(), 'apipush-'));

function gh(args, input, raw = false) {
  const full = [...args];
  // 用 --input <文件> 而不是 --input -（stdin 管道在这台机上不可靠，实测返回空体）
  if (input !== undefined) {
    const f = join(TMP, `body-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, input, 'utf8');
    full.push('--input', f);
  }
  // --include 让失败时也能看到 HTTP 状态码
  full.push('--include');
  const r = spawnSync('gh', full, { encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout || '';
  const status = (out.match(/^HTTP\/[\d.]+ (\d+)/m) || [])[1] || '?';
  const body = out.replace(/^HTTP\/[\d.]+ .*\r?\n(?:[^\r\n]*\r?\n)*\r?\n/s, '').trim();
  if (r.status !== 0 || !/^2\d\d$/.test(status)) {
    throw new Error(`gh ${full.slice(0, 3).join(' ')} → HTTP ${status}（cli exit ${r.status}）: ${body.slice(0, 500) || (r.stderr || '').slice(0, 500)}`);
  }
  if (!body) return null;
  return raw ? body : JSON.parse(body);
}
const git = (...a) => {
  const r = spawnSync('git', ['-C', WORK, ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} 失败: ${r.stderr}`);
  return r.stdout.trim();
};

// ── 1. 算出要推哪些提交 ────────────────────────────────────────────────────
const remoteSha = git('ls-remote', '--heads', 'origin', BRANCH).split(/\s+/)[0];
const pending = git('log', '--reverse', '--format=%H', `${remoteSha}..HEAD`).split('\n').filter(Boolean);
console.log(`远端 HEAD: ${remoteSha.slice(0, 7)}`);
console.log(`待推提交 ${pending.length} 个: ${pending.map((s) => s.slice(0, 7)).join(', ')}`);
if (!pending.length) { console.log('没有待推提交，退出'); process.exit(0); }

let parent = remoteSha;

for (const sha of pending) {
  const subject = git('log', '-1', '--format=%s', sha);
  // 这个提交改了哪些文件（相对其父提交）
  const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean);
  console.log(`\n=== ${sha.slice(0, 7)} ${subject}`);
  console.log(`  改动文件 ${changed.length} 个: ${changed.join(', ')}`);

  const baseTree = gh(['api', `repos/${REPO}/git/commits/${parent}`, '--jq', '.tree.sha'], undefined, true);
  console.log(`  父提交 tree: ${baseTree.slice(0, 10)}`);

  // ── 2. 为每个改动文件建 blob（二进制安全：用 base64）────────────────────
  const treeEntries = [];
  for (const path of changed) {
    const local = join(WORK, path);
    let content, mode = '100644';
    try {
      content = readFileSync(local);
    } catch {
      // 文件被删除 → 用 null sha 表示删除
      treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
      console.log(`  - 删除 ${path}`);
      continue;
    }
    const blob = gh(['api', '--method', 'POST', `repos/${REPO}/git/blobs`, '--input', '-'],
      JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }));
    treeEntries.push({ path, mode, type: 'blob', sha: blob.sha });
    console.log(`  + ${path} (${content.length} bytes → blob ${blob.sha.slice(0, 10)})`);
  }

  // ── 3. 建 tree / commit ────────────────────────────────────────────────
  const tree = gh(['api', '--method', 'POST', `repos/${REPO}/git/trees`, '--input', '-'],
    JSON.stringify({ base_tree: baseTree, tree: treeEntries }));
  const author = {
    name: git('log', '-1', '--format=%an', sha),
    email: git('log', '-1', '--format=%ae', sha),
    date: git('log', '-1', '--format=%aI', sha),
  };
  const body = git('log', '-1', '--format=%b', sha);
  const commit = gh(['api', '--method', 'POST', `repos/${REPO}/git/commits`, '--input', '-'],
    JSON.stringify({ message: body ? `${subject}\n\n${body}` : subject, tree: tree.sha, parents: [parent], author, committer: author }));
  console.log(`  新 commit: ${commit.sha.slice(0, 7)}`);
  parent = commit.sha;
}

// ── 4. 更新分支 ref ──────────────────────────────────────────────────────
const ref = gh(['api', '--method', 'PATCH', `repos/${REPO}/git/refs/heads/${BRANCH}`, '--input', '-'],
  JSON.stringify({ sha: parent, force: false }));
console.log(`\n✓ refs/heads/${BRANCH} → ${ref.object.sha}`);
