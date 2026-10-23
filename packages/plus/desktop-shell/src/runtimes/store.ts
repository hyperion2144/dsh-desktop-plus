/**
 * On-disk registry of plus-managed DSH runtimes under `<userData>/runtimes/<version>/dsh`.
 * Pure Node: no Electron imports, filesystem access injectable for tests.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Schema marker for the persisted selection file. */
const SELECTION_SCHEMA_VERSION = 1

/** A runtime directory must carry the official resource-tree layout marker. */
export const RUNTIME_MARKER_FILE = 'desktop-runtime.json'

/** Restricts version directory names to filesystem-safe release identifiers. */
const VERSION_DIR = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/

/** File holding the currently selected runtime version. */
export const SELECTED_RUNTIME_FILE = 'plus-runtime.json'

/** Read ports the store needs; defaults to real `node:fs` operations. */
export interface RuntimeStoreIo {
  readdir(name: string): readonly string[]
  exists(path: string): boolean
}

export const defaultRuntimeStoreIo: RuntimeStoreIo = {
  readdir: (name) => {
    try {
      return readdirSync(name)
    } catch {
      return []
    }
  },
  exists: (path) => existsSync(path),
}

/** Absolute path of one installed runtime's resource tree root. */
export function runtimeRootFor(userDataDir: string, version: string): string {
  return join(userDataDir, 'runtimes', version, 'dsh')
}

/** File path of the persisted selection record. */
export function selectedRuntimeFileFor(userDataDir: string): string {
  return join(userDataDir, SELECTED_RUNTIME_FILE)
}

/**
 * List installed runtime versions: every legal version directory under
 * `<userData>/runtimes` that carries the official resource-tree marker.
 */
export function listInstalledRuntimeVersions(userDataDir: string, io: RuntimeStoreIo = defaultRuntimeStoreIo): readonly string[] {
  const versions = io.readdir(join(userDataDir, 'runtimes'))
    .filter(name => VERSION_DIR.test(name))
    .filter(name => io.exists(join(runtimeRootFor(userDataDir, name), RUNTIME_MARKER_FILE)))
  return [...versions].sort(compareVersions)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map(Number)
  const pb = b.split(/[.+-]/).map(Number)
  for (let index = 0; index < 3; index += 1) {
    const left = pa[index] ?? 0
    const right = pb[index] ?? 0
    if (left !== right) return right - left
  }
  return b.localeCompare(a)
}

/** Persisted selection record. */
export interface RuntimeSelection {
  readonly version: string
}

/**
 * Read the persisted selection. Returns null when absent or malformed —
 * malformed files are treated as no selection, never as a hard failure.
 */
export function loadSelectedRuntime(userDataDir: string, readText?: (file: string) => string | null): RuntimeSelection | null {
  let text: string | null
  if (readText !== undefined) {
    text = readText(selectedRuntimeFileFor(userDataDir))
  } else {
    try {
      text = readFileSync(selectedRuntimeFileFor(userDataDir), 'utf8')
    } catch {
      return null
    }
  }
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    if (record['version'] !== SELECTION_SCHEMA_VERSION) return null
    const selected = record['selected']
    if (typeof selected !== 'string' || !VERSION_DIR.test(selected)) return null
    return { version: selected }
  } catch {
    return null
  }
}

/** Atomically persist the selection (tmp file + rename). */
export function saveSelectedRuntime(userDataDir: string, version: string, writeText?: (file: string, text: string) => void): void {
  const record = JSON.stringify({ version: SELECTION_SCHEMA_VERSION, selected: version }, null, 2)
  const write = writeText ?? ((file: string, text: string) => {
    mkdirSync(join(file, '..'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  })
  write(selectedRuntimeFileFor(userDataDir), record)
}

/** Remove the persisted selection file when present. */
export function clearSelectedRuntime(userDataDir: string, unlink?: (file: string) => void): void {
  const remove = unlink ?? ((file: string) => {
    try {
      rmSync(file, { force: true })
    } catch {
      // Removal is best-effort: a stale selection is re-cleared on the next failed verify.
    }
  })
  remove(selectedRuntimeFileFor(userDataDir))
}
