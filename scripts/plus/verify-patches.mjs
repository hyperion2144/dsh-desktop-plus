#!/usr/bin/env node
/**
 * The patch-discipline gate.
 *
 * Two facts have to hold at the same time, and they are the whole contract
 * between `upstream/` and the patch set:
 *
 *   1. `upstream/` is the untouched official tree — not "close to it", not
 *      "the official tree plus our patches": the official tree, byte for
 *      byte.
 *   2. The desktop patch set still replays cleanly onto that tree, so a build
 *      can put the plus changes back.
 *
 * (1) is checked with git tree ids. `git rev-parse HEAD:upstream` hashes the
 * mode, the name and the content of every entry, so it changes when a file is
 * edited, added or removed, when an executable bit flips, or when a symlink
 * points somewhere else. The tree id recorded in `.plus/upstream-tree` is the
 * official tree's id, so comparing the two is an exact comparison of the two
 * trees — and it costs one git command instead of walking twenty thousand
 * files.
 *
 * (2) is checked by replaying the patch set onto a scratch copy of the
 * baseline: a patch that no longer applies is a patch that has gone stale,
 * and the build would silently lose a plus change.
 *
 * When the local mirror of the official repository is present, the recorded
 * tree id is cross-checked against the official commit itself. `--strict`
 * makes that cross-check mandatory instead of a bonus.
 *
 * Usage:
 *   node scripts/plus/verify-patches.mjs [--strict]
 *
 * Exit codes: 0 = both gates pass, 1 = a gate failed, 2 = setup problem.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyPatches, materializeTree, patchPaths } from './patch-set.mjs'
import { committedUpstreamTree, git, officialTree, readBaseSha, readBaseTree, upstreamStatus } from './upstream-baseline.mjs'

const ROOT = resolve(process.cwd())
const strict = process.argv.includes('--strict')

const fail = (message) => {
  console.error(`verify-patches: ${message}`)
  process.exit(1)
}

const setup = (message) => {
  console.error(`verify-patches: ${message}`)
  process.exit(2)
}

const baseSha = readBaseSha(ROOT)
const baseTree = readBaseTree(ROOT)
if (baseSha === '') setup('no .plus/upstream-base')
if (baseTree === '') setup('no .plus/upstream-tree')

const patches = patchPaths(ROOT, 'desktop')
if (patches.length === 0) setup('no patches in scripts/plus/hooks')

// 1. The committed tree is the official tree.
const committed = committedUpstreamTree(ROOT)
if (committed === '') setup('upstream/ is not committed')
if (committed !== baseTree) {
  console.error(`verify-patches: upstream/ is not the official tree`)
  console.error(`verify-patches: committed tree id ${committed}`)
  console.error(`verify-patches: official  tree id ${baseTree}`)
  console.error('verify-patches: a plus change reached upstream/ instead of the patch set')
  process.exit(1)
}

// 2. The working tree matches the committed tree.
const status = upstreamStatus(ROOT)
if (status.length > 0) {
  for (const line of status.slice(0, 20)) console.error(`verify-patches: upstream/ differs from the commit: ${line}`)
  fail(`${status.length} path(s) under upstream/ differ from the committed official tree`)
}

// 3. The patch set replays onto the baseline.
const work = mkdtempSync(join(tmpdir(), 'dsh-verify-patches-'))
try {
  const baseline = join(work, 'upstream')
  mkdirSync(baseline, { recursive: true })
  materializeTree({ repo: ROOT, treeish: 'HEAD:upstream', dest: baseline })
  const rows = applyPatches({ cwd: work, patches })
  const failed = rows.filter(row => !row.ok)
  if (failed.length > 0) {
    for (const row of failed) console.error(`verify-patches: ${row.patch} does not apply: ${row.error}`)
    fail(`${failed.length} of ${rows.length} patches do not apply to ${baseSha.slice(0, 10)}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

// 4. The recorded tree id is the official commit's tree id.
const official = officialTree(ROOT, baseSha)
if (official === '') {
  const message = 'no local mirror of the official repository: skipped the cross-check against the official commit'
  if (strict) setup(`${message} (run "pnpm run sync:upstream" to create .plus/mirror)`)
  console.log(`verify-patches: ${message}`)
} else if (official !== baseTree) {
  console.error(`verify-patches: the recorded baseline does not match the official commit`)
  console.error(`verify-patches: recorded tree id ${baseTree}`)
  console.error(`verify-patches: official  tree id ${official}`)
  process.exit(1)
}

console.log(`verify-patches: upstream/ is the official tree at ${baseSha.slice(0, 10)} (${baseTree.slice(0, 10)}); ${patches.length} patches replay cleanly`)
