/** Profile registry: name rules, on-disk layout, session partitions, and the open-set file. */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The official desktop profile; it keeps the default session and the shell-owned lifecycle. */
export const DEFAULT_PROFILE = 'desktop'

/** Profile names become directory names and partition suffixes, so they stay lowercase, dash-separated, and short. */
const PROFILE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

/** The open-set file version this build reads and writes. */
const OPEN_PROFILES_VERSION = 1

/**
 * Whether a name may become a profile directory and session partition.
 * @param name Candidate profile name.
 * @returns True when the name is safe to use on disk and inside a partition.
 */
export function isValidProfileName(name: string): boolean {
	return PROFILE_NAME.test(name)
}

/**
 * The profile's directory inside the shared Harness home.
 * @param dshHome Harness home shared with the CLI.
 * @param name Validated profile name.
 * @returns The profile directory under `<dshHome>/profiles`.
 */
export function resolveProfileDir(dshHome: string, name: string): string {
	return join(dshHome, 'profiles', name)
}

/**
 * The Electron session partition that keeps one profile invisible to the others.
 * @param name Validated profile name.
 * @returns An empty string for the default profile (the official default session), `persist:plus-<name>` otherwise.
 */
export function partitionFor(name: string): string {
	return name === DEFAULT_PROFILE ? '' : `persist:plus-${name}`
}

/**
 * Read the profile set that was open when the application last exited.
 * @param file Open-set file path.
 * @returns Valid, unique profile names; a missing, corrupt, or foreign file yields an empty set.
 */
export function loadOpenProfiles(file: string): string[] {
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		// a missing or corrupt open set means "nothing to restore"
		return []
	}
	if (typeof parsed !== 'object' || parsed === null) return []
	const candidate = parsed as { readonly version?: unknown, readonly open?: unknown }
	if (candidate.version !== OPEN_PROFILES_VERSION) return []
	if (!Array.isArray(candidate.open)) return []
	return normalizeNames(candidate.open.filter((name): name is string => typeof name === 'string'))
}

/**
 * Persist the open profile set so the next start restores it.
 * @param file Open-set file path.
 * @param names Profile names to store; invalid names are dropped and duplicates collapse.
 */
export function saveOpenProfiles(file: string, names: readonly string[]): void {
	mkdirSync(dirname(file), { recursive: true })
	const tmp = `${file}.${process.pid}.tmp`
	writeFileSync(tmp, `${JSON.stringify({ version: OPEN_PROFILES_VERSION, open: normalizeNames(names) })}\n`, 'utf8')
	renameSync(tmp, file)
}

/** Keep the first occurrence of every valid name, in order. */
function normalizeNames(names: readonly string[]): string[] {
	const seen = new Set<string>()
	const kept: string[] = []
	for (const name of names) {
		if (!isValidProfileName(name) || seen.has(name)) continue
		seen.add(name)
		kept.push(name)
	}
	return kept
}

/** Remote profile entry: one remote dsh address maps to one profile (bun shared/net/remote.ts semantics). */
export interface RemoteProfileEntry {
  readonly name: string
  readonly url: string
}

/** Remote profile store path ($DSH_HOME/mobile-remotes.json, tmp+rename atomic write). */
export function remoteProfilesPath(dshHome: string): string {
  return join(dshHome, 'mobile-remotes.json')
}

/** Load the remote profile table; missing or corrupted files read as empty. */
export function loadRemoteProfiles(dshHome: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(remoteProfilesPath(dshHome), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, string> = {}
    for (const [name, url] of Object.entries(parsed as Record<string, unknown>)) {
      if (isValidProfileName(name) && typeof url === 'string' && /^https?:\/\//.test(url)) out[name] = url
    }
    return out
  } catch {
    return {}
  }
}

/** Save the remote profile table (tmp+rename atomic write); invalid entries are dropped before writing. */
export function saveRemoteProfiles(dshHome: string, entries: Record<string, string>): void {
  const path = remoteProfilesPath(dshHome)
  for (const [name, url] of Object.entries(entries)) {
    if (!isValidProfileName(name) || !/^https?:\/\//.test(url)) delete entries[name]
  }
  const tmp = `${path}.tmp`
  writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`)
  renameSync(tmp, path)
}
