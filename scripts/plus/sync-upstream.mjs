#!/usr/bin/env node
// Replaces `upstream/` with a newer official deepseek-harness tree.
//
// The official source is never an ancestor of our history: this script extracts
// a commit from a bare mirror into `upstream/`, re-applies the contact-point
// patches in `scripts/plus/hooks/`, and records the SHA it synced to. The result
// is committed by hand as an ordinary commit on `main`.
//
// Usage:
//   node scripts/plus/sync-upstream.mjs                     # latest `master`
//   node scripts/plus/sync-upstream.mjs --ref <sha|ref>     # pin a revision
//   node scripts/plus/sync-upstream.mjs --repo <path|url>   # other source
//   node scripts/plus/sync-upstream.mjs --dry               # report only
//
// The mirror lives in `.plus/mirror` (gitignored), so repeated syncs reuse one
// fetch. Nothing is written until every patch applies cleanly.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.cwd())
const MIRROR = join(ROOT, '.plus', 'mirror')
const STAGING = join(ROOT, '.plus', 'tmp', 'upstream')
const TARGET = join(ROOT, 'upstream')
const HOOKS = join(ROOT, 'scripts', 'plus', 'hooks')
const BASE_FILE = join(ROOT, '.plus', 'upstream-base')

/** Required paths: a tree missing any of them is not a harness checkout. */
const REQUIRED = ['package.json', 'pnpm-workspace.yaml', 'apps/desktop/src/main.ts', 'packages/core']

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : (args[at + 1] ?? true)
}
const dry = args.includes('--dry')

const run = (cmd, argv, options = {}) =>
  execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

const fail = (message) => {
  console.error(`sync-upstream: ${message}`)
  process.exit(1)
}

// A local path is resolved against our root: the fetch runs inside the bare
// mirror, so a relative path would otherwise point at the mirror itself.
const rawSource = flag('repo') ?? 'https://github.com/deepseek-ai/deepseek-harness.git'
const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawSource) || /^[^/]+@[^:]+:/.test(rawSource)
const source = isRemote ? rawSource : resolve(ROOT, rawSource)
const ref = flag('ref') ?? 'master'

// 1. Fetch the requested revision into the mirror.
mkdirSync(MIRROR, { recursive: true })
if (!existsSync(join(MIRROR, 'HEAD'))) run('git', ['init', '--bare', MIRROR])
try {
  run('git', ['-C', MIRROR, 'fetch', '--no-tags', '--force', source, ref])
} catch (error) {
  fail(`cannot fetch ${ref} from ${source}: ${(error.stderr ?? '').toString().trim() || error.message}`)
}
const sha = run('git', ['-C', MIRROR, 'rev-parse', 'FETCH_HEAD']).trim()
const previous = existsSync(BASE_FILE) ? readFileSync(BASE_FILE, 'utf8').trim() : ''
if (sha === previous) {
  console.log(`sync-upstream: already at ${sha.slice(0, 10)}`)
  process.exit(0)
}

// 2. Extract the tree into staging and validate it before touching upstream/.
rmSync(STAGING, { recursive: true, force: true })
mkdirSync(STAGING, { recursive: true })
run('bash', ['-c', `git -C "${MIRROR}" archive "${sha}" | tar -x -C "${STAGING}"`])
const missing = REQUIRED.filter((path) => !existsSync(join(STAGING, path)))
if (missing.length > 0) fail(`official tree at ${sha} is missing ${missing.join(', ')}`)

const subject = run('git', ['-C', MIRROR, 'log', '-1', '--format=%s', sha]).trim()
console.log(`sync-upstream: ${previous ? previous.slice(0, 10) : '(none)'} -> ${sha.slice(0, 10)} ${subject}`)
if (dry) {
  console.log('sync-upstream: --dry, nothing written')
  process.exit(0)
}

// 3. Swap the tree. Staging already validated, so this is the only destructive step.
rmSync(TARGET, { recursive: true, force: true })
mkdirSync(join(TARGET, '..'), { recursive: true })
run('bash', ['-c', `mv "${STAGING}" "${TARGET}"`])

// 4. Re-apply the contact points. A failing patch aborts the whole sync: a
//    half-upgraded tree would build against an unpatched official entry point.
const patches = existsSync(HOOKS) ? readdirSync(HOOKS).filter((f) => f.endsWith('.patch')).sort() : []
for (const patch of patches) {
  try {
    run('git', ['apply', '-3', '--whitespace=nowarn', join(HOOKS, patch)])
    console.log(`sync-upstream: applied ${patch}`)
  } catch (error) {
    fail(
      `${patch} no longer applies to upstream ${sha.slice(0, 10)}. ` +
        `Resolve it against the new tree, regenerate the patch, then rerun. ` +
        `${(error.stderr ?? '').toString().trim()}`,
    )
  }
}

// 5. Restate the official workspace settings at our root.
run(process.execPath, [join(ROOT, 'scripts', 'plus', 'gen-workspace.mjs')])

writeFileSync(BASE_FILE, `${sha}\n`)
console.log(`sync-upstream: done. Next: pnpm install, then review pnpm-workspace.yaml, then commit.`)
