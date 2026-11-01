#!/usr/bin/env node
/**
 * The two patch sets stay separate.
 *
 * Iron rule 3: a patch file belongs to exactly one set, and a path belongs to
 * at most one patch. This script checks both, and that every set still
 * applies to the official tree:
 *
 *   1. no path is owned by a patch of two different sets,
 *   2. no path is owned by two patches of the same set,
 *   3. every patch of every set applies to the committed official tree.
 *
 * (1) is what keeps a desktop change out of a mobile build and the other way
 * round: the two sets are replayed onto separate trees, so a shared path
 * would make one build inherit the other's change.
 *
 * Usage:
 *   node scripts/plus/verify-patch-sets.mjs
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyPatches, materializeTree, patchFiles, patchPaths, PATCH_SETS } from './patch-set.mjs'

const ROOT = resolve(process.cwd())
const sets = Object.keys(PATCH_SETS)

/**
 * The paths one patch set owns, and the patch that owns each.
 * @param {string} set - Patch-set name.
 * @returns {Map<string, string>} Path -> patch file name.
 */
function ownersOf(set) {
  const owners = new Map()
  for (const patch of patchPaths(ROOT, set)) {
    const name = patch.slice(patch.lastIndexOf('/') + 1)
    for (const path of patchFiles(patch)) {
      if (!owners.has(path)) owners.set(path, name)
    }
  }
  return owners
}

/**
 * Check that no path is owned twice, and that every set applies.
 * @throws {Error} When a set overlaps another one, or does not apply.
 */
function verifySets() {
  const owners = new Map(sets.map(set => [set, ownersOf(set)]))
  for (const [set, paths] of owners) {
    console.log(`verify-patch-sets: the ${set} set owns ${paths.size} path(s)`)
  }

  for (const set of sets) {
    const seen = new Map()
    for (const patch of patchPaths(ROOT, set)) {
      const name = patch.slice(patch.lastIndexOf('/') + 1)
      for (const path of patchFiles(patch)) {
        const previous = seen.get(path)
        if (previous !== undefined) {
          throw new Error(`${path} is owned by two ${set} patches (${previous} and ${name})`)
        }
        seen.set(path, name)
      }
    }
  }
  for (let left = 0; left < sets.length; left += 1) {
    for (let right = left + 1; right < sets.length; right += 1) {
      for (const path of owners.get(sets[left]).keys()) {
        if (owners.get(sets[right]).has(path)) {
          throw new Error(`${path} is owned by both the ${sets[left]} and the ${sets[right]} set`)
        }
      }
    }
  }

  const work = mkdtempSync(join(tmpdir(), 'dsh-verify-patch-sets-'))
  try {
    for (const set of sets) {
      const tree = join(work, set, 'upstream')
      mkdirSync(tree, { recursive: true })
      materializeTree({ repo: ROOT, treeish: 'HEAD:upstream', dest: tree })
      const rows = applyPatches({ cwd: join(work, set), patches: patchPaths(ROOT, set) })
      const failed = rows.filter(row => !row.ok)
      if (failed.length > 0) {
        for (const row of failed) console.error(`verify-patch-sets: ${row.patch} does not apply: ${row.error}`)
        throw new Error(`${failed.length} of ${rows.length} ${set} patch(es) do not apply to the official tree`)
      }
      console.log(`verify-patch-sets: the ${set} set applies cleanly to the official tree`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

let failure
try {
  verifySets()
} catch (error) {
  failure = error
}
if (failure !== undefined) {
  console.error(`verify-patch-sets: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exit(1)
}
console.log('verify-patch-sets: the patch sets are separate')
