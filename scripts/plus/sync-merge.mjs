/**
 * Merge-based upstream sync engine (PR #33 comment 6459440726 item 11).
 *
 * The old flow replaced `upstream/` with the official tree and re-applied
 * patches with `git apply`. When upstream moved a context line, every patch
 * failed with an unreadable `patch does not apply` and nothing said which side
 * changed what. This module keeps the patch files as the source of truth but
 * uses a throwaway git repository for the upgrade itself:
 *
 *   base            old official tree (`.plus/upstream-base`)
 *   plus            our current `upstream/` tree (base + applied patches)
 *   official        the new official tree
 *
 * `git merge official` inside `plus` gives a real 3-way merge: upstream edits
 * and our patches merge automatically where they touch different lines, and
 * conflicts land as `<<<<<<<` markers in the throwaway repo instead of an
 * opaque patch failure. After the merge the patches are regenerated from
 * `git diff official merged`, so they stay authoritative for the next sync.
 *
 * Nothing outside `.plus/tmp/` is written until `finishUpgrade` runs.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Run git in one directory; throws with trimmed stderr for the caller. */
function git(cwd, argv) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Run git and report the failure instead of throwing. */
function tryGit(cwd, argv) {
  try {
    return { ok: true, out: git(cwd, argv) }
  } catch (error) {
    return { ok: false, out: `${(error.stderr ?? '').toString().trim() || error.message}` }
  }
}

/** Patch files in application order. */
export function listPatches(hooks) {
  return existsSync(hooks)
    ? readdirSync(hooks).filter(name => name.endsWith('.patch')).sort()
    : []
}

/** Files one patch touches, taken from its `diff --git` headers (repo-relative). */
export function patchFiles(patchPath) {
  const text = readFileSync(patchPath, 'utf8')
  const files = []
  for (const line of text.split('\n')) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line)
    if (match !== null && match[1] === match[2]) files.push(match[1])
  }
  return files
}

/**
 * Re-apply every patch onto a copy of the new official tree as a plain
 * `git apply --check` report. This is diagnostic only: a failing check is
 * expected during an upgrade and the merge decides what actually applies.
 * @param context - directories and patch list.
 * @returns one row per patch with the first failure line.
 */
export function checkPatches({ root, staging, patches }) {
  // 必须在仓库之外跑：git apply 在子目录里会按仓库根解析路径，会拿旧树误判“可应用”。
  const checkRoot = mkdtempSync(join(tmpdir(), 'dsh-sync-check-'))
  mkdirSync(join(checkRoot, 'upstream'), { recursive: true })
  cpSync(staging, join(checkRoot, 'upstream'), { recursive: true, verbatimSymlinks: true })
  try {
    return patches.map((patch) => {
      const result = tryGit(checkRoot, ['apply', '--check', '--whitespace=nowarn', join(root, 'scripts', 'plus', 'hooks', patch)])
      return result.ok
        ? { patch, ok: true }
        : { patch, ok: false, error: result.out.split('\n')[0] ?? '' }
    })
  } finally {
    rmSync(checkRoot, { recursive: true, force: true })
  }
}

/**
 * Extract one official commit into a throwaway repo working tree.
 * @param cwd - repo directory.
 * @param mirror - bare mirror holding the commit.
 * @param sha - official commit.
 */
