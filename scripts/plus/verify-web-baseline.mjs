#!/usr/bin/env node
/**
 * The variant baseline: an empty patch set must build the official dist.
 *
 * The mobile mechanism promises that a variant is the official tree plus one
 * patch set, and that the patch set is the only difference. This script proves
 * it on the artifact itself:
 *
 *   1. build the official variant — the official tree, no patch set,
 *   2. build the variant under test — the official tree plus its patch set,
 *   3. compare the two dists file by file and byte by byte.
 *
 * With an empty patch set the two dists must be identical. The comparison
 * also reports the *content* difference, so a build that only renames its
 * files (rollup names a chunk after a hash of its content) is told apart
 * from a build that changed something.
 *
 * The script also checks that the builds left the repository alone: the
 * official tree and the desktop patch set must be exactly as they were.
 *
 * Usage:
 *   node scripts/plus/verify-web-baseline.mjs [--set <name>] [--reference <dir>]
 *                                             [--expect-identical]
 *
 * `--reference` reuses a previously built official dist instead of building
 * it again. `--expect-identical` demands identical dists even when the patch
 * set is not empty.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { patchPaths } from './patch-set.mjs'
import { git, upstreamStatus } from './upstream-baseline.mjs'
import { compareTrees, hashTree, isIdentical } from './web-variant/dist-compare.mjs'
import { buildVariant } from './web-variant/variant-run.mjs'

const ROOT = resolve(process.cwd())
const args = process.argv.slice(2)

/**
 * Read the value that follows a flag.
 * @param {string} name - Flag name.
 * @returns {string|undefined} The value, when present.
 */
function valueOf(name) {
  const at = args.indexOf(name)
  if (at === -1) return undefined
  const value = args[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

const set = valueOf('--set') ?? 'mobile'
const reference = valueOf('--reference')
const expectIdentical = args.includes('--expect-identical')

/**
 * Compare the official dist with the variant dist and report the verdict.
 * @param {string} work - Scratch directory for the two dists.
 * @throws {Error} When the baseline does not hold.
 */
function verifyBaseline(work) {
  const patches = patchPaths(ROOT, set)
  const upstreamBefore = upstreamStatus(ROOT).join('\n')
  console.log(`verify-web-baseline: the ${set} patch set holds ${patches.length} patch file(s)`)

  let official
  if (reference === undefined) {
    console.log('verify-web-baseline: building the official variant')
    official = buildVariant({ root: ROOT, out: join(work, 'official') })
    console.log(`verify-web-baseline: official variant tree id ${official.treeId}`)
  } else {
    console.log(`verify-web-baseline: reusing the official dist at ${reference}`)
    official = { out: resolve(reference), treeId: '' }
  }

  console.log(`verify-web-baseline: building the ${set} variant`)
  const variant = buildVariant({ root: ROOT, set, out: join(work, set) })
  console.log(`verify-web-baseline: ${set} variant tree id    ${variant.treeId}`)

  const difference = compareTrees(official.out, variant.out)
  const officialFiles = hashTree(official.out).size
  const variantFiles = hashTree(variant.out).size
  console.log(`verify-web-baseline: official dist ${officialFiles} file(s), ${set} dist ${variantFiles} file(s)`)

  if (isIdentical(difference)) {
    console.log(`verify-web-baseline: the two dists are byte-identical (${officialFiles} file(s))`)
  } else {
    for (const path of difference.onlyLeft.slice(0, 20)) console.error(`verify-web-baseline: only in the official dist: ${path}`)
    for (const path of difference.onlyRight.slice(0, 20)) console.error(`verify-web-baseline: only in the ${set} dist: ${path}`)
    for (const path of difference.changed.slice(0, 20)) console.error(`verify-web-baseline: differs: ${path}`)
    console.error(`verify-web-baseline: ${difference.changed.length} changed, ${difference.onlyLeft.length} only-official, ${difference.onlyRight.length} only-${set}`)
    if (difference.contentOnlyLeft.length === 0 && difference.contentOnlyRight.length === 0) {
      console.error('verify-web-baseline: the file contents are the same; only the file names differ')
    }
  }

  // The builds must not have touched the repository: the official tree keeps
  // its official bytes, and the desktop patch set keeps its files.
  const upstreamAfter = upstreamStatus(ROOT).join('\n')
  if (upstreamAfter !== upstreamBefore) {
    console.error(`verify-web-baseline: upstream/ differs: ${upstreamAfter}`)
    throw new Error('the variant build changed upstream/')
  }
  const desktopDirty = git(ROOT, ['status', '--porcelain', '--', 'scripts/plus/hooks']).trim()
  if (desktopDirty !== '') {
    console.error(`verify-web-baseline: the desktop patch set differs: ${desktopDirty}`)
    throw new Error('the variant build touched the desktop patch set')
  }
  console.log('verify-web-baseline: upstream/ and the desktop patch set are untouched')

  if (isIdentical(difference)) {
    if (official.treeId !== '' && official.treeId !== variant.treeId) {
      throw new Error(`the ${set} variant tree differs from the official tree although their dists match`)
    }
    console.log(`verify-web-baseline: the ${set} variant is the official build, byte for byte`)
    return
  }
  if (patches.length === 0 || expectIdentical) {
    throw new Error(`the ${set} variant dist differs from the official dist`)
  }
  console.log(`verify-web-baseline: the ${set} patch set changed the dist, as expected`)
}

const work = mkdtempSync(join(tmpdir(), 'dsh-web-baseline-'))
let failure
try {
  verifyBaseline(work)
} catch (error) {
  failure = error
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (failure !== undefined) {
  console.error(`verify-web-baseline: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exit(1)
}
