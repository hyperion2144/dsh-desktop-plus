#!/usr/bin/env node
// Syncs `upstream/` to a newer official deepseek-harness tree through a 3-way
// merge in a throwaway git repository (see `sync-merge.mjs`).
//
// The official source is never an ancestor of our history: this script extracts
// commits from a bare mirror into a scratch repo, merges the new official tree
// into our patched tree, and — after the merge is resolved — swaps the merged
// tree into `upstream/` and regenerates the contact-point patches from
// `git diff <official> <merged>`. The patches stay the source of truth; the
// scratch repo is only the upgrade tool and never touches our history.
//
// Usage:
//   node scripts/plus/sync-upstream.mjs                     # latest `master`
//   node scripts/plus/sync-upstream.mjs --ref <sha|ref>     # pin a revision
//   node scripts/plus/sync-upstream.mjs --repo <path|url>   # other source
//   node scripts/plus/sync-upstream.mjs --dry               # run the merge, report, write nothing
//   node scripts/plus/sync-upstream.mjs --finish            # apply a resolved merge
//   node scripts/plus/sync-upstream.mjs --adopt <patch>=<path,...> # 把漏收的文件纳入补丁
//   node scripts/plus/sync-upstream.mjs --regen                # 按当前 upstream/ 重生成全部补丁
//
// `--dry` performs the full merge in `.plus/tmp/sync` and reports the real
// conflict list; it never rewrites `upstream/` or the patches. A merge conflict
// leaves the scratch repo in the conflicted state; resolve it there
// (`<<<<<<<` = our plus side, `>>>>>>>` = incoming official), commit, then rerun
// with `--finish`.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { adoptFiles, checkPatches, finishUpgrade, listPatches, regenFromTree, runMerge, stageNew } from './sync-merge.mjs'

const ROOT = resolve(process.cwd())
const MIRROR = join(ROOT, '.plus', 'mirror')
const STAGING = join(ROOT, '.plus', 'tmp', 'newtree')
const TARGET = join(ROOT, 'upstream')
const HOOKS = join(ROOT, 'scripts', 'plus', 'hooks')
const BASE_FILE = join(ROOT, '.plus', 'upstream-base')

/** Required paths: a tree missing any of them is not a harness checkout. */
const REQUIRED = ['package.json', 'pnpm-workspace.yaml', 'apps/desktop/src/main.ts', 'packages/core']

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : (args[at + 1] ?? true)
}
const dry = args.includes('--dry')
const finish = args.includes('--finish')
const force = args.includes('--force')
const adopt = flag('adopt')
const regen = args.includes('--regen')

const run = (cmd, argv, options = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

const fail = (message) => {
  console.error(`sync-upstream: ${message}`)
  process.exit(1)
}

/** Resolve a recorded revision (full or abbreviated) against the official mirror. */
const resolveInMirror = (ref) => {
  try {
    return run('git', ['-C', MIRROR, 'rev-parse', '--verify', `${ref}^{commit}`]).trim()
  } catch {
    return fail(`cannot resolve the recorded official revision ${ref} in ${MIRROR}; rerun the sync`)
  }
}

const patches = listPatches(HOOKS)
const previous = existsSync(BASE_FILE) ? readFileSync(BASE_FILE, 'utf8').trim() : ''

/** Report one patch regeneration row. */
const reportRegenerated = (rows) => {
  for (const row of rows) {
    console.log(`sync-upstream: ${row.ok ? 'regenerated' : 'FAILED'} ${row.patch}${row.ok ? ` (${row.lines} lines)` : `: ${row.error}`}`)
  }
  return rows.every(row => row.ok)
}

// 已有补丁漏收 upstream 里的 plus 文件时，用它把路径纳入补丁并从合并仓库重生成：
//   --adopt 0002-desktop-plus-shell-hook.patch=apps/desktop/src/host-process.ts,apps/...
// 合并仓库的 `official` 分支与 `HEAD` 就是两侧真相，补丁只是记录文件清单。
if (typeof adopt === 'string') {
  const separator = adopt.indexOf('=')
  if (separator === -1) fail('--adopt needs <patch>=<path[,path...]>')
  const patch = adopt.slice(0, separator)
  const paths = adopt.slice(separator + 1).split(',').map(path => path.trim()).filter(path => path !== '')
  const repo = join(ROOT, '.plus', 'tmp', 'sync')
  if (!existsSync(join(repo, '.git'))) fail('--adopt needs the merge repo from a previous sync; run the sync first')
  const result = adoptFiles({ repo, hooks: HOOKS, patch, paths, target: TARGET })
  console.log(`sync-upstream: ${result.patch} now covers ${result.lines} lines; adopted ${result.adopted.join(', ') || '(no new path)'}`)
  process.exit(0)
}

// finish 之后的 upstream/ 修改（例如这轮又改了 hook 文件）不在任何补丁里；--regen 把
// 补丁覆盖的文件回灌进合并仓库并重生成，补丁重新等于活树。
if (regen) {
  const repo = join(ROOT, '.plus', 'tmp', 'sync')
  if (!existsSync(join(repo, '.git'))) fail('--regen needs the merge repo from a previous sync; run the sync first')
  if (existsSync(join(repo, '.git', 'MERGE_HEAD'))) fail('the merge is still in progress; resolve it and commit, then rerun --regen')
  const ok = reportRegenerated(regenFromTree({ repo, target: TARGET, hooks: HOOKS, patches }))
  console.log('sync-upstream: patches now match upstream/; review them, then commit')
  process.exit(ok ? 0 : 1)
}

if (finish) {
  const repo = join(ROOT, '.plus', 'tmp', 'sync')
  if (!existsSync(join(repo, '.git'))) fail('--finish needs a merge repo from a previous run; run the sync first')
  if (existsSync(join(repo, '.git', 'MERGE_HEAD'))) fail('the merge is still in progress; resolve it and commit, then rerun --finish')
  const shaFile = join(ROOT, '.plus', 'tmp', 'sync-official-sha')
  if (!existsSync(shaFile)) fail('the merge repo has no recorded official SHA; rerun the sync')
  // 旧版本把 SHA 记在合并仓库里，会被当成 upstream 文件；顺手清掉。
  rmSync(join(repo, '.plus-upstream-sha'), { force: true })
  // 记录里可能是手写的短 SHA；落盘前一律解析成完整 SHA。
  const newSha = resolveInMirror(readFileSync(shaFile, 'utf8').trim())
   let ok = false
   try {
     ok = reportRegenerated(finishUpgrade({ root: ROOT, repo, target: TARGET, hooks: HOOKS, patches, newSha }))
   } catch (error) {
     fail(error instanceof Error ? error.message : String(error))
   }
  run(process.execPath, [join(ROOT, 'scripts', 'plus', 'gen-workspace.mjs')])
  console.log(`sync-upstream: finished at ${newSha.slice(0, 10)}. Next: pnpm install, review diffs, then commit.`)
  process.exit(ok ? 0 : 1)
}

// 1. Fetch the requested revision into the mirror and extract it.
const rawSource = flag('repo') ?? 'https://github.com/deepseek-ai/deepseek-harness.git'
const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawSource) || /^[^/]+@[^:]+:/.test(rawSource)
const source = isRemote ? rawSource : resolve(ROOT, rawSource)
const ref = flag('ref') ?? 'master'