function extract(cwd, mirror, sha) {
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  execFileSync('bash', ['-c', `git -C "${mirror}" archive "${sha}" | tar -x -C "${cwd}"`], { stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Replace a work tree's contents without touching its .git directory. */
function replaceTree(repo, source) {
  for (const entry of readdirSync(repo)) {
    if (entry !== '.git') rmSync(join(repo, entry), { recursive: true, force: true })
  }
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(repo, entry), { recursive: true, verbatimSymlinks: true })
  }
}

/**
 * Build the merge repo: base = old official tree, plus = our current tree,
 * official = the new tree; then merge official into plus.
 * @param options - repo roots, shas, and the current upstream tree.
 * @returns merge repo path plus conflict state.
 */
export function runMerge({ root, mirror, previousBase, newSha, oursTree }) {
  const repo = join(root, '.plus', 'tmp', 'sync')
  const baseTree = join(root, '.plus', 'tmp', 'sync-base')
  const officialTree = join(root, '.plus', 'tmp', 'sync-official')
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '--quiet', '-b', 'base'])
  git(repo, ['config', 'user.name', 'dsh-desktop-plus sync'])
  git(repo, ['config', 'user.email', 'sync@dsh-desktop-plus.invalid'])

  // base = the official tree our patches were written against.
  if (previousBase === '') throw new Error('sync-merge: .plus/upstream-base is empty; cannot build a merge base')
  extract(baseTree, mirror, previousBase)
  replaceTree(repo, baseTree)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '--quiet', '-m', `official base ${previousBase.slice(0, 10)}`])

  // official = the tree we are upgrading to.
  git(repo, ['checkout', '--quiet', '-b', 'official'])
  extract(officialTree, mirror, newSha)
  replaceTree(repo, officialTree)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '--quiet', '-m', `official ${newSha.slice(0, 10)}`])

  // plus = our patched tree today.
  git(repo, ['checkout', '--quiet', '-b', 'plus', 'base'])
  replaceTree(repo, oursTree)
  git(repo, ['add', '-A'])
  git(repo, ['commit', '--quiet', '-m', 'plus patches'])

  // The merge itself: real 3-way, conflicts surface as markers in the repo.
  const merge = tryGit(repo, ['merge', '--no-edit', 'official'])
  if (merge.ok) return { repo, clean: true, conflicts: [], log: merge.out.trim() }
  const conflicts = tryGit(repo, ['diff', '--name-only', '--diff-filter=U'])
    .out.split('\n').map(line => line.trim()).filter(line => line !== '')
  return { repo, clean: false, conflicts, log: merge.out.trim() }
}

/**
 * Finalize a resolved merge: replace `upstream/`, regenerate every patch from
 * the merged tree, record the new base SHA, and restate the workspace.
 * @param options - merge repo, target tree, hooks dir, version SHA.
 * @returns per-patch regeneration summary.
 */
export function finishUpgrade({ root, repo, target, hooks, patches, newSha }) {
  const merging = tryGit(repo, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])
  if (merging.ok) throw new Error('sync-merge: the merge is still unresolved; commit it first')

  // 已经 finish 过一次后再 finish，会用合并树把 upstream/ 里后来的人工修改冲掉；
  // 标记文件存在时要求 upstream/ 仍等于合并树，否则让调用方重新跑 sync。
  const finishedMarker = join(root, '.plus', 'tmp', 'sync-finished')
  if (existsSync(finishedMarker)) {
    const drift = tryGit(repo, [`--work-tree=${resolve(target)}`, 'status', '--porcelain'])
    if (!drift.ok) throw new Error(`sync-merge: cannot compare ${target} with the merge repo: ${drift.out}`)
    const changed = drift.out.split('\n').map(line => line.trim()).filter(line => line !== '')
    if (changed.length > 0) {
      throw new Error(`sync-merge: ${target} has changes the merge repo does not carry (${changed.slice(0, 5).join(', ')}); run the sync again instead of --finish`)
    }
  }

  // Swap the tree: the merge repo working tree is authoritative now.
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(repo)) {
    // 合并仓库里的工具账本（`.plus-*`）不属于 upstream 树，不能跟着搬进去。
    if (entry === '.git' || entry.startsWith('.plus-')) continue
    cpSync(join(repo, entry), join(target, entry), { recursive: true, verbatimSymlinks: true })
  }

  // Regenerate patches: diff of the merged tree against the new official tree,
  // with the repo-root `upstream/` prefixes the applier expects.
  const regenerated = []
  for (const patch of patches) {
    const patchPath = join(hooks, patch)
    const files = patchFiles(patchPath)
    if (files.length === 0) {
      regenerated.push({ patch, ok: false, error: 'no files in patch headers' })
      continue
    }
    const relative = files.map(file => file.startsWith('upstream/') ? file.slice('upstream/'.length) : file)
    const diff = git(repo, ['diff', 'official', 'HEAD', '--src-prefix=a/upstream/', '--dst-prefix=b/upstream/', '--binary', '--', ...relative])
    if (diff.trim() === '') regenerated.push({ patch, ok: false, error: 'empty diff after merge' })
    else {
      writeFileSync(patchPath, diff)
      regenerated.push({ patch, ok: true, lines: diff.split('\n').length - 1 })
    }
  }

  writeFileSync(join(root, '.plus', 'upstream-base'), `${newSha}\n`)
  // 记下这一次 finish 的合并树，供下次 --finish 判断 upstream/ 是否已有人工修改。
  writeFileSync(join(root, '.plus', 'tmp', 'sync-finished'), `${git(repo, ['rev-parse', 'HEAD']).trim()}\n`)
  return regenerated
}

