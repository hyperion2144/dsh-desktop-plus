/** Profile registry: name rules, on-disk layout, session partitions, and the open-set file. */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
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
 * 列出 `$DSH_HOME/profiles/` 下的所有 profile 目录（不只看壳拉起过的）。
 *
 * 面板与托盘的 profile 列表必须对得上本地真实目录：用户可能有 web/smoke/spike 等
 * 由 dsh CLI 建的 profile，壳没开过窗口也要列出来。
 *
 * @param dshHome `$DSH_HOME`。
 * @returns 合法目录名，按字典序排列。
 */
export function listProfileDirs(dshHome: string): string[] {
	try {
		const root = join(dshHome, 'profiles')
		if (!existsSync(root)) return []
		return readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && isValidProfileName(entry.name))
			.map((entry) => entry.name)
			.sort()
	} catch {
		// 读不到就当没有：不阻断启动，也不编造 profile。
		return []
	}
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

/**
 * Derive the remote profile name from its URL: `remote-<host>-<port>`, lowercased,
 * non-alphanumeric runs collapsed to dashes, truncated to the 32-char profile-name rule.
 * The same URL always maps to the same name, so the tray rows, the delete guard and the
 * window host resolve the same profile.
 * @param url Remote dsh web origin as stored in settings (a complete http(s) URL).
 * @returns A name that passes isValidProfileName.
 */
export function remoteProfileName(url: string): string {
	let host = 'address'
	let port = ''
	try {
		const parsed = new URL(url)
		host = parsed.hostname
		port = parsed.port
	} catch {
		// 面板保存前已做 URL 归一化；解析失败按整串派生一个合法名。
	}
	const raw = `remote-${host}-${port}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
	return raw.slice(0, 32).replace(/-+$/, '')
}
