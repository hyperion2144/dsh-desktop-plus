#!/usr/bin/env node
/**
 * Build-time patch application for `upstream/`.
 *
 * `upstream/` is committed as the untouched official tree. The plus changes
 * live in a patch set (`scripts/plus/hooks/*.patch`), and this script is how
 * a build gets them back:
 *
 *   apply    replay the patch set onto `upstream/` (what a build does),
 *   revert   restore `upstream/` to the official tree,
 *   extract  re-record the patch set from the current `upstream/` tree and
 *            restore the tree — the "commit my change as a patch" step.
 *
 * The three modes are deliberately explicit: `upstream/` is clean in git, so
 * every excursion from it has to be announced, and every way back is one
 * command.
 *
 * Usage:
 *   node scripts/plus/apply-patches.mjs [apply|revert|extract] [--set <name>]
 *                                              [--adopt <patch>=<path,...>]
 */

import { resolve } from 'node:path'
import { applyPatches, patchPaths, patchSetDir } from './patch-set.mjs'
import { recordPatches, restoreBaseline } from './patch-recorder.mjs'
import { upstreamStatus } from './upstream-baseline.mjs'

const ROOT = resolve(process.cwd())
const MODES = new Set(['apply', 'revert', 'extract'])

const args = process.argv.slice(2)
const mode = args.find(argument => MODES.has(argument)) ?? 'apply'
const setName = valueOf('--set') ?? 'desktop'
const adopt = valueOf('--adopt')

/**
 * Read the value that follows a flag.
 * @param {string} name - Flag name.
 * @returns {string|undefined} The value, when present.
 */
function valueOf(name) {
  const at = args.indexOf(name)
  return at === -1 ? undefined : (args[at + 1] ?? true)
}

/** Abort with a message; the message is printed by the top-level handler. */
const fail = (message) => {
  throw new Error(message)
}

const hooks = patchSetDir(ROOT, setName)
const patches = patchPaths(ROOT, setName)
// An empty set is extractable when --adopt names the set's first patch;
// the patch-consumption modes have nothing to do without one.
if (patches.length === 0 && adopt === undefined) fail(`no patches in ${hooks}`)



/**
 * Replay the patch set onto `upstream/`.
 */
function apply() {
  if (upstreamStatus(ROOT).length === 0) {
    const rows = applyPatches({ cwd: ROOT, patches })
    const failed = rows.filter(row => !row.ok)
    if (failed.length > 0) {
      for (const row of failed) console.error(`apply-patches: ${row.patch} does not apply: ${row.error}`)
      fail(`${failed.length} of ${rows.length} patches did not apply`)
    }
    console.log(`apply-patches: applied ${rows.length} patches to upstream/`)
    return
  }
  // The tree is not clean. That is fine when it is exactly the patched state:
  // every patch then applies in reverse.
  const reverse = applyPatches({ cwd: ROOT, patches, reverse: true })
  if (reverse.every(row => row.ok)) {
    console.log(`apply-patches: upstream/ already carries the ${patches.length} patches`)
    return
  }
  fail('upstream/ carries changes that are not the patch set; run "pnpm run patches:revert" first')
}

/**
 * Restore `upstream/` to the official tree.
 */
function revert() {
  restoreBaseline({ root: ROOT, set: setName })
  console.log('apply-patches: upstream/ restored to the official tree')
}

/**
 * Re-record the patch set from the current `upstream/` tree.
 *
 * The baseline is the committed tree (the official tree), the live tree is
 * what is on disk right now, and the difference between them is what the
 * patch set must express. Every patch keeps the paths it already owns; a
 * path nobody owns is an error, because silently dropping it would lose the
 * change.
 */
function extract() {
  const rewritten = recordPatches({ root: ROOT, set: setName, adopt })
  for (const row of rewritten) {
    console.log(`apply-patches: ${row.ok ? 'rewrote' : 'FAILED'} ${row.patch}${row.ok ? ` (${row.lines} lines)` : `: ${row.error}`}`)
  }
  if (!rewritten.every(row => row.ok)) fail('the patch set could not be re-recorded')
  restoreBaseline({ root: ROOT, set: setName })
  console.log('apply-patches: patch set re-recorded; upstream/ restored to the official tree')
}

try {
  if (mode === 'apply') apply()
  else if (mode === 'revert') revert()
  else extract()
} catch (error) {
  console.error(`apply-patches: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
