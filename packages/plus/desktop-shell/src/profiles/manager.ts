/** Profile lifecycle: one window and one host runtime per profile, Electron-free. */

import { DEFAULT_PROFILE, isValidProfileName } from './registry.ts'

/** The window a profile owns; hiding it keeps the host runtime alive. */
export interface ProfileWindowHandle {
	hide(): void
	close(): void
	isDestroyed(): boolean
}

/** The host runtime behind a profile window. */
export interface ProfileHostHandle {
	stop(): Promise<void> | void
}

/** The handles one profile creation returns. */
export interface ProfileHandles {
	readonly window: ProfileWindowHandle
	readonly host: ProfileHostHandle
}

/** One open profile: its window and its host runtime. */
export interface ProfileEntry {
	readonly name: string
	readonly window: ProfileWindowHandle
	readonly host: ProfileHostHandle
}

/** Injected seams; the manager owns the lifecycle decisions, the shell owns the Electron objects. */
export interface ProfileManagerDeps {
	/** Create the window and host runtime of one profile. */
	readonly createProfile: (name: string) => ProfileHandles | Promise<ProfileHandles>
	/** Hide a profile window without stopping its host runtime. */
	readonly hideWindow: (window: ProfileWindowHandle) => void
	/** Clock for recorded failures; defaults to `Date.now`. */
	readonly now?: () => number
}

/** Why a quit did not complete. */
export type QuitProfileFailure = 'default-profile-owned-by-shell' | 'not-open' | 'host-stop-failed'

/** The result of one quit request. */
export type QuitProfileResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: 'default-profile-owned-by-shell' }
	| { readonly ok: false; readonly reason: 'not-open' }
	| { readonly ok: false; readonly reason: 'host-stop-failed'; readonly error: string }

/** A failure recorded for one profile. */
export interface ProfileErrorRecord {
	readonly message: string
	readonly at: number
}

/** The outcome of restoring a persisted profile set. */
export interface RestoreResult {
	readonly opened: readonly string[]
	readonly failed: readonly { readonly name: string; readonly error: string }[]
}

/** The profile lifecycle the shell drives. */
export interface ProfileManager {
	/** Open a profile; an already open profile returns its existing entry. */
	open(name: string): Promise<ProfileEntry>
	/** Hide the profile window, leaving its host runtime running. */
	hideOrClose(name: string): boolean
	/** Stop the profile's host runtime and forget the profile. */
	quitProfile(name: string): Promise<QuitProfileResult>
	/** The currently open profiles. */
	list(): ProfileEntry[]
	/** Open a persisted profile set; one failure does not stop the rest. */
	restore(names: readonly string[]): Promise<RestoreResult>
	/** Stop every profile this manager owns and forget them all. */
	dispose(): Promise<void>
	/** The most recent failure recorded for a profile. */
	lastError(name: string): ProfileErrorRecord | undefined
}

/** A profile name the manager refuses. */
export class ProfileManagerError extends Error {
	constructor(readonly code: 'invalid-profile-name', message: string) {
		super(message)
		this.name = 'ProfileManagerError'
	}
}

/**
 * Build the profile manager.
 * @param deps The shell's window, host, and clock seams.
 * @returns The manager that owns the profile lifecycle.
 */
export function createProfileManager(deps: ProfileManagerDeps): ProfileManager {
	const entries = new Map<string, ProfileEntry>()
	const pending = new Map<string, Promise<ProfileEntry>>()
	const errors = new Map<string, ProfileErrorRecord>()
	const now = deps.now ?? ((): number => Date.now())

	const record = (name: string, error: unknown): void => {
		errors.set(name, { message: describeError(error), at: now() })
	}

	const create = async (name: string): Promise<ProfileEntry> => {
		const handles = await deps.createProfile(name)
		const entry: ProfileEntry = { name, window: handles.window, host: handles.host }
		entries.set(name, entry)
		return entry
	}

	const open = async (name: string): Promise<ProfileEntry> => {
		if (!isValidProfileName(name)) {
			throw new ProfileManagerError('invalid-profile-name', `invalid profile name: ${name}`)
		}
		const existing = entries.get(name)
		if (existing !== undefined) return existing
		const inflight = pending.get(name)
		if (inflight !== undefined) return inflight
		const task = create(name).catch((error: unknown) => {
			record(name, error)
			throw error
		})
		pending.set(name, task)
		try {
			return await task
		} finally {
			if (pending.get(name) === task) pending.delete(name)
		}
	}

	const hideOrClose = (name: string): boolean => {
		const entry = entries.get(name)
		if (entry === undefined) return false
		if (entry.window.isDestroyed()) {
			// A destroyed window cannot be hidden; closing it drops the shell's reference to it.
			entry.window.close()
			return true
		}
		deps.hideWindow(entry.window)
		return true
	}

	const quitProfile = async (name: string): Promise<QuitProfileResult> => {
		if (name === DEFAULT_PROFILE) {
			return { ok: false, reason: 'default-profile-owned-by-shell' }
		}
		const entry = entries.get(name)
		if (entry === undefined) return { ok: false, reason: 'not-open' }
		try {
			await entry.host.stop()
		} catch (error) {
			// The profile leaves the manager either way; a failed stop is reported, not retried.
			record(name, error)
			entries.delete(name)
			return { ok: false, reason: 'host-stop-failed', error: describeError(error) }
		}
		entries.delete(name)
		return { ok: true }
	}

	const list = (): ProfileEntry[] => [...entries.values()]

	const restore = async (names: readonly string[]): Promise<RestoreResult> => {
		const opened: string[] = []
		const failed: { name: string, error: string }[] = []
		for (const name of names) {
			try {
				await open(name)
				opened.push(name)
			} catch (error) {
				failed.push({ name, error: describeError(error) })
			}
		}
		return { opened, failed }
	}

	const dispose = async (): Promise<void> => {
		// Let running creations settle so their host runtimes are stopped instead of leaking.
		await Promise.allSettled([...pending.values()])
		for (const [name, entry] of [...entries]) {
			if (name === DEFAULT_PROFILE) continue
			try {
				await entry.host.stop()
			} catch (error) {
				record(name, error)
			}
		}
		entries.clear()
		pending.clear()
	}

	const lastError = (name: string): ProfileErrorRecord | undefined => errors.get(name)

	return { open, hideOrClose, quitProfile, list, restore, dispose, lastError }
}

/** The message of a thrown value, for records and reports. */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
