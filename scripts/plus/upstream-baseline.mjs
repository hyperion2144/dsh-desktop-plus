/**
 * The official baseline of `upstream/`.
 *
 * Two facts pin the baseline, and they are stored side by side:
 *
 *   `.plus/upstream-base`  the official commit the tree was taken from,
 *   `.plus/upstream-tree`  the git tree id of that commit's tree.
 *
 * The tree id is what makes the "upstream/ is the untouched official tree"
 * rule checkable without the network: `git rev-parse HEAD:upstream` is a
 * hash over (mode, name, content) of every entry, so it changes when a file
 * is edited, added, removed, or has its mode or symlink target changed.
 * Comparing tree ids is therefore an exact byte-level comparison — and it
 * costs one git command instead of hashing twenty thousand files by hand.
 *
 * The official repository is never an ancestor of our history, so the commit
 * itself lives in a separate mirror (`.plus/mirror`, never committed).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Commit of the official repository `upstream/` was vendored from. */
export const BASE_FILE = '.plus/upstream-base'
/** Git tree id of the official tree `upstream/` must equal. */
export const TREE_FILE = '.plus/upstream-tree'
/** Local mirror of the official repository (never committed). */
export const MIRROR_DIR = '.plus/mirror'

/**
 * Run git in the repository and return stdout.
 * @param {string} cwd - Working directory.
 * @param {string[]} argv - Git arguments.
 * @returns {string} Stdout.
 */
export function git(cwd, argv) {
  return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
}

/**
 * The recorded official commit.
 * @param {string} root - Repository root.
 * @returns {string} Commit SHA, or an empty string when nothing is recorded.
 */
export function readBaseSha(root) {
  const path = join(resolve(root), BASE_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

/**
 * The recorded official tree id.
 * @param {string} root - Repository root.
 * @returns {string} Tree id, or an empty string when nothing is recorded.
 */
export function readBaseTree(root) {
  const path = join(resolve(root), TREE_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

/**
 * Record a new official baseline.
 * @param {string} root - Repository root.
 * @param {string} sha - Official commit SHA.
 * @param {string} tree - Official tree id.
 */
export function writeBase(root, sha, tree) {
  const base = resolve(root)
  mkdirSync(join(base, '.plus'), { recursive: true })
  writeFileSync(join(base, BASE_FILE), `${sha}\n`)
  writeFileSync(join(base, TREE_FILE), `${tree}\n`)
}

/**
 * The tree id of the committed `upstream/` directory.
 * @param {string} root - Repository root.
 * @returns {string} Tree id, or an empty string when `upstream/` is not committed.
 */
export function committedUpstreamTree(root) {
  try {
    return git(resolve(root), ['rev-parse', 'HEAD:upstream']).trim()
  } catch {
    return ''
  }
}

/**
 * The tree id of the official commit, read from the local mirror.
 * @param {string} root - Repository root.
 * @param {string} sha - Official commit SHA.
 * @returns {string} Tree id, or an empty string when the mirror cannot answer.
 */
export function officialTree(root, sha) {
  const mirror = join(resolve(root), MIRROR_DIR)
  if (!existsSync(join(mirror, 'HEAD')) || sha === '') return ''
  try {
    return git(mirror, ['rev-parse', `${sha}^{tree}`]).trim()
  } catch {
    return ''
  }
}

/**
 * Whether the working tree under `upstream/` matches the committed tree.
 * @param {string} root - Repository root.
 * @returns {string[]} Status lines; empty when the tree is untouched.
 */
export function upstreamStatus(root) {
  return git(resolve(root), ['status', '--porcelain', '--', 'upstream'])
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
}
