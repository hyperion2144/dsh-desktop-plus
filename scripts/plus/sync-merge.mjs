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
 *   plus            the baseline with our patch set applied
 *   official        the new official tree
 *
 * `git merge official` inside `plus` gives a real 3-way merge: upstream edits
 * and our patches merge automatically where they touch different lines, and
 * conflicts land as `<<<<<<<` markers in the throwaway repo instead of an
 * opaque patch failure. After the merge the patches are regenerated from
 * `git diff official merged`, so they stay authoritative for the next sync.
 *
 * The scratch repository mirrors the real layout — the official tree lives
 * under `upstream/` — so the patch files apply with the paths they carry and
 * the regenerated diffs come out with the same paths.
 *
 * The plus side of the merge is the baseline *plus the patch set*, not the
 * working tree: `upstream/` is committed as the clean official tree, so the
 * patches are what carries our changes into an upgrade.
 *
 * Nothing outside `.plus/tmp/` is written until `finishUpgrade` runs.
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyPatches, patchFiles } from './patch-set.mjs'
import { writeBase } from './upstream-baseline.mjs'

/** Run git in one directory; throws with trimmed stderr for the caller. */
function git(cwd, argv) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
}

/** Run git and report the failure instead of throwing. */
function tryGit(cwd, argv) {
  try {
    return { ok: true, out: git(cwd, argv) }
  } catch (error) {
    return { ok: false, out: `${(error.stderr ?? '').toString().trim() || error.message}` }
  }
}

/**
 * Extract one official commit into a working tree.
 * @param cwd - Directory to fill.
 * @param mirror - Bare mirror holding the commit.
 * @param sha - Official commit.
 */
function extract(cwd, mirror, sha) {
  rmSync(cwd, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  execFileSync('bash', ['-c', `git -C "${mirror}" archive "${sha}" | tar -x -C "${cwd}"`], { stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Stage everything in the scratch repository, ignored paths included.
 *
 * `git add -A` honours the `.gitignore` files the official tree carries, and
 * the official repository tracks a handful of fixtures those rules match
 * (`.agents/worktrees/…`, `*.local`). Staging without `--force` therefore
 * commits a tree smaller than the official one, which is how a sync used to
 * lose four files and record a tree id nobody could reproduce.
 * @param repo - Scratch repository.
 */
function stageAll(repo) {
  git(repo, ['add', '-A', '--force'])
}

/**
 * Replace a directory's contents with another directory's.
 * @param dir - Directory to overwrite.
 * @param source - Directory to copy from.
 */
function replaceTree(dir, source) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const entry of readdirSync(source)) {
    cpSync(join(source, entry), join(dir, entry), { recursive: true, verbatimSymlinks: true })
  }
}

/**
 * Build the merge repo: base = old official tree, plus = the baseline with our
 * patch set applied, official = the new tree; then merge official into plus.
 * @param {object} options - Repo roots, shas, and the patch set.
 * @param {string} options.root - Repository root.
 * @param {string} options.mirror - Bare mirror of the official repository.
 * @param {string} options.previousBase - Official commit the patches target.
 * @param {string} options.newSha - Official commit to upgrade to.
 * @param {string[]} options.patchPaths - Absolute paths of the patch files.
 * @returns {object} Merge repo path plus conflict state.
 */
export function runMerge({ root, mirror, previousBase, newSha, patchPaths }) {
  const repo = join(root, '.plus', 'tmp', 'sync')
  const baseTree = join(root, '.plus', 'tmp', 'sync-base')
  const officialTree = join(root, '.plus', 'tmp', 'sync-official')
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '--quiet', '-b', 'base'])
  git(repo, ['config', 'user.name', 'dsh-desktop-plus sync'])
  git(repo, ['config', 'user.email', 'sync@dsh-desktop-plus.invalid'])
  const target = join(repo, 'upstream')

  // base = the official tree our patches were written against.
  if (previousBase === '') throw new Error('sync-merge: .plus/upstream-base is empty; cannot build a merge base')
  extract(baseTree, mirror, previousBase)
  replaceTree(target, baseTree)
  stageAll(repo)
  git(repo, ['commit', '--quiet', '-m', `official base ${previousBase.slice(0, 10)}`])

  // official = the tree we are upgrading to.
  git(repo, ['checkout', '--quiet', '-b', 'official'])
  extract(officialTree, mirror, newSha)
  replaceTree(target, officialTree)
  stageAll(repo)
  git(repo, ['commit', '--quiet', '-m', `official ${newSha.slice(0, 10)}`])

  // The staged commit has to be the official tree byte for byte. The force
  // inside `stageAll` is what makes that true; this check reports the next
  // way it can stop being true, instead of letting `upstream/` end up short
  // of files and only `verify:patches` noticing.
  const stagedTreeId = git(repo, ['rev-parse', 'official:upstream']).trim()
  const mirrorTreeId = git(mirror, ['rev-parse', `${newSha}^{tree}`]).trim()
  if (stagedTreeId !== mirrorTreeId) {
    throw new Error(`sync-merge: the staged official tree is ${stagedTreeId}, the official commit's tree is ${mirrorTreeId}`)
  }

  // plus = the baseline with our patch set applied. `upstream/` is committed as
  // the clean official tree, so the plus side of the merge is not the working
  // tree but the baseline plus the patches.
  git(repo, ['checkout', '--quiet', '-b', 'plus', 'base'])
  replaceTree(target, baseTree)
  const applied = applyPatches({ cwd: repo, patches: patchPaths })
  const failed = applied.filter(row => !row.ok)
  if (failed.length > 0) {
    throw new Error(`sync-merge: the patch set does not apply to ${previousBase.slice(0, 10)}: ${failed[0].patch} (${failed[0].error})`)
  }
  stageAll(repo)
  git(repo, ['commit', '--quiet', '-m', 'plus patches'])

  // The merge itself: real 3-way, conflicts surface as markers in the repo.
  const merge = tryGit(repo, ['merge', '--no-edit', 'official'])
  if (merge.ok) return { repo, clean: true, conflicts: [], log: merge.out.trim() }
  const conflicts = tryGit(repo, ['diff', '--name-only', '--diff-filter=U'])
    .out.split('\n').map(line => line.trim()).filter(line => line !== '')
  return { repo, clean: false, conflicts, log: merge.out.trim() }
}

