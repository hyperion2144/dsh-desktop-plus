/**
 * Running one variant's web build and collecting its dist.
 *
 * The build command is the official one (`pnpm run build:artifacts` inside
 * the tree), so a variant differs from the official build in exactly one way:
 * the tree it reads. That is what makes the baseline comparison meaningful —
 * a difference in the output can only come from the patch set.
 *
 * The artifact build is the official gate graph: the native addon, the Host
 * declarations and bundle, the Desktop bundle, the Client declarations and
 * bundle, and finally the Web build. The Web build consumes the workspace
 * packages as their built products, so the Client bundle is not optional —
 * the variant builds the packages it ships, from the variant's own source.
 *
 * The variant tree is not a Git worktree, and the official build embeds the
 * source commit in the client artifacts. The commit is therefore passed in
 * explicitly: the variant is the repository's commit plus a patch set, so the
 * commit is the repository's HEAD either way.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Where the official web build writes its output, relative to the tree. */
const DIST_RELATIVE = join('apps', 'web', 'dist')

/**
 * Build the web frontend of one variant tree.
 *
 * @param {object} options - The variant tree and the source commit.
 * @param {string} options.tree - The tree to build (the `upstream` directory of the scratch workspace).
 * @param {string} options.commitHash - The commit the variant's source is based on.
 * @returns {string} The dist directory the build produced.
 */
export function buildVariantWeb({ tree, commitHash }) {
  execFileSync('pnpm', ['run', 'build:artifacts'], {
    cwd: tree,
    stdio: 'inherit',
    env: { ...process.env, DSH_CLIENT_COMMIT_HASH: commitHash },
  })
  const dist = join(tree, DIST_RELATIVE)
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`the web build produced no ${DIST_RELATIVE}/index.html`)
  }
  return dist
}
