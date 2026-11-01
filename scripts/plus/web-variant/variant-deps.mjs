/**
 * The dependencies of one variant tree.
 *
 * The variant installs its own dependencies, in its own tree, from its own
 * lockfile — the official one, because the official tree is what the variant
 * starts from. That keeps the variant self-contained: pnpm links the
 * workspace packages with relative symlinks, so a workspace package resolves
 * to the variant's own source and never to the repository's working tree.
 *
 * The install is the same command the desktop packaging workflow runs for the
 * upstream workspace store: frozen against the lockfile, preferring the local
 * pnpm store so a warm machine installs without the network.
 */

import { execFileSync } from 'node:child_process'

/**
 * Install the dependencies of one variant tree.
 *
 * @param {object} options - The variant tree.
 * @param {string} options.tree - The tree to install in.
 */
export function installVariantDependencies({ tree }) {
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { cwd: tree, stdio: 'inherit' })
}