/**
 * Widen one patch to cover more files, then regenerate it from the merge repo.
 * Use it when a plus change was committed under `upstream/` without being listed
 * in any patch: the merged tree is authoritative, so the patch only has to learn
 * which paths it owns. The patch's own header list stays the source of truth for
 * later regenerations.
 * @param options - merge repo, hooks directory, patch file name, and extra repo-relative paths.
 * @returns adopted paths and the regenerated patch size.
 */
export function adoptFiles({ repo, hooks, patch, paths, target }) {
  const patchPath = join(hooks, patch)
  if (!existsSync(patchPath)) throw new Error(`sync-merge: no such patch ${patch}`)
  // 补丁头里的路径带 `upstream/` 前缀，git diff 要的是仓库相对路径。
  const relative = (path) => path.startsWith('upstream/') ? path.slice('upstream/'.length) : path
  const known = patchFiles(patchPath).map(relative)
  const extra = paths.map(relative).filter(path => !known.includes(path))
  // merge 仓库的 HEAD 停留在上次回灌时点：新 adopt 的文件（不在旧补丁清单里）在
  // repo 里还是旧内容，diff(official..HEAD) 会为空。先把活树版本回灌再 diff。
  if (target !== undefined) {
    for (const path of [...known, ...extra]) {
      const source = join(target, path)
      if (!existsSync(source)) continue
      mkdirSync(dirname(join(repo, path)), { recursive: true })
      rmSync(join(repo, path), { force: true })
      cpSync(source, join(repo, path))
    }
  }
  git(repo, ['add', '--', ...known, ...extra])
  const diff = git(repo, ['diff', 'official', '--src-prefix=a/upstream/', '--dst-prefix=b/upstream/', '--binary', '--', ...known, ...extra])
  if (diff.trim() === '') throw new Error(`sync-merge: ${patch} would be empty after adopting ${extra.join(', ')}`)
  writeFileSync(patchPath, diff)
  return { patch, adopted: extra, lines: diff.split('\n').length - 1 }
}

/**
 * Re-record patch-covered files from the live `upstream/` tree into the merge
 * repo, then regenerate every patch from `official..HEAD`.
 *
 * `finishUpgrade` only knows the tree it wrote; plus edits made after that (a
 * later fix inside a hook file) stay outside every patch until the next sync.
 * This mode puts them back into the patch set without touching the tree.
 * @param options - merge repo, target tree, hooks dir, and patch names.
 * @returns per-patch regeneration rows.
 */
export function regenFromTree({ repo, target, hooks, patches }) {
  const relative = (path) => path.startsWith('upstream/') ? path.slice('upstream/'.length) : path
  const covered = []
  for (const patch of patches) {
    for (const file of patchFiles(join(hooks, patch)).map(relative)) {
      if (!covered.includes(file)) covered.push(file)
    }
  }
  if (covered.length === 0) throw new Error('sync-merge: no patch covers any file')
  for (const file of covered) {
    const source = join(target, file)
    const destination = join(repo, file)
    if (!existsSync(source)) {
      rmSync(destination, { force: true })
      continue
    }
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
  git(repo, ['add', '--', ...covered])
  const commit = tryGit(repo, ['commit', '--no-edit', '--amend', '--quiet'])
  if (!commit.ok) throw new Error(`sync-merge: cannot record the tree in the merge repo: ${commit.out}`)
  const regenerated = []
  for (const patch of patches) {
    const files = patchFiles(join(hooks, patch)).map(relative)
    const diff = git(repo, ['diff', 'official', 'HEAD', '--src-prefix=a/upstream/', '--dst-prefix=b/upstream/', '--binary', '--', ...files])
    if (diff.trim() === '') regenerated.push({ patch, ok: false, error: 'empty diff after regen' })
    else {
      writeFileSync(join(hooks, patch), diff)
      regenerated.push({ patch, ok: true, lines: diff.split('\n').length - 1 })
    }
  }
  return regenerated
}

/** Copy the new official tree into the staging directory the caller validated. */
export function stageNew(treeDir, mirror, sha) {
  extract(treeDir, mirror, sha)
}
