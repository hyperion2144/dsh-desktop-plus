#!/usr/bin/env node
/**
 * Replay `scripts/plus/hooks/*.patch` onto the official tree our
 * `.plus/upstream-base` names, then compare the result with the committed
 * `upstream/` tree.
 *
 * This is the gate behind the repository rule that every edit inside
 * `upstream/` is expressed as a patch: a plus file that was committed without
 * being listed in a patch, or a patch that no longer matches the tree, fails
 * here. Restoring a tree from the patch set is the only way to tell.
 *
 * Usage:
 *   node scripts/plus/verify-patches.mjs
 *
 * Exit codes: 0 = patches reproduce the tree, 1 = they do not, 2 = setup
 * problem (missing mirror, unreadable patch, git failure).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { listPatches, stageNew } from './sync-merge.mjs'

const ROOT = resolve(process.cwd())
const MIRROR = join(ROOT, '.plus', 'mirror')
const BASE_FILE = join(ROOT, '.plus', 'upstream-base')
const HOOKS = join(ROOT, 'scripts', 'plus', 'hooks')

/** Run git in one directory and return stdout; exceptions carry stderr. */
const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })

/** Compare one restored entry with the live tree, following the entry kind (file, directory, symlink). */
const sameEntry = (restored, live) => {
  if (!existsSync(live)) return false
  const left = lstatSync(restored)
  const right = lstatSync(live)
  if (left.isSymbolicLink() || right.isSymbolicLink()) {
    return left.isSymbolicLink() && right.isSymbolicLink() && readlinkSync(restored) === readlinkSync(live)
  }
  if (left.isDirectory() || right.isDirectory()) return left.isDirectory() && right.isDirectory()
  return readFileSync(restored).equals(readFileSync(live))
}

const fail = (message) => {
  console.error(`verify-patches: ${message}`)
  process.exit(2)
}

if (!existsSync(BASE_FILE)) fail('no .plus/upstream-base')
const base = readFileSync(BASE_FILE, 'utf8').trim()
if (base === '') fail('.plus/upstream-base is empty')
if (!existsSync(join(MIRROR, 'HEAD'))) fail(`no mirror at ${MIRROR}; run pnpm run sync:upstream first`)

const patches = listPatches(HOOKS)
if (patches.length === 0) fail(`no patches in ${HOOKS}`)

const work = mkdtempSync(join(tmpdir(), 'dsh-verify-patches-'))
try {
  // The patch headers carry the repository-root `upstream/` prefix, so the
  // scratch repository keeps the tree at `upstream/` exactly like the real one.
  stageNew(join(work, 'upstream'), MIRROR, base)
  git(work, ['init', '--quiet'])
  git(work, ['config', 'user.name', 'dsh-verify-patches'])
  git(work, ['config', 'user.email', 'verify@dsh-desktop-plus.invalid'])
  git(work, ['add', '-A'])
  git(work, ['commit', '--quiet', '-m', 'official base'])

  for (const patch of patches) {
    const patchPath = join(HOOKS, patch)
    try {
      git(work, ['apply', '--check', '--whitespace=nowarn', patchPath])
      git(work, ['apply', '--whitespace=nowarn', patchPath])
    } catch (error) {
      const detail = `${(error.stderr ?? '').toString().trim() || error.message}`.split('\n')[0]
      fail(`${patch} does not apply to ${base.slice(0, 10)}: ${detail}`)
    }
  }

  // Every tracked file is source: build outputs and node_modules stay untracked.
  // -z + core.quotepath=false keeps non-ASCII snapshot names intact (no C-quoted output).
  const tracked = git(ROOT, ['-c', 'core.quotepath=false', 'ls-files', '-z', 'upstream'])
    .split('\0')
    .filter(line => line !== '')
  const missing = []
  const changed = []
  for (const path of tracked) {
    const restored = join(work, path)
    const live = join(ROOT, path)
    if (!existsSync(restored)) missing.push(path.slice('upstream/'.length))
    else if (!sameEntry(restored, live)) changed.push(path.slice('upstream/'.length))
  }

  if (missing.length > 0 || changed.length > 0) {
    for (const path of missing.slice(0, 20)) console.error(`verify-patches: not covered by any patch: ${path}`)
    for (const path of changed.slice(0, 20)) console.error(`verify-patches: patch content differs from the tree: ${path}`)
    console.error(`verify-patches: ${missing.length} uncovered, ${changed.length} drifted (run pnpm run sync:upstream --regen after widening the patch)`)
    process.exit(1)
  }
  console.log(`verify-patches: ${patches.length} patches reproduce upstream/ at ${base.slice(0, 10)} (${tracked.length} files)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
