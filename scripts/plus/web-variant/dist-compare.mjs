/**
 * Comparing two build outputs.
 *
 * A comparison answers two different questions, and a variant baseline needs
 * both:
 *
 *   1. Do the two outputs hold the same files, with the same bytes? That is
 *      the question the baseline asks.
 *   2. Do they hold the same *content*, even if the file names differ? Rollup
 *      names a chunk after a hash of its content, so a build that embeds a
 *      timestamp renames its chunks without changing what they contain. The
 *      content comparison separates "the build changed" from "the build
 *      renamed things".
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Every file of a directory, with the hash of its content.
 *
 * @param {string} dir - Directory to read.
 * @returns {Map<string, string>} Relative path -> sha256 of the content.
 */
export function hashTree(dir) {
  const files = new Map()
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      files.set(relative(dir, absolute), createHash('sha256').update(readFileSync(absolute)).digest('hex'))
    }
  }
  walk(dir)
  return files
}

/**
 * Compare two build outputs.
 *
 * @param {string} left - Left directory.
 * @param {string} right - Right directory.
 * @returns {{onlyLeft: string[], onlyRight: string[], changed: string[], contentOnlyLeft: string[], contentOnlyRight: string[]}} Differences.
 */
export function compareTrees(left, right) {
  const leftFiles = hashTree(left)
  const rightFiles = hashTree(right)
  const onlyLeft = []
  const onlyRight = []
  const changed = []
  for (const [path, hash] of leftFiles) {
    if (!rightFiles.has(path)) onlyLeft.push(path)
    else if (rightFiles.get(path) !== hash) changed.push(path)
  }
  for (const path of rightFiles.keys()) {
    if (!leftFiles.has(path)) onlyRight.push(path)
  }
  const leftContents = new Set(leftFiles.values())
  const rightContents = new Set(rightFiles.values())
  return {
    onlyLeft: onlyLeft.sort(),
    onlyRight: onlyRight.sort(),
    changed: changed.sort(),
    contentOnlyLeft: [...leftContents].filter(hash => !rightContents.has(hash)).sort(),
    contentOnlyRight: [...rightContents].filter(hash => !leftContents.has(hash)).sort(),
  }
}

/**
 * Whether two build outputs are byte-identical, file for file.
 *
 * @param {{onlyLeft: string[], onlyRight: string[], changed: string[]}} difference - A comparison result.
 * @returns {boolean} True when no path is missing and no content differs.
 */
export function isIdentical(difference) {
  return difference.onlyLeft.length === 0 && difference.onlyRight.length === 0 && difference.changed.length === 0
}
