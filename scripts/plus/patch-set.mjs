/**
 * The patch-set engine.
 *
 * A *patch set* is the set of `.patch` files under one directory. It is the
 * only place where a plus change inside `upstream/` is allowed to live:
 * `upstream/` itself is the untouched official tree, and every build applies
 * the patch set on top of it.
 *
 * This module owns the four primitives every other script needs:
 *
 *   1. what a patch set is (which files, in which order),
 *   2. how to replay it onto a tree,
 *   3. how to materialize an official tree,
 *   4. how to compare two trees exactly.
 *
 * The comparison is done with git tree ids, not with a file-by-file diff: a
 * tree id is the hash of (mode, name, content) for every entry, so two trees
 * with the same tree id are byte-identical by construction — including file
 * modes and symlink targets, which a plain `diff -r` would miss.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Patch-set directories, relative to the repository root.
 *
 * `desktop` is the set this repository ships today. `mobile` is reserved for
 * the mobile client: it gets its own directory so the two sets can never
 * share a file, and so a mobile patch can never leak into a desktop build.
 */
export const PATCH_SETS = {
  desktop: 'scripts/plus/hooks',
  mobile: 'scripts/plus/hooks-mobile',
}

/** Run git in one directory; throws with trimmed stderr for the caller. */
function git(cwd, argv, options = {}) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024, ...options })
}

/**
 * The absolute directory holding one patch set.
 * @param {string} root - Repository root.
 * @param {string} name - Patch-set name (a key of PATCH_SETS).
 * @returns {string} Absolute directory path.
 */
export function patchSetDir(root, name) {
  const relative = PATCH_SETS[name]
  if (relative === undefined) throw new Error(`patch-set: unknown patch set ${name}`)
  return join(resolve(root), relative)
}

/**
 * Patch files in application order.
 * @param {string} hooks - Patch-set directory.
 * @returns {string[]} Patch file names, sorted.
 */
export function listPatches(hooks) {
  return existsSync(hooks)
    ? readdirSync(hooks).filter(name => name.endsWith('.patch')).sort()
    : []
}

/**
 * Files one patch touches, taken from its `diff --git` headers (repo-relative).
 * @param {string} patchPath - Absolute patch path.
 * @returns {string[]} Repo-relative paths.
 */
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
 * Absolute paths of every patch in a patch set, in application order.
 * @param {string} root - Repository root.
 * @param {string} name - Patch-set name.
 * @returns {string[]} Absolute patch paths.
 */
export function patchPaths(root, name) {
  const dir = patchSetDir(root, name)
  return listPatches(dir).map(name => join(dir, name))
}

/**
 * Apply a patch set to the tree in `cwd`.
 *
 * `cwd` does not have to be a git repository: `git apply` works on a plain
 * directory, and the patch paths (`a/upstream/...`) resolve against it. That
 * is what lets the caller apply a patch set to a scratch copy of the tree
 * without touching the real one.
 *
 * @param {object} options - Working directory, patch paths, optional path filter.
 * @param {string} options.cwd - Directory the patch paths are relative to.
 * @param {string[]} options.patches - Absolute patch file paths, in order.
 * @param {string[]} [options.include] - Only apply hunks for these path patterns.
 * @param {boolean} [options.reverse] - Undo the patch instead of applying it.
 */
export function applyPatches({ cwd, patches, include, reverse }) {
  const rows = []
  for (const patch of patches) {
    const argv = ['apply', '--whitespace=nowarn']
    if (reverse) argv.push('--reverse')
    for (const pattern of include ?? []) argv.push(`--include=${pattern}`)
    argv.push(patch)
    try {
      git(cwd, argv)
      rows.push({ patch, ok: true })
    } catch (error) {
      rows.push({ patch, ok: false, error: `${(error.stderr ?? '').toString().trim() || error.message}`.split('\n')[0] })
    }
  }
  return rows
}

/**
 * Read files of `upstream/` as the patch set leaves them.
 *
 * The committed tree is the official baseline, so the patched content is the
 * baseline with the patch set replayed onto it. Computing it here — instead of
 * reading the working tree — keeps the answer the same whether or not the
 * patches happen to be applied on disk right now.
 *
 * @param {object} options - Repository root, patch-set name, and file paths.
 * @param {string} options.root - Repository root.
 * @param {string} options.set - Patch-set name.
 * @param {string[]} options.paths - Repository-relative paths under `upstream/`.
 * @returns {Map<string, string>} File contents by path.
 */
