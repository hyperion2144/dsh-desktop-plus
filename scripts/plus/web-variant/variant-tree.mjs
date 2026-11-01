/**
 * One build variant's source tree.
 *
 * A *variant* is the tree one web build consumes: the official baseline with
 * exactly one patch set replayed onto it. The desktop build consumes
 * `official + desktop`; the mobile build consumes `official + mobile`.
 *
 * The tree lives in a scratch directory, never in `upstream/`:
 *
 *   - `upstream/` is committed as the official tree, and the desktop build
 *     patches it in place. A variant that patched it too would fight the
 *     desktop build over the same files, or inherit its changes.
 *   - The scratch tree is materialized from `HEAD:upstream` — the committed
 *     official tree — so a variant is the same no matter what the working
 *     tree currently holds. `upstream/` therefore stays official-clean by
 *     construction: a variant build never writes to it, so a failed build
 *     has nothing to restore.
 *
 * The tree id is the exact identity of the variant's source: it hashes the
 * mode, the name and the content of every entry, so two variants with the
 * same tree id are byte-identical by construction.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPatches, materializeTree, patchPaths, treeIdOfDirectory } from '../patch-set.mjs'

/**
 * Materialize one variant's tree.
 *
 * @param {object} options - Repository root and patch-set name.
 * @param {string} options.root - Repository root.
 * @param {string} [options.set] - Patch-set name; omitted yields the official tree.
 * @returns {{work: string, tree: string, treeId: string}} The scratch directory, the tree inside it, and its tree id.
 */
export function materializeVariantTree({ root, set }) {
  const work = mkdtempSync(join(tmpdir(), 'dsh-variant-tree-'))
  const tree = join(work, 'upstream')
  mkdirSync(tree, { recursive: true })
  try {
    materializeTree({ repo: root, treeish: 'HEAD:upstream', dest: tree })
    const patches = set === undefined ? [] : patchPaths(root, set)
    const rows = applyPatches({ cwd: work, patches })
    const failed = rows.filter(row => !row.ok)
    if (failed.length > 0) {
      const detail = failed.map(row => `${row.patch} (${row.error})`).join('; ')
      throw new Error(`${failed.length} of ${rows.length} ${set} patch(es) did not apply to the official tree: ${detail}`)
    }
    const treeId = treeIdOfDirectory(tree)
    return { work, tree, treeId }
  } catch (error) {
    rmSync(work, { recursive: true, force: true })
    throw error
  }
}