mkdirSync(MIRROR, { recursive: true })
if (!existsSync(join(MIRROR, 'HEAD'))) run('git', ['init', '--bare', MIRROR])
try {
  run('git', ['-C', MIRROR, 'fetch', '--no-tags', '--force', source, ref])
} catch (error) {
  fail(`cannot fetch ${ref} from ${source}: ${(error.stderr ?? '').toString().trim() || error.message}`)
}
const sha = run('git', ['-C', MIRROR, 'rev-parse', 'FETCH_HEAD']).trim()
if (sha === previous && !force) {
  console.log(`sync-upstream: already at ${sha.slice(0, 10)} (use --force to resync)`)
  process.exit(0)
}

rmSync(STAGING, { recursive: true, force: true })
mkdirSync(STAGING, { recursive: true })
stageNew(STAGING, MIRROR, sha)
const missing = REQUIRED.filter(path => !existsSync(join(STAGING, path)))
if (missing.length > 0) fail(`official tree at ${sha} is missing ${missing.join(', ')}`)

const subject = run('git', ['-C', MIRROR, 'log', '-1', '--format=%s', sha]).trim()
console.log(`sync-upstream: ${previous ? previous.slice(0, 10) : '(none)'} -> ${sha.slice(0, 10)} ${subject}`)

// 2. Patch applicability against the new tree. Diagnostic only: a patch that no
//    longer applies as-is is exactly what the merge exists to resolve.
for (const row of checkPatches({ root: ROOT, staging: STAGING, patches })) {
  console.log(`sync-upstream: patch ${row.ok ? 'applies as-is' : 'needs the merge'}: ${row.patch}${row.ok ? '' : ` (${row.error})`}`)
}

// 3. The real check: a 3-way merge in the scratch repository.
if (previous === '') fail('no .plus/upstream-base; cannot build a merge base')
const merge = runMerge({ root: ROOT, mirror: MIRROR, previousBase: previous, newSha: sha, oursTree: TARGET })
// 真实官方 SHA 与临时仓库的 commit 不同，持久化给 --finish 用。
// 真实官方 SHA 与临时仓库的 commit 不同，持久化给 --finish 用。放在合并仓库之外，免得被当成 upstream 文件搬进去。
writeFileSync(join(ROOT, '.plus', 'tmp', 'sync-official-sha'), `${sha}\n`)

if (dry) {
  if (merge.clean) {
    console.log('sync-upstream: --dry, the merge is clean; nothing written')
    process.exit(0)
  }
  console.log(`sync-upstream: --dry, merge conflicts in ${merge.conflicts.length} file(s):`)
  for (const file of merge.conflicts) console.log(`  ${file}`)
  console.log(`sync-upstream: --dry wrote nothing; the conflicted merge repo is ${merge.repo}`)
  process.exit(1)
}

if (!merge.clean) {
  console.log(`sync-upstream: merge conflicts in ${merge.conflicts.length} file(s):`)
  for (const file of merge.conflicts) console.log(`  ${file}`)
  console.log(`sync-upstream: resolve them in ${merge.repo}`)
  console.log('  <<<<<<< = our plus side, >>>>>>> = incoming official')
  console.log('  git -C .plus/tmp/sync add -A && git -C .plus/tmp/sync commit --no-edit')
  console.log('  then: node scripts/plus/sync-upstream.mjs --finish')
  process.exit(1)
}

let ok = false
try {
  ok = reportRegenerated(finishUpgrade({ root: ROOT, repo: merge.repo, target: TARGET, hooks: HOOKS, patches, newSha: sha }))
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
run(process.execPath, [join(ROOT, 'scripts', 'plus', 'gen-workspace.mjs')])
console.log(`sync-upstream: done at ${sha.slice(0, 10)}. Next: pnpm install, review pnpm-workspace.yaml, then commit.`)
process.exit(ok ? 0 : 1)
