#!/usr/bin/env node
/**
 * Build the web frontend of one patch-set variant.
 *
 * A *variant* is the official tree plus exactly one patch set, built with the
 * official build command. The desktop build consumes `official + desktop`;
 * the mobile build consumes `official + mobile`. The two never share a tree:
 * a variant is materialized in a scratch directory from the committed
 * official tree, so `upstream/` keeps its official bytes and the desktop
 * workflow is untouched.
 *
 * Usage:
 *   node scripts/plus/build-web-variant.mjs --set mobile [--out <dir>] [--keep]
 *   node scripts/plus/build-web-variant.mjs --official [--out <dir>] [--keep]
 *
 * `--official` builds the unmodified official tree; it is the reference the
 * mobile baseline is compared against.
 */

import { resolve } from 'node:path'
import { buildVariant, defaultOutDir } from './web-variant/variant-run.mjs'

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

const official = args.includes('--official')
const set = official ? undefined : (valueOf('--set') ?? 'mobile')
const out = valueOf('--out') ?? defaultOutDir(ROOT, set)
const keep = args.includes('--keep')

try {
  const published = buildVariant({ root: ROOT, set, out, keep })
  const label = official ? 'official' : `${set} variant`
  console.log(`build-web-variant: the ${label} tree id ${published.treeId}`)
  console.log(`build-web-variant: the ${label} dist published to ${published.out}`)
} catch (error) {
  console.error(`build-web-variant: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
