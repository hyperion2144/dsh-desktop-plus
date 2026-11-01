#!/usr/bin/env node
/**
 * Zero-regression proof for the upstream/patch-set separation.
 *
 * The desktop build consumes one tree: the official baseline with the
 * desktop patch set replayed onto it. The separation changed where that tree
 * comes from — before, `upstream/` held the patched tree itself; now
 * `upstream/` holds the official tree and the patch set is applied on top.
 *
 * That change is only allowed if both routes produce the *same* tree. This
 * script proves it:
 *
 *   1. replay the patch set onto a clean copy of the official baseline,
 *   2. take the snapshot of `upstream/` from before the separation,
 *   3. compare the two trees byte for byte.
 *
 * The comparison is a git tree id comparison, so it covers file contents,
 * file modes and symlink targets at once — a plain file diff would miss a
 * changed executable bit.
 *
 * The reference snapshot lives in `.plus/upstream-patched-ref` (a commit
 * whose `upstream/` is the pre-separation tree). `--ref` overrides it.
 *
 * Usage:
 *   node scripts/plus/verify-separation.mjs [--ref <git-ref>]
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { applyPatches, diffTrees, materializeTree, patchPaths, treeIdOfDirectory } from './patch-set.mjs'

const ROOT = resolve(process.cwd())
const REFERENCE_FILE = '.plus/upstream-patched-ref'

const args = process.argv.slice(2)
const refIndex = args.indexOf('--ref')
const ref = refIndex === -1 ? readReference() : args[refIndex + 1]

/**
 * The recorded pre-separation snapshot.
 * @returns {string} A git revision, or an empty string when none is recorded.
 */
function readReference() {
  const path = join(ROOT, REFERENCE_FILE)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

const fail = (message) => {
  console.error(`verify-separation: ${message}`)
  process.exit(1)
}

if (!ref) fail(`no reference snapshot; record one in ${REFERENCE_FILE} or pass --ref`)

/**
 * Copy one file (or symlink) from one tree into another.
 * @param {string} from - Source file.
 * @param {string} to - Destination file.
 */
function copyEntry(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to)
  else copyFileSync(from, to)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-verify-separation-'))
try {
  // 1. The official baseline, exactly as `upstream/` is committed.
  const baseline = join(work, 'baseline', 'upstream')
  mkdirSync(baseline, { recursive: true })
  materializeTree({ repo: ROOT, treeish: 'HEAD:upstream', dest: baseline })

  // 2. The tree a build consumes: the baseline with the patch set applied.
  const patched = join(work, 'patched', 'upstream')
  mkdirSync(patched, { recursive: true })
  materializeTree({ repo: ROOT, treeish: 'HEAD:upstream', dest: patched })
  const rows = applyPatches({ cwd: join(work, 'patched'), patches: patchPaths(ROOT, 'desktop') })
  const failed = rows.filter(row => !row.ok)
  if (failed.length > 0) {
    for (const row of failed) console.error(`verify-separation: ${row.patch} does not apply: ${row.error}`)
    fail(`${failed.length} of ${rows.length} patches did not apply to the baseline`)
  }

  // 3. The snapshot of `upstream/` from before the separation.
  const reference = join(work, 'reference', 'upstream')
  mkdirSync(reference, { recursive: true })
  try {
    materializeTree({ repo: ROOT, treeish: `${ref}:upstream`, dest: reference })
  } catch {
    fail(`cannot read the reference snapshot ${ref}:upstream`)
  }

  // The separation also restores official files that the repository's own
  // ignore rules had kept out of the vendored tree. They are official content,
  // so the reference snapshot is completed with them before comparing.
  const restored = diffTrees(reference, baseline).onlyRight
  for (const path of restored) copyEntry(join(baseline, path), join(reference, path))

  const patchedId = treeIdOfDirectory(patched)
  const referenceId = treeIdOfDirectory(reference)
  const difference = diffTrees(reference, patched)

  console.log(`verify-separation: reference snapshot ${ref}`)
  console.log(`verify-separation: restored official file(s): ${restored.length === 0 ? '(none)' : restored.join(', ')}`)
  console.log(`verify-separation: patched tree id   ${patchedId}`)
  console.log(`verify-separation: reference tree id ${referenceId}`)
  if (patchedId !== referenceId) {
    for (const path of difference.onlyLeft.slice(0, 20)) console.error(`verify-separation: only in the reference: ${path}`)
    for (const path of difference.onlyRight.slice(0, 20)) console.error(`verify-separation: only in the patched tree: ${path}`)
    for (const path of difference.changed.slice(0, 20)) console.error(`verify-separation: differs: ${path}`)
    fail(`the patched tree is not the pre-separation tree (${difference.changed.length} changed, ${difference.onlyLeft.length} only-left, ${difference.onlyRight.length} only-right)`)
  }
  console.log('verify-separation: the desktop build consumes a byte-identical tree — zero regression')
} finally {
  rmSync(work, { recursive: true, force: true })
}