/**
 * Finalize a resolved merge: regenerate every patch from the merged tree, put
 * the official tree back into `upstream/`, and record the new baseline.
 *
 * The patches stay the source of truth and `upstream/` stays the untouched
 * official tree — the two are only ever joined at build time.
 *
 * @param {object} options - Merge repo, mirror, target tree, hooks dir, patch names, version SHA.
 * @param {string} options.mirror - Bare mirror holding the official commit.
 * @returns {object} Per-patch regeneration summary.
 */
export function finishUpgrade({ root, repo, mirror, target, hooks, patches, newSha }) {
  const merging = tryGit(repo, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])
  if (merging.ok) throw new Error('sync-merge: the merge is still unresolved; commit it first')

  // Regenerate the patches: the difference between the merged tree and the new
  // official tree is exactly what the plus side contributes.
  const regenerated = []
  for (const patch of patches) {
    const patchPath = join(hooks, patch)
    const files = patchFiles(patchPath)
    if (files.length === 0) {
      regenerated.push({ patch, ok: false, error: 'no files in patch headers' })
      continue
    }
    const diff = git(repo, ['diff', 'official', 'HEAD', '--abbrev=8', '--binary', '--', ...files])
    if (diff.trim() === '') regenerated.push({ patch, ok: false, error: 'empty diff after merge' })
    else {
      writeFileSync(patchPath, diff)
      regenerated.push({ patch, ok: true, lines: diff.split('\n').length - 1 })
    }
  }

  // Put the official tree back from the official commit itself, not from the
  // scratch repository: `upstream/` is committed byte for byte, and the
  // scratch repo only ever computes the patches, so it must not decide which
  // bytes end up committed.
  const officialTreeId = git(mirror, ['rev-parse', `${newSha}^{tree}`]).trim()
  extract(target, mirror, newSha)

  writeBase(root, newSha, officialTreeId)
  return regenerated
}

/**
 * Copy the new official tree into the staging directory the caller validated.
 * @param {string} treeDir - Destination directory.
 * @param {string} mirror - Bare mirror of the official repository.
 * @param {string} sha - Official commit.
 */
export function stageNew(treeDir, mirror, sha) {
  extract(treeDir, mirror, sha)
}
