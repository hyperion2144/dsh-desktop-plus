/** Electron seam: one window and one Host runtime per plus profile. */

import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { App } from 'electron'
import { createProfileManager } from './manager.ts'
import type { ProfileEntry, ProfileHandles, ProfileHostHandle, ProfileManager, QuitProfileResult } from './manager.ts'
import { loadOpenProfiles, partitionFor, resolveProfileDir, saveOpenProfiles } from './registry.ts'
import { loadDesktopSettings, saveDesktopSettings } from '../rpc/desktop-settings.ts'

/** The Host runtime behind a profile window, with the URL that window loads. */
export interface PlusProfileHost extends ProfileHostHandle {
	/** The loopback URL this profile's own Host serves. */
	readonly url: string
	/** The address to hit first so the partition session stores the auth/pairing cookie; the saved remote address carrying the token. */
	readonly authUrl?: string
}

/** Live window facts of one profile window. */
export interface ProfileWindowState {
	/** The window is on screen and not minimized. */
	readonly visible: boolean
	/** The window holds the keyboard focus. */
	readonly focused: boolean
}

/** One open profile's Electron state: its window. */
type ProfileState = {
	readonly window: BrowserWindow
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
	/** #8：用官方 createWindow 造 profile 窗口（preload/chrome/DevTools/console 全套）；name 用于会话隔离与日志标识。 */
	readonly createWindow?: (name: string) => BrowserWindow
	/** Structured shell log sink (plusLogger.append); the runtime never uses console. */
	readonly log?: (line: string) => void
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
	/** Restarts one open profile: the Host tree stops and a rebuilt window walks the full open flow. */
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
		// #8：官方 createWindow 流程（preload/桌面 chrome/DevTools/console 采集）；未提供时退回裸窗口（测试）。
		const window = deps.createWindow !== undefined ? deps.createWindow(name) : new BrowserWindow({
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
		try {
			const launched = await launchHost(name)
			host = launched
			await window.loadURL(launched.url)
			// 认证语义：配对凭据（deviceId + cookie）都持久化——deviceId 在 dsh home 的设置里，
			// cookie 在 profile 的 partition 里，lane 端 devices 表也持久。地址不变就永远可用：
			// cookie 有效直接复用；被门禁挡（unpaired JSON）→ 先凭 deviceId 走 renew 换 cookie，
			// 从未配对过才退回地址里的 token 走 accept；cookie 用 cookies.set 即时落盘后重载。
			if (launched.authUrl !== undefined) {
				const gated = await window.webContents.executeJavaScript(
					`document.body === null ? '' : String(document.body.innerText).slice(0, 200)`, true,
				).then((text): string => (typeof text === 'string' ? text : '')).catch((error: unknown): string => {
					deps.log?.(`[remote] gate probe error: ${String(error)}`)
					return ''
				})
				const blocked = gated.includes('"unpaired"')
				deps.log?.(`[remote] gate probe ${launched.url} blocked=${String(blocked)} body=${gated}`)
				if (blocked) {
					const target = new URL(launched.authUrl)
					const lane = `${target.origin}/__dsh-mobile/api/pair`
					const token = target.searchParams.get('token') ?? ''
					const raw = deps.dshHome === undefined ? undefined : loadDesktopSettings(deps.dshHome)['remote_device_ids']
					const ids = typeof raw === 'object' && raw !== null && Object.values(raw).every((v) => typeof v === 'string')
						? raw as Record<string, string>
						: {}
					const known = ids[launched.authUrl] ?? null
					deps.log?.(`[remote] pairing: known deviceId=${known === null ? 'none' : 'present'} token=${token === '' ? 'absent' : 'present'}`)
					let setCookieLine: string | null = null
					let deviceId: string | null = known
					if (known !== null) {
						const renewed = await fetch(`${lane}/renew`, {
							method: 'POST', headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ deviceId: known }),
						}).catch((error: unknown) => {
							deps.log?.(`[remote] renew error: ${String(error)}`)
							return null
						})
						setCookieLine = renewed?.headers.getSetCookie?.().find((c) => c.startsWith('dsh_mobile_session=')) ?? null
						deps.log?.(`[remote] renew: HTTP ${String(renewed?.status ?? 'no-response')} cookie=${setCookieLine === null ? 'none' : 'obtained'}`)
					}
					if (setCookieLine === null && token !== '') {
						const accepted = await fetch(`${lane}/accept`, {
							method: 'POST', headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ token, name: '桌面壳' }),
						}).catch((error: unknown) => {
							deps.log?.(`[remote] accept error: ${String(error)}`)
							return null
						})
						setCookieLine = accepted?.headers.getSetCookie?.().find((c) => c.startsWith('dsh_mobile_session=')) ?? null
						deps.log?.(`[remote] accept: HTTP ${String(accepted?.status ?? 'no-response')} cookie=${setCookieLine === null ? 'none' : 'obtained'}`)
						if (accepted !== null && deviceId === null) {
							const body: unknown = await accepted.json().catch(() => null)
							deviceId = typeof body === 'object' && body !== null && typeof (body as { deviceId?: unknown }).deviceId === 'string'
								? (body as { deviceId: string }).deviceId
								: null
						}
					}
					if (setCookieLine !== null) {
						const pair = setCookieLine.split(';')[0] ?? ''
						const eq = pair.indexOf('=')
						// cookie 必须落在整站作用域（path=/）：用带 /pair 的完整地址注入会把 path 派生
						// 成 /pair，访问 / 时永远带不上、cookies.get 也查不到。
						await window.webContents.session.cookies.set({
							url: `${new URL(launched.authUrl).origin}/`, path: '/', name: pair.slice(0, eq), value: pair.slice(eq + 1), httpOnly: true,
						})
						if (deviceId !== null && deps.dshHome !== undefined) {
							saveDesktopSettings(deps.dshHome, { remote_device_ids: { ...ids, [launched.authUrl]: deviceId } })
						}
						deps.log?.('[remote] cookie injected into the profile session')
					} else {
						deps.log?.('[remote] no cookie obtained; reloading origin as-is')
					}
					await window.loadURL(launched.url)
				}
			}
			// #③：profile 窗口建好就显示（否则只能从托盘点「显示」才看得到）。
			window.show()
			states.set(name, { window })
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
		// #10：profile 重启 = 销毁旧窗口 → 停掉该 profile 的 dsh 进程树 → 走与 profile 启动
		// 完全相同的窗口流程（官方 createWindow：preload/桌面 chrome/DevTools/console）。
		const state = states.get(name)
		if (state === undefined) throw new Error(`dsh desktop: the plus profile ${name} is not open`)
		if (!state.window.isDestroyed()) state.window.destroy()
		states.delete(name)
		// 旧进程树必须经 manager 停掉并注销，再走完整 open 流程重新注册；绕过 manager 会泄漏 Host。
		const quit = await manager.quitProfile(name)
		if (!quit.ok) {
			const detail = quit.reason === 'host-stop-failed' ? quit.error : quit.reason
			throw new Error(`dsh desktop: the plus profile ${name} could not be restarted: ${detail}`)
		}
		await manager.open(name)
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
