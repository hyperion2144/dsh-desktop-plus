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
// `upstream/` is the untouched official tree, so the settings it carries are the
// official ones — but the settings a *build* runs with are the official ones plus
// the desktop patch set (that is where the plus package overrides live). The two
// files this script reads are therefore read through the patch set, so the result
// is the same whether or not the patches happen to be applied on disk.
//
// Usage:
//   node scripts/plus/gen-workspace.mjs [root] [--dry] [--check]
//
//   --dry    print the generated file instead of writing it
//   --check  exit 1 if the file on disk differs from what would be generated

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readPatchedFiles } from './patch-set.mjs'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const rootArg = argv.find((a) => !a.startsWith('--'))
const ROOT = resolve(rootArg ?? process.cwd())
const SRC = join(ROOT, 'upstream', 'pnpm-workspace.yaml')
const LOCK = join(ROOT, 'upstream', 'pnpm-lock.yaml')
const OUT = join(ROOT, 'pnpm-workspace.yaml')
const WORKSPACE_PATH = 'upstream/pnpm-workspace.yaml'
const LOCK_PATH = 'upstream/pnpm-lock.yaml'
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
if (!existsSync(LOCK)) fail(`missing ${LOCK} — is the official tree vendored under upstream/?`)

// The workspace settings describe the tree a build runs with: the official tree
// plus the desktop patch set. Reading them through the patch set keeps the
// generated file identical no matter what is on disk.
let patchedFiles
try {
  patchedFiles = readPatchedFiles({ root: ROOT, set: 'desktop', paths: [WORKSPACE_PATH, LOCK_PATH] })
} catch (error) {
  fail(`cannot read the patched upstream settings: ${error instanceof Error ? error.message : String(error)}`)
}

const source = patchedFiles.get(WORKSPACE_PATH).split('\n')

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
          ? `link:upstream/${bare.slice('link:'.length)}`.replaceAll('link:upstream/../', 'link:')
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

/**
 * The version the official lockfile pins for one package, or null when the
 * official tree has no lockfile yet. Snapshot keys carry optional peer suffixes
 * (`electron@44.7.0(peer@x)`); only the base version is compared.
 * @param {string} name - Package whose lockfile version to read.
 * @returns {string | null} The pinned base version.
 */
function upstreamLockPin(name) {
  const lock = patchedFiles.get(LOCK_PATH)
  if (lock === undefined) return null
  const versions = new Set()
  const head = `  ${name}@`
  for (const line of lock.split('\n')) {
    if (!line.startsWith(head)) continue
    const rest = line.slice(head.length)
    const version = rest.slice(0, rest.search(/[:(]/))
    if (version !== '') versions.add(version)
  }
  if (versions.size === 0) fail(`upstream/pnpm-lock.yaml records no ${name} snapshot to pin`)
  if (versions.size > 1) fail(`upstream/pnpm-lock.yaml records several ${name} versions (${[...versions].join(', ')}) — pin one manually`)
  return versions.values().next().value
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

// Desktop packaging downloads and launches the real Electron (its runtime
// fingerprint gates reject drifted minors) and compiles NSIS through
// app-builder-lib, whose peer graph must resolve as one instance for the
// directory-installer patch to reach the copy electron-builder runs. Pin both
// to the exact versions the official lockfile records, like patched deps.
const lockPins = ['electron', 'dmg-builder']
  .map((name) => [name, upstreamLockPin(name)])
  .filter(([, version]) => version !== null)
if (lockPins.length > 0) {
  appendToSection(out, 'overrides', [
    '  # Pinned to the official lockfile version: a drifted packaging dependency',
    '  # breaks the desktop build (runtime fingerprint gate, app-builder-lib',
    '  # peer-instance split), not just the development workspace.',
    ...lockPins.map(([name, version]) => `  '${name}': '${String(version)}'`),
  ])
}
// Electron fetches its platform binary in a postinstall that the official allowlist
// never enables, because the official workspace consumes a prebuilt Electron. Desktop
// packaging launches the real binary, so it has to run here.
appendToSection(out, 'allowBuilds', [
  '  # Electron downloads its platform binary in a postinstall; packaging runs it.',
  '  electron: true',
])

// pnpm 11 re-resolves the dependency graph before every script run. The root
// lockfile describes the *patched* tree (upstream/apps/cli depends on the plus
// packages through our patch), so on the committed tree — the official tree —
// that implicit install rewrites the lockfile on every `pnpm run`. A gate must
// not rewrite what it checks, so the implicit install is off: the build applies
// the patch set and installs explicitly.
if (!out.some(line => line.startsWith('verifyDepsBeforeRun:'))) {
  out.push(
    '# pnpm would re-resolve the graph before every script run and rewrite the',
    '# root lockfile whenever upstream/ is the official tree instead of the',
    '# patched tree the lockfile describes. Gates must not rewrite what they',
    '# check, so installs stay explicit: apply the patch set, then pnpm install.',
    'verifyDepsBeforeRun: false',
  )
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
