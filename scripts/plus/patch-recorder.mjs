/**
 * Recording the working tree into the patch set.
 *
 * The discipline this module serves: `upstream/` is committed as the official
 * tree, so a change to it has to become a patch before it can be committed.
 * This is that step — take the tree as it is on disk, write the difference
 * against the official baseline into the patch files, and put the official
 * tree back.
 *
 * The baseline is the *committed* tree, not the working tree: the committed
 * tree is the official tree by definition, so the difference between the two
 * is exactly the plus change that has to be recorded.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { patchFiles, patchPaths, patchSetDir } from './patch-set.mjs'
import { git } from './upstream-baseline.mjs'

/**
 * Every path the patch set owns, relative to the repository root.
 * @param {string} root - Repository root.
 * @param {string} set - Patch-set name.
 * @returns {string[]} Repository-relative paths.
 */
export function ownedPaths(root, set) {
  return [...new Set(patchPaths(root, set).flatMap(patch => patchFiles(patch)))]
}

/**
 * Paths the committed tree knows about.
 * @param {string} root - Repository root.
 * @returns {Set<string>} Repository-relative paths under `upstream/`.
 */
function committedPaths(root) {
  const listed = git(root, ['ls-tree', '-r', '--name-only', 'HEAD', 'upstream'])
  return new Set(listed.split('\n').map(line => line.trim()).filter(line => line !== ''))
}

/**
 * Restore `upstream/` to the committed official tree.
 *
 * Tracked files come back from `git checkout`; the files the patch set adds
 * are not in the commit, so they are removed explicitly instead of with a
 * blanket `git clean` that could take unrelated scratch files with it.
 *
 * @param {object} options - Repository root and patch-set name.
 * @param {string} options.root - Repository root.
 * @param {string} options.set - Patch-set name.
 */
export function restoreBaseline({ root, set }) {
  const known = committedPaths(root)
  for (const path of ownedPaths(root, set)) {
    if (known.has(path)) continue
    rmSync(join(root, path), { force: true })
  }
  git(root, ['checkout', 'HEAD', '--', 'upstream'])
}

/**
 * Re-record the patch set from the current `upstream/` tree.
 *
 * Every patch keeps the paths it already owns; a path nobody owns is an
 * error, because silently dropping it would lose the change. `--adopt` names
 * the patch that takes such a path over.
 *
 * @param {object} options - Repository root, patch-set name, and adoption.
 * @param {string} options.root - Repository root.
 * @param {string} options.set - Patch-set name.
 * @param {string} [options.adopt] - `<patch>=<path[,path...]>`.
 * @returns {{patch: string, ok: boolean, lines?: number, error?: string}[]} One row per patch.
 */
export function recordPatches({ root, set, adopt }) {
  const hooks = patchSetDir(root, set)
  const patches = patchPaths(root, set)
  const owned = ownedPaths(root, set)
  const work = mkdtempSync(join(tmpdir(), 'dsh-record-patches-'))
  // The scratch repository mirrors the real layout: the tree lives under
  // `upstream/`, so the patch files apply with the paths they carry.
  const gitDir = join(work, '.git')
  /** Run git in the scratch repository. */
  const repo = (cwd, ...argv) => execFileSync('git', ['--git-dir', gitDir, ...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
  try {
    // The baseline commit: the official tree, extracted from our own history.
    const baseline = join(work, 'upstream')
    mkdirSync(baseline, { recursive: true })
    execFileSync('bash', ['-c', `git archive HEAD:upstream | tar -x -C "${baseline}"`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    execFileSync('git', ['init', '--quiet', work], { cwd: work, stdio: ['ignore', 'pipe', 'pipe'] })
    repo(work, 'add', '-f', '-A', 'upstream')
    repo(work, '-c', 'user.name=dsh-record', '-c', 'user.email=record@dsh-desktop-plus.invalid', 'commit', '--quiet', '-m', 'official baseline')

    // The live commit: the tree as it is on disk right now.
    repo(root, '--work-tree', root, 'add', '-A', 'upstream')
    repo(root, '-c', 'user.name=dsh-record', '-c', 'user.email=record@dsh-desktop-plus.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'live tree')

    const changed = repo(root, 'diff', '--name-only', 'HEAD~1', 'HEAD').split('\n').map(line => line.trim()).filter(line => line !== '')
    const owners = new Map(owned.map(path => [path, null]))
    if (changed.length === 0) {
      throw new Error('upstream/ carries no plus changes; apply the patch set first (pnpm run patches:apply)')
    }
    for (const patch of patches) {
      for (const path of patchFiles(patch)) owners.set(path, patch)
    }
    if (typeof adopt === 'string') {
      const separator = adopt.indexOf('=')
      if (separator === -1) throw new Error('--adopt needs <patch>=<path[,path...]>')
      const patch = adopt.slice(0, separator)
      const paths = adopt.slice(separator + 1).split(',').map(path => path.trim()).filter(path => path !== '')
      for (const path of paths) owners.set(path, patch)
    }
    const orphans = changed.filter(path => !owners.has(path))
    if (orphans.length > 0) {
      for (const path of orphans) console.error(`patch-recorder: no patch owns ${path}`)
      throw new Error(`${orphans.length} changed path(s) belong to no patch; name one with --adopt <patch>=<path,...>`)
    }

    const rewritten = []
    for (const patch of patches) {
      const name = basename(patch)
      const paths = patchFiles(patch)
      if (paths.length === 0) continue
      // `--abbrev=8` keeps the recorded blob ids the same length as the ones the
      // official sync wrote, so a re-recorded patch only differs where it must.
      const diff = repo(root, 'diff', 'HEAD~1', 'HEAD', '--abbrev=8', '--binary', '--', ...paths)
      if (diff.trim() === '') {
        rewritten.push({ patch: name, ok: false, error: 'the tree no longer differs from the baseline here' })
        continue
      }
      writeFileSync(join(hooks, name), diff)
      rewritten.push({ patch: name, ok: true, lines: diff.split('\n').length - 1 })
    }
    return rewritten
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Whether the working tree under `upstream/` is the committed official tree.
 * @param {string} root - Repository root.
 * @returns {boolean} True when nothing under `upstream/` differs.
 */
export function upstreamIsClean(root) {
  return !existsSync(join(root, 'upstream')) || git(root, ['status', '--porcelain', '--', 'upstream']).trim() === ''
}
