/** Runtime selection: pure dedup/sort/disposition over runtime candidate sources. No IO. */

/**
 * One candidate runtime sighting. Sources describe where a runtime was seen;
 * the same version may be seen from several sources and only the
 * highest-priority source survives.
 */
export interface RuntimeSourceInput {
	/** Stable identifier of the source sighting, e.g. `builtin`, `installed:~/.dsh`, `remote:index`. */
	readonly id: string
	/** Where the runtime came from; decides dedup priority and the default disposition. */
	readonly kind: RuntimeSourceKind
	/** Raw semver string as reported by the source; invalid versions become `unavailable` candidates. */
	readonly version: string
	/** Why the runtime is not selectable; required for unusable sightings. */
	readonly unavailableReason?: string
}

export type RuntimeSourceKind = 'builtin' | 'installed' | 'remote'

/** Outcome for one candidate version after dedup. */
export type RuntimeDisposition =
	| 'builtin'
	| 'installed'
	| 'downloadable'
	| 'unavailable'

/** One deduplicated, sorted runtime candidate with its disposition. */
export interface RuntimeCandidate {
	/** Normalized semver string (`major.minor.patch[-prerelease]`, build metadata dropped). */
	readonly version: string
	/** True when the version carries a prerelease tag. */
	readonly prerelease: boolean
	/** True when the surviving source is the builtin runtime. */
	readonly builtin: boolean
	/** False only for the builtin runtime, which can never be removed. */
	readonly removable: boolean
	/** The deduplicated outcome for this version. */
	readonly disposition: RuntimeDisposition
	/** Reason the candidate is unavailable; present only when `disposition` is `unavailable`. */
	readonly unavailableReason?: string
	/** The highest-priority source sighting that produced this candidate. */
	readonly source: RuntimeSourceInput
}

/** Source priority for dedup: builtin beats installed beats remote. */
const SOURCE_PRIORITY: Record<RuntimeSourceKind, number> = {
	builtin: 0,
	installed: 1,
	remote: 2,
}


interface SemVer {
	readonly major: number
	readonly minor: number
	readonly patch: number
	readonly prerelease: readonly string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse a semver string; build metadata is dropped, `v` prefix is tolerated. Returns null when invalid. */
export function parseSemver(raw: string): SemVer | null {
	const match = VERSION_PATTERN.exec(raw.trim())
	if (match === null) return null
	const [, major, minor, patch, prerelease] = match
	return {
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
		prerelease: prerelease === undefined ? [] : prerelease.split('.'),
	}
}

function comparePrereleaseIdentifiers(left: readonly string[], right: readonly string[]): number {
	if (left.length === 0 && right.length === 0) return 0
	// A version without prerelease identifiers outranks its prerelease variants on semver order.
	if (left.length === 0) return 1
	if (right.length === 0) return -1
	const length = Math.max(left.length, right.length)
	for (let index = 0; index < length; index += 1) {
		const l = left[index]
		const r = right[index]
		if (l === undefined) return -1
		if (r === undefined) return 1
		const lNumber = /^\d+$/.test(l) ? Number(l) : null
		const rNumber = /^\d+$/.test(r) ? Number(r) : null
		if (lNumber !== null && rNumber !== null) {
			if (lNumber !== rNumber) return lNumber < rNumber ? -1 : 1
		} else if (lNumber !== null) {
			return -1
		} else if (rNumber !== null) {
			return 1
		} else if (l !== r) {
			return l < r ? -1 : 1
		}
	}
	return 0
}

/** Compare two parsed semvers in semver order (prerelease below its release). */
export function compareSemver(left: SemVer, right: SemVer): number {
	for (const field of ['major', 'minor', 'patch'] as const) {
		if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1
	}
	return comparePrereleaseIdentifiers(left.prerelease, right.prerelease)
}

/**
 * Select runtime candidates from all source sightings.
 *
 * Deduplicates by parsed version keeping the highest-priority source, sorts by semver
 * descending with prereleases above their own release, and keeps invalid-version sightings
 * as `unavailable` candidates at the tail. The builtin runtime always survives with
 * `disposition: 'builtin'` and `removable: false`.
 */
export function selectRuntimeCandidates(sources: readonly RuntimeSourceInput[]): RuntimeCandidate[] {
	interface Group {
		readonly key: SemVer | null
		readonly normalized: string
		readonly prerelease: boolean
		best: { source: RuntimeSourceInput; priority: number; builtin: boolean; invalid: boolean }
	}
	const groups = new Map<string, Group>()
	for (const source of sources) {
		const parsed = parseSemver(source.version)
		const key = parsed === null ? `invalid:${source.version}` : `v:${parsed.major}.${parsed.minor}.${parsed.patch}:${parsed.prerelease.join('.')}`
		const invalid = parsed === null || source.unavailableReason !== undefined
		let group = groups.get(key)
		if (group === undefined) {
			group = {
				key: parsed,
				normalized: parsed === null ? source.version.trim() : `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length > 0 ? `-${parsed.prerelease.join('.')}` : ''}`,
				prerelease: parsed !== null && parsed.prerelease.length > 0,
				best: { source, priority: SOURCE_PRIORITY[source.kind], builtin: source.kind === 'builtin', invalid },
			}
			groups.set(key, group)
			continue
		}
		const priority = SOURCE_PRIORITY[source.kind]
		if (priority < group.best.priority || (group.best.invalid && !invalid && priority === group.best.priority)) {
			group.best = { source, priority, builtin: source.kind === 'builtin', invalid }
		}
	}

	const candidates: Array<{ group: Group }> = [...groups.values()].map((group) => ({ group }))
	candidates.sort((left, right) => {
		const a = left.group
		const b = right.group
		if (a.key === null || b.key === null) {
			if (a.key === null && b.key === null) return a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0
			return a.key === null ? 1 : -1
		}
		// Release numbers dominate; within one release line the newest prerelease
		// floats above its release so users see the freshest line first.
		for (const field of ['major', 'minor', 'patch'] as const) {
			if (a.key[field] !== b.key[field]) return b.key[field] < a.key[field] ? -1 : 1
		}
		if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1
		return comparePrereleaseIdentifiers(b.key.prerelease, a.key.prerelease)
	})

	return candidates.map(({ group }) => ({
		version: group.normalized,
		prerelease: group.prerelease,
		builtin: group.best.builtin,
		removable: !group.best.builtin,
		disposition: group.best.builtin ? 'builtin' : group.best.invalid ? 'unavailable' : group.best.source.kind === 'installed' ? 'installed' : 'downloadable',
		...(group.best.invalid ? { unavailableReason: group.best.source.unavailableReason ?? `invalid version: ${group.best.source.version}` } : {}),
		source: group.best.source,
	}))
}