export function readPatchedFiles({ root, set = 'desktop', paths }) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-patched-files-'))
  try {
    for (const path of paths) {
      const destination = join(work, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, git(root, ['show', `HEAD:${path}`]))
    }
    const rows = applyPatches({ cwd: work, patches: patchPaths(root, set), include: paths })
    const failed = rows.filter(row => !row.ok)
    if (failed.length > 0) {
      throw new Error(`patch-set: ${failed.map(row => `${row.patch} (${row.error})`).join('; ')}`)
    }
    const contents = new Map()
    for (const path of paths) contents.set(path, readFileSync(join(work, path), 'utf8'))
    return contents
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Materialize a git tree (a commit, a tree object, `HEAD:upstream`, ...) into
 * a directory.
 * @param {object} options - Repository, tree-ish, and destination.
 * @param {string} options.repo - Git repository to read from.
 * @param {string} options.treeish - Tree-ish expression.
 * @param {string} options.dest - Destination directory (created if absent).
 */
export function materializeTree({ repo, treeish, dest }) {
  execFileSync('bash', ['-c', `git -C "${repo}" archive "${treeish}" | tar -x -C "${dest}"`], { stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * The git tree id of a directory, computed without copying it.
 *
 * The directory is used as the work tree of a throwaway repository, so the
 * answer depends on nothing but the files themselves: `.gitignore` rules are
 * overridden with `-f` (the tree is what it is), and `.gitattributes` still
 * applies (the same normalization the official repository uses).
 *
 * @param {string} dir - Directory to hash.
 * @returns {string} Tree id.
 */
export function treeIdOfDirectory(dir) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-tree-id-'))
  try {
    const gitDir = join(work, '.git')
    execFileSync('git', ['init', '--quiet', '--bare', gitDir], { stdio: ['ignore', 'pipe', 'pipe'] })
    git(work, ['--git-dir', gitDir, '--work-tree', dir, 'add', '-f', '-A', '.'])
    return git(work, ['--git-dir', gitDir, 'write-tree']).trim()
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Compare two trees file by file.
 *
 * Reports the paths that exist only on the left, only on the right, and the
 * paths whose content (or symlink target, or file kind) differs.
 *
 * @param {string} left - Left tree directory.
 * @param {string} right - Right tree directory.
 * @returns {{onlyLeft: string[], onlyRight: string[], changed: string[]}} Differences.
 */
export function diffTrees(left, right) {
  const leftEntries = collectTree(left)
  const rightEntries = collectTree(right)
  const onlyLeft = []
  const onlyRight = []
  const changed = []
  for (const path of leftEntries.keys()) {
    if (!rightEntries.has(path)) onlyLeft.push(path)
    else if (!sameEntry(leftEntries.get(path), rightEntries.get(path))) changed.push(path)
  }
  for (const path of rightEntries.keys()) if (!leftEntries.has(path)) onlyRight.push(path)
  onlyLeft.sort()
  onlyRight.sort()
  changed.sort()
  return { onlyLeft, onlyRight, changed }
}

/**
 * Every file in a tree, mapped to a comparable description of it.
 * @param {string} dir - Tree directory.
 * @returns {Map<string, {kind: string, content: Buffer|null, target: string|null}>} Entries by relative path.
 */
function collectTree(dir) {
  const entries = new Map()
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name)
      const relative = prefix === '' ? name : `${prefix}/${name}`
      const stats = lstatSync(absolute)
      if (stats.isSymbolicLink()) {
        entries.set(relative, { kind: 'link', content: null, target: readlinkSync(absolute) })
      } else if (stats.isDirectory()) {
        walk(absolute, relative)
      } else {
        entries.set(relative, { kind: 'file', content: readFileSync(absolute), target: null })
      }
    }
  }
  walk(dir, '')
  return entries
}

/**
 * Whether two tree entries are the same file.
 * @param {{kind: string, content: Buffer|null, target: string|null}} left - Left entry.
 * @param {{kind: string, content: Buffer|null, target: string|null}} right - Right entry.
 * @returns {boolean} True when the entries are identical.
 */
function sameEntry(left, right) {
  if (left.kind !== right.kind) return false
  if (left.kind === 'link') return left.target === right.target
  return left.content.equals(right.content)
}
