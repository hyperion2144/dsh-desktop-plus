#!/usr/bin/env node
// Generates the root pnpm-workspace.yaml for the `upstream/` layout.
//
// The official workspace configuration lives in upstream/pnpm-workspace.yaml and
// carries settings pnpm only reads from the workspace root: package globs,
// overrides, peerDependencyRules, allowBuilds, minimumReleaseAgeExclude, and
// patchedDependencies. Moving the official tree into upstream/ makes pnpm ignore
// that file entirely, so every setting has to be restated at the root with its
// paths re-rooted. This script does that mechanically and keeps the official
// comments, so a review diff shows exactly what changed upstream.
//
// Usage:
//   node scripts/plus/gen-workspace.mjs [root] [--dry] [--check]
//
//   --dry    print the generated file instead of writing it
//   --check  exit 1 if the file on disk differs from what would be generated

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const rootArg = argv.find((a) => !a.startsWith('--'))
const ROOT = resolve(rootArg ?? process.cwd())
const SRC = join(ROOT, 'upstream', 'pnpm-workspace.yaml')
const OUT = join(ROOT, 'pnpm-workspace.yaml')

const HEADER = [
  '# GENERATED FILE — DO NOT EDIT.',
  '#',
  '# Produced by scripts/plus/gen-workspace.mjs from upstream/pnpm-workspace.yaml.',
  '# pnpm reads workspace settings only from the workspace root, so the official',
  '# settings (globs, overrides, allowBuilds, release-age exemptions, patches) are',
  '# restated here with their paths re-rooted under upstream/. After syncing',
  '# upstream, regenerate this file and review the diff.',
  '',
].join('\n')

/** Top-level keys pnpm accepts in a workspace manifest. */
const SECTIONS = new Set([
  'packages',
  'overrides',
  'peerDependencyRules',
  'allowBuilds',
  'minimumReleaseAgeExclude',
  'patchedDependencies',
  'onlyBuiltDependencies',
  'neverBuiltDependencies',
])

/**
 * Workspace entries we add to the official list. Each is [directory, glob]: the
 * glob is emitted only when the directory exists, so a fresh tree still installs.
 *
 * `upstream` itself is always included: it is the official root project and
 * carries the toolchain (typescript, tsx, vitest, electron, packaging helpers),
 * so leaving it out would leave every official script without its dependencies.
 */
const OWN_GLOBS = [
  ['upstream', 'upstream'],
  ['packages/plus', 'packages/plus/*'],
  ['apps/plus', 'apps/plus/*'],
]

const fail = (message) => {
  console.error(`gen-workspace: ${message}`)
  process.exit(1)
}

if (!existsSync(SRC)) fail(`missing ${SRC} — is the official tree vendored under upstream/?`)

const source = readFileSync(SRC, 'utf8').split('\n')

/** Splits `name@version` at the last `@` that is not the scope marker. */
function splitPatchedKey(key) {
  const at = key.lastIndexOf('@')
  if (at <= 0) fail(`cannot read a version out of patchedDependencies key ${key}`)
  return { name: key.slice(0, at), version: key.slice(at + 1) }
}

const out = []
let section = null
let patched = []

for (const line of source) {
  if (line.trim() === '' || line.trimStart().startsWith('#')) {
    out.push(line)
    continue
  }
  if (!line.startsWith(' ')) {
    const key = line.slice(0, line.indexOf(':')).trim()
    section = SECTIONS.has(key) ? key : null
    out.push(line)
    continue
  }

  switch (section) {
    case 'packages': {
      const match = /^(\s*-\s+)(\S.*)$/.exec(line)
      if (!match) fail(`unexpected packages entry: ${line}`)
      const glob = match[2].trim()
      out.push(`${match[1]}${glob.startsWith('upstream/') ? glob : `upstream/${glob}`}`)
      break
    }
    case 'overrides': {
      const match = /^(\s*)((?:'[^']+'|[^:\s][^:]*)):\s*(.*)$/.exec(line)
      if (!match) fail(`unexpected overrides entry: ${line}`)
      // Values may be quoted; unwrap, re-root, then restore the quoting style.
      const raw = match[3].trim()
      const quote = raw.startsWith("'") ? "'" : raw.startsWith('"') ? '"' : ''
      const bare = quote ? raw.slice(1, -1) : raw
      const value =
        bare.startsWith('link:') && !bare.startsWith('link:upstream/')
          ? `link:upstream/${bare.slice('link:'.length)}`
          : bare
      out.push(`${match[1]}${match[2]}: ${quote}${value}${quote}`)
      break
    }
    case 'allowBuilds': {
      out.push(line.replaceAll('file:packages/', 'file:upstream/packages/').replaceAll('file:vendor/', 'file:upstream/vendor/'))
      break
    }
    case 'patchedDependencies': {
      const match = /^(\s*)((?:'[^']+'|[^:\s][^:]*)):\s*(.*)$/.exec(line)
      if (!match) fail(`unexpected patchedDependencies entry: ${line}`)
      const key = match[2].replaceAll("'", '')
      const patchPath = match[3].trim()
      if (!patchPath.startsWith('upstream/patches/')) {
        if (!patchPath.startsWith('patches/')) fail(`unexpected patch path: ${patchPath}`)
        patched.push(splitPatchedKey(key))
        out.push(`${match[1]}${match[2]}: upstream/${patchPath}`)
      } else {
        out.push(line)
      }
      break
    }
    default:
      out.push(line)
  }
}

// Every patched dependency must resolve to the exact version its patch targets.
// Without the official lockfile pnpm re-resolves the graph and a caret range in
// a package manifest can drift past the patched version, which pnpm then reports
// as ERR_PNPM_UNUSED_PATCH and refuses to install.
function appendToSection(lines, name, entries) {
  const start = lines.findIndex((l) => l.startsWith(`${name}:`))
  if (start === -1) fail(`cannot find a ${name}: section to extend`)
  let end = start + 1
  while (end < lines.length && (lines[end] === '' || lines[end].startsWith(' ') || lines[end].startsWith('#'))) end += 1
  // Trim trailing blank lines so our entries sit inside the section.
  while (end > start + 1 && lines[end - 1] === '') end -= 1
  lines.splice(end, 0, ...entries)
}

const ownGlobs = OWN_GLOBS.filter(([dir]) => existsSync(join(ROOT, dir))).map(([, glob]) => `  - ${glob}`)
if (ownGlobs.length > 0) appendToSection(out, 'packages', ownGlobs)

const pins = [...new Map(patched.map((p) => [p.name, p.version])).entries()].map(
  ([name, version]) => `  '${name}': '${version}'`,
)
if (pins.length > 0) {
  appendToSection(out, 'overrides', [
    '  # Pinned to the version each patchedDependencies entry targets: without the',
    '  # official lockfile pnpm re-resolves and drifts past the patched version.',
    ...pins,
  ])
}

const text = `${HEADER}${out.join('\n').replace(/\n+$/, '')}\n`

if (flags.has('--dry')) {
  process.stdout.write(text)
  process.exit(0)
}

if (flags.has('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
  if (current !== text) fail('pnpm-workspace.yaml is stale — run scripts/plus/gen-workspace.mjs')
  process.exit(0)
}

writeFileSync(OUT, text)
console.log(`gen-workspace: wrote ${OUT} (${pins.length} pinned, ${ownGlobs.length} own glob(s))`)
