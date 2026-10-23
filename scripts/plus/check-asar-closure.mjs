/**
 * Static dependency-closure gate for packaged Desktop asar archives.
 *
 * Walks every package under `node_modules/` and `dsh/node_modules/` inside an
 * app.asar and asserts, per package, that (a) every production dependency name
 * resolves to a package directory in the same root, and (b) every static bare
 * `require()` specifier — including subpaths like `jsonfile/utils` — resolves
 * to real files. This catches the two ways a packaged app has broken at
 * startup: the platform dependency collector dropping transitive packages, and
 * hand-promoted packages pinned to versions whose subpaths do not exist.
 *
 * Usage: node scripts/plus/check-asar-closure.mjs <target-dir> […]
 * Each target dir is searched recursively for `app.asar`.
 */

import { accessSync, constants, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
/** Locate @electron/asar's API module from the repository node_modules tree. */
function locateAsarModule() {
  const require = createRequire(import.meta.url)
  let dir = process.cwd()
  while (true) {
    const store = join(dir, 'node_modules', '.pnpm')
    try {
      for (const entry of readdirSync(store)) {
        if (entry.startsWith('@electron+asar@')) {
          return require(join(store, entry, 'node_modules', '@electron', 'asar', 'lib', 'asar.js'))
        }
      }
    } catch {
      // not a node_modules root; keep walking up
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error('@electron/asar not found; run inside the repository')
    dir = parent
  }
}

/** @electron/asar splits archive keys on `path.sep`; always feed it native separators. */
function toAsarKey(path) {
  return path.replace(/^\//, '').split('/').join(sep)
}


const asar = locateAsarModule()

const failures = []

/** One asar archive: entry list, per-package manifests, and extracted sources. */
class Archive {
  constructor(path) {
    this.path = path
    this.entries = new Set(
      asar.listPackage(path).map((entry) => {
        const normalized = entry.replaceAll('\\', '/')
        return normalized.startsWith('/') ? normalized : `/${normalized}`
      }),
    )
    this.manifests = new Map()
    this.staging = mkdtempSync(join(tmpdir(), 'asar-closure-'))
  }

  has(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`
    return (
      this.entries.has(normalized) ||
      this.entries.has(`${normalized}.js`) ||
      this.entries.has(`${normalized}/index.js`)
    )
  }

  /** Package directories directly under one node_modules root (scopes descended). */
  packagesUnder(root) {
    const prefix = `/${root}/`
    const names = new Set()
    for (const entry of this.entries) {
      if (!entry.startsWith(prefix)) continue
      const rest = entry.slice(prefix.length)
      const [head, next] = rest.split('/')
      if (head.startsWith('@')) {
        if (next !== undefined) names.add(`${head}/${next}`)
      } else if (head !== '') {
        names.add(head)
      }
    }
    return [...names].filter((name) => this.has(`${root}/${name}/package.json`))
  }

  manifest(root, name) {
    const key = `${root}/${name}`
    if (this.manifests.has(key)) return this.manifests.get(key)
    let manifest = {}
    try {
      this.manifests.set(key, (manifest = JSON.parse(asar.extractFile(this.path, toAsarKey(`${key}/package.json`)))))
    } catch {
      this.manifests.set(key, manifest)
    }
    return manifest
  }

  /** File text or null; only JS sources are requested. */
  readText(path) {
    try {
      return asar.extractFile(this.path, toAsarKey(path)).toString('utf8')
    } catch {
      return null
    }
  }
}

/** Static `require("pkg/sub")` specifiers referenced by one package's JS files. */
function requiredSpecifiers(archive, root, name) {
  const prefix = `${root}/${name}/`
  const specifiers = new Set()
  const files = [...archive.entries].filter(
    (entry) => entry.startsWith(prefix) && /\.[cm]?js$/.test(entry),
  )
  for (const file of files) {
    const source = archive.readText(file)
    if (source === null) continue
    for (const match of source.matchAll(/require\(\s*["']([^'"]+)["']\s*\)/g)) {
      const specifier = match[1]
      if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
      specifiers.add(specifier)
    }
  }
  return [...specifiers]
}

/** True when the package manifest's `exports` maps the subpath to a real file. */
function exportsResolve(manifest, subpath) {
  const exports = manifest.exports
  if (exports === undefined || exports === null || typeof exports !== 'object') return null
  const table = exports[`./${subpath}`]
  const target = typeof table === 'string' ? table : table?.default ?? table?.require
  return typeof target === 'string' ? target.replace(/^\.\//, '') : null
}

function checkArchive(archive, label) {
  for (const root of ['node_modules', 'dsh/node_modules']) {
    if (![...archive.entries].some((entry) => entry.startsWith(`/${root}/`))) continue
    const names = archive.packagesUnder(root)
    if (names.length === 0) continue

    // Optional dependencies any packaged package declares are allowed to be
    // absent (platform-specific packages: fsevents on win32, …).
    const optional = new Set()
    for (const name of names) {
      for (const dep of Object.keys(archive.manifest(root, name).optionalDependencies ?? {})) {
        optional.add(dep)
      }
    }

    let checked = 0
    for (const name of names) {
      const manifest = archive.manifest(root, name)
      if (Object.keys(manifest).length === 0) {
        failures.push(`${label}: ${root}/${name} manifest unreadable (extractFile failed — gate would be blind, refusing to pass)`)
        continue
      }
      const production = { ...manifest.dependencies }
      for (const [dep, spec] of Object.entries(manifest.optionalDependencies ?? {})) {
        if (production[dep] === undefined) production[dep] = spec
      }
      checked += 1

      for (const dep of Object.keys(production)) {
        if (!optional.has(dep) && !archive.has(`${root}/${dep}/package.json`)) {
          failures.push(`${label}: ${name} requires missing package ${dep}`)
        }
      }

      for (const specifier of requiredSpecifiers(archive, root, name)) {
        const parts = specifier.split('/')
        const base = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
        const subpath = specifier.startsWith('@') ? parts.slice(2).join('/') : parts.slice(1).join('/')
        if (!archive.has(`${root}/${base}/package.json`)) {
          if (!optional.has(base)) failures.push(`${label}: ${name} requires missing package ${base}`)
          continue
        }
        if (subpath === '') continue
        const mapped = exportsResolve(archive.manifest(root, base), subpath)
        if (mapped !== null) {
          if (!archive.has(`${root}/${base}/${mapped}`)) {
            failures.push(`${label}: ${name} requires missing subpath ${specifier} (exports → ${mapped})`)
          }
          continue
        }
        if (!archive.has(`${root}/${base}/${subpath}`)) {
          failures.push(`${label}: ${name} requires missing subpath ${specifier}`)
        }
      }
    }
    console.log(`${label} ${root}: ${String(names.length)} packages, ${String(checked)} manifests checked`)
  }
}

/** native/bin 下的可执行文件必须落在 app.asar.unpacked 且带执行位：asar 内的路径
 * 只能读不能 spawn（真实故障：CUA helper 在 asar 里，插件报 NATIVE_IO 写入失败）。 */
function assertNativeUnpacked(archive, label) {
	for (const entry of archive.entries) {
		if (!entry.includes('/native/bin/')) continue
		const physical = `${archive.path}.unpacked${entry.replaceAll('/', sep)}`
		try {
			accessSync(physical, constants.X_OK)
		} catch {
			failures.push(`${label}: native executable must be unpacked and executable: ${entry}`)
		}
	}
}

const targets = process.argv.slice(2)
if (targets.length === 0) {
  console.error('usage: node scripts/plus/check-asar-closure.mjs <target-dir> […]')
  process.exit(1)
}

for (const target of targets) {
  const found = []
  for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'app.asar') found.push(join(entry.parentPath, entry.name))
  }
  if (found.length === 0) throw new Error(`no app.asar under ${target}`)
  for (const path of found) {
    const archive = new Archive(path)
    try {
      checkArchive(archive, path)
      assertNativeUnpacked(archive, path)
    } finally {
      rmSync(archive.staging, { recursive: true, force: true })
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`asar closure: ${failure}`)
  throw new Error(`asar closure check failed with ${String(failures.length)} missing module(s)`)
}
console.log('asar closure: ok')
