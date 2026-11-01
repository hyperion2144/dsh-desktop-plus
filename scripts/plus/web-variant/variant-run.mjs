/**
 * Running one variant from end to end.
 *
 * The sequence is fixed: materialize, install, build, publish, clean up.
 *
 *   - The materialization reads the committed official tree, so the variant
 *     is the official tree plus one patch set — whatever the working tree
 *     holds is irrelevant.
 *   - The install gives the variant its own dependencies, linked inside the
 *     variant tree.
 *   - The publish step copies the dist out of the scratch tree, so the
 *     result survives the cleanup.
 *   - The cleanup runs even when the build fails, and there is nothing to
 *     restore in `upstream/`: the variant never touched it. The build asserts
 *     that, by comparing the tree's status before and after.
 *
 * The variant shares nothing mutable with the desktop build but the pnpm
 * store, which is content-addressed and concurrency-safe. A desktop build
 * and a variant build can therefore run at the same time.
 */

import { cpSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { git, upstreamStatus } from '../upstream-baseline.mjs'
import { buildVariantWeb } from './variant-build.mjs'
import { installVariantDependencies } from './variant-deps.mjs'
import { materializeVariantTree } from './variant-tree.mjs'

/**
 * Build one variant's web dist and publish it.
 *
 * @param {object} options - Repository root, patch-set name, and output directory.
 * @param {string} options.root - Repository root.
 * @param {string} [options.set] - Patch-set name; omitted builds the official tree.
 * @param {string} options.out - Directory the dist is published to.
 * @param {boolean} [options.keep] - Keep the scratch tree for inspection.
 * @returns {{out: string, treeId: string}} The published directory and the variant's tree id.
 */
export function buildVariant({ root, set, out, keep = false }) {
  const commitHash = git(root, ['rev-parse', 'HEAD']).trim()
  const before = upstreamStatus(root).join('\n')
  const { work, tree, treeId } = materializeVariantTree({ root, set })
  try {
    installVariantDependencies({ tree })
    const dist = buildVariantWeb({ tree, commitHash })
    rmSync(out, { recursive: true, force: true })
    cpSync(dist, out, { recursive: true })
  } catch (error) {
    // The variant never writes `upstream/`. That outranks a build failure, so
    // report it first.
    assertUpstreamUnchanged(root, before)
    throw error
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true })
  }
  assertUpstreamUnchanged(root, before)
  return { out: resolve(out), treeId }
}

/**
 * Report a variant that changed the official tree.
 *
 * @param {string} root - Repository root.
 * @param {string} before - The tree's status before the variant ran.
 */
function assertUpstreamUnchanged(root, before) {
  const after = upstreamStatus(root).join('\n')
  if (after !== before) throw new Error('the variant build changed upstream/')
}

/**
 * The default publication directory of one variant.
 *
 * @param {string} root - Repository root.
 * @param {string} [set] - Patch-set name.
 * @returns {string} Absolute directory path.
 */
export function defaultOutDir(root, set) {
  return join(resolve(root), 'dist', set === undefined ? 'web-official' : `web-${set}`)
}
