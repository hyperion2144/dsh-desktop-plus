/** Electron seam: one window and one Host runtime per plus profile. */

import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { App } from 'electron'
import { createProfileManager } from './manager.ts'
import type { ProfileEntry, ProfileHandles, ProfileHostHandle, ProfileManager, QuitProfileResult } from './manager.ts'
import { loadOpenProfiles, partitionFor, resolveProfileDir, saveOpenProfiles } from './registry.ts'

/** The Host runtime behind a profile window, with the URL that window loads. */
export interface PlusProfileHost extends ProfileHostHandle {
	/** The loopback URL this profile's own Host serves. */
	readonly url: string
}

/** Live window facts of one profile window. */
export interface ProfileWindowState {
	/** The window is on screen and not minimized. */
	readonly visible: boolean
	/** The window holds the keyboard focus. */
	readonly focused: boolean
}

/** One open profile's Electron state: its window and the way to relaunch its Host. */
type ProfileState = {
	readonly window: BrowserWindow
	/** Stops the running Host and starts a new one, reporting the new URL. */
	readonly relaunchHost: () => Promise<string>
}

/** The official shell's seams; everything below them is plus-owned. */
export interface ElectronProfileRuntimeDeps {
	/** The Electron app; the runtime installs its own quit hook on it. */
	readonly app: Pick<App, 'getPath' | 'on'>
	/** The Harness home that holds every profile directory. */
	readonly dshHome: string
	/** Start the Host runtime of one profile and report the URL it serves. */
	readonly createHost: (name: string, profileDir: string) => Promise<PlusProfileHost>
	/** The directory that holds the open-profile file. */
	readonly userDataDir: string
	/** Called after the open profile set changed, so the shell can refresh its surfaces. */
	readonly onChanged?: () => void
}

/** The profile runtime the official shell drives. */
export interface ElectronProfileRuntime {
	/** The profile lifecycle: open, hide, quit, restore, and dispose. */
	readonly manager: ProfileManager
	/** Opens a profile and reports the changed profile set to the shell. */
	openProfile(name: string): Promise<ProfileEntry>
	/** Quits a profile and reports the changed profile set to the shell. */
	quitProfile(name: string): Promise<QuitProfileResult>
	/** Live window facts of one profile; undefined when the profile is not open. */
	windowState(name: string): ProfileWindowState | undefined
	/** Shows and focuses one open profile's window. */
	showProfile(name: string): void
	/** Restarts one open profile: its Host tree relaunches and the window loads the new Host. */
	restartProfile(name: string): Promise<void>
	/** Reopen the profiles that were open when the application last exited. */
	restoreAtStartup(): Promise<void>
	/** Record the open profile set so the next start restores it. */
	saveBeforeQuit(): void
	/** Stop every Host runtime this runtime started. */
	dispose(): Promise<void>
}

/**
 * Build the Electron profile runtime: a window and a Host runtime per profile,
 * with the open set persisted across restarts. Every change of the open profile
 * set is reported through `deps.onChanged`, so the shell can refresh its surfaces.
 * @param deps The official shell's Electron and Host seams.
 * @returns The runtime that owns the plus profiles.
 */
export function createElectronProfileRuntime(deps: ElectronProfileRuntimeDeps): ElectronProfileRuntime {
	const openProfilesFile = join(deps.userDataDir, 'plus-profiles.json')
	const states = new Map<string, ProfileState>()
	const changed = (): void => { deps.onChanged?.() }

	const launchHost = async (name: string): Promise<PlusProfileHost> =>
		deps.createHost(name, resolveProfileDir(deps.dshHome, name))

	const createProfile = async (name: string): Promise<ProfileHandles> => {
		const partition = partitionFor(name)
		// The partition is claimed before the window exists, so no profile lands on the default session.
		session.fromPartition(partition)
		const window = new BrowserWindow({
			title: `DeepSeek Harness — ${name}`,
			webPreferences: { partition, contextIsolation: true, nodeIntegration: false },
		})
		window.on('close', (event) => {
			// Closing a profile window only hides it; the Host runtime keeps running behind it.
			event.preventDefault()
			window.hide()
		})
		let host: PlusProfileHost | undefined
		const stopHost = async (): Promise<void> => {
			const running = host
			host = undefined
			await running?.stop()
		}
		const relaunchHost = async (): Promise<string> => {
			// The Host tree goes down first: the new Host claims a fresh port.
			await stopHost()
			const next = await launchHost(name)
			host = next
			return next.url
		}
		try {
			const launched = await launchHost(name)
			host = launched
			await window.loadURL(launched.url)
			states.set(name, { window, relaunchHost })
			return { window, host: { stop: stopHost } }
		} catch (error) {
			// A profile that never got a Host leaves no window behind.
			window.destroy()
			throw error
		}
	}

	const manager = createProfileManager({
		createProfile,
		hideWindow: (window) => { window.hide() },
	})

	const saveBeforeQuit = (): void => {
		saveOpenProfiles(openProfilesFile, manager.list().map((entry) => entry.name))
	}

	const openProfile = async (name: string): Promise<ProfileEntry> => {
		const entry = await manager.open(name)
		changed()
		return entry
	}

	const quitProfile = async (name: string): Promise<QuitProfileResult> => {
		const result = await manager.quitProfile(name)
		if (result.ok) {
			// A quit leaves no window behind: the profile is gone, so its window goes with it.
			const state = states.get(name)
			states.delete(name)
			if (state !== undefined && !state.window.isDestroyed()) state.window.destroy()
		}
		changed()
		return result
	}

	const windowState = (name: string): ProfileWindowState | undefined => {
		const state = states.get(name)
		if (state === undefined) return undefined
		const window = state.window
		if (window.isDestroyed()) return undefined
		return { visible: window.isVisible() && !window.isMinimized(), focused: window.isFocused() }
	}

	const showProfile = (name: string): void => {
		const state = states.get(name)
		if (state === undefined) return
		const window = state.window
		if (window.isDestroyed()) return
		window.show()
		window.focus()
	}

	const restartProfile = async (name: string): Promise<void> => {
		const state = states.get(name)
		if (state === undefined) throw new Error(`dsh desktop: the plus profile ${name} is not open`)
		const url = await state.relaunchHost()
		state.window.hide()
		await state.window.loadURL(url)
	}

	const restoreAtStartup = async (): Promise<void> => {
		const result = await manager.restore(loadOpenProfiles(openProfilesFile))
		for (const failure of result.failed) {
			console.error(`plus profile ${failure.name} could not be restored: ${failure.error}`)
		}
		changed()
	}

	// The quit hook is installed once: a second installation would write the open set twice per quit.
	let quitHookInstalled = false
	const installQuitHook = (): void => {
		if (quitHookInstalled) return
		quitHookInstalled = true
		deps.app.on('before-quit', () => { saveBeforeQuit() })
	}
	installQuitHook()

	return {
		manager,
		openProfile,
		quitProfile,
		windowState,
		showProfile,
		restartProfile,
		restoreAtStartup,
		saveBeforeQuit,
		dispose: async (): Promise<void> => { await manager.dispose() },
	}
}
