/** Electron seam: one window and one Host runtime per plus profile. */

import { join } from 'node:path'
import { BrowserWindow, session } from 'electron'
import type { App } from 'electron'
import { createProfileManager } from './manager.ts'
import type { ProfileEntry, ProfileHandles, ProfileManager, QuitProfileResult } from './manager.ts'
import { loadOpenProfiles, partitionFor, remoteProfileName, saveOpenProfiles } from './registry.ts'
import { remoteOrigin } from './remote.ts'
import { loadDesktopSettings, loadRemoteOrigins, saveDesktopSettings } from '../rpc/desktop-settings.ts'
import { plusFocusSessionScript } from '../notify-open.ts'
import type { ConfiguredFetch } from '../net/configured-fetch.ts'

import { observeWindowVisibility, type WindowVisibilityEvent } from '../tray/window-visibility.ts'

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
	/**
	 * 本地 profile 的 Host 生命周期入口（官方壳的 backend 工厂）：启动 Host、登记 binding、
	 * 装载 `dsh-app://profile-<name>/`；plus 不再自己解析目录或装配 Host。
	 */
	readonly openHost: (name: string, window: BrowserWindow) => Promise<void>
	/** 停掉一个本地 profile 的 Host（退出/重启/失败清理）。 */
	readonly closeHost: (name: string) => Promise<void>
	/** The directory that holds the open-profile file. */
	readonly userDataDir: string
	/** Called after the open profile set changed, so the shell can refresh its surfaces. */
	readonly onChanged?: () => void
	/** Every visibility transition of an open profile window, so the shell can refresh its tray. */
	readonly onWindowVisibilityChanged?: (name: string, event: WindowVisibilityEvent) => void
	/** #8：用官方 createWindow 造 profile 窗口（preload/chrome/DevTools/console 全套）；name 用于会话隔离与日志标识。 */
	readonly createWindow?: (name: string) => BrowserWindow
	/** Structured shell log sink (plusLogger.append); the runtime never uses console. */
	readonly log?: (line: string) => void
	/** The shell's configured HTTP entry point; pairing must use the same proxy answer as the Host. */
	readonly configuredFetch?: ConfiguredFetch
	/** 官方壳侧的 profile Host 登记清理；退出、重启与打开失败路径都调。 */
	readonly unbindProfileHost: (name: string) => void
	/** 退出前看一眼该 profile 的活动任务（官方壳的 quit-inspection）。 */
	readonly inspectHost?: (name: string) => Promise<{ readonly activeTasks: boolean } | undefined>
	/** 有活动任务时由壳弹确认；返回 false 表示用户取消。 */
	readonly confirmQuit?: (name: string, activeTasks: boolean) => Promise<boolean>
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
	/**
	 * Focus one open profile's window and route its page to a session (#116 通知直通)：
	 * restore + show + focus，再在页面里调 __dshPlusFocusSession(sessionId)。
	 * @returns false when the profile window does not exist (caller falls back to the default window).
	 */
	focusProfileSession(name: string, sessionId: string): boolean
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
	// 配对请求走壳的统一 HTTP 入口：与宿主子进程同一份代理答案，命中系统绕过表的目标直连。
	const shellFetch: ConfiguredFetch = deps.configuredFetch ?? ((input, init) => fetch(input, init))
	const states = new Map<string, ProfileState>()
	const changed = (): void => { deps.onChanged?.() }

	/** 远程 profile 的地址（本地 profile 返回 undefined，Host 由官方壳的 backend 工厂启动）。 */
	const remoteAddressOf = (name: string): string | undefined =>
		loadRemoteOrigins(deps.dshHome).find((url) => remoteProfileName(url) === name)


	const createProfile = async (name: string): Promise<ProfileHandles> => {
		const partition = partitionFor(name)
		// The partition is claimed before the window exists, so no profile lands on the default session.
		session.fromPartition(partition)
		// #125：窗口身份由窗口自己声明（官方 createWindow 把窗口角色写进 preload 参数），
		// 不再给分区注册「本地窗口」标记 preload——页面来源不再是桌面能力的判据。
		// #8：官方 createWindow 流程（preload/桌面 chrome/DevTools/console 采集）；未提供时退回裸窗口（测试）。
		const window = deps.createWindow !== undefined ? deps.createWindow(name) : new BrowserWindow({
			title: `DeepSeek Harness — ${name}`,
			webPreferences: { partition, contextIsolation: true, nodeIntegration: false },
		})
		// 窗口一建好就登记：凭据签名与重载刷新都按它找窗口。
		states.set(name, { window })
		// 可见性变化统一从这里上报：绑定在运行时创建窗口的地方，壳侧的兜底窗口也一并覆盖。
		observeWindowVisibility(window, (event) => {
			deps.onWindowVisibilityChanged?.(name, event)
		})
		window.on('close', (event) => {
			// Closing a profile window only hides it; the Host runtime keeps running behind it.
			event.preventDefault()
			window.hide()
		})
		try {
			const remoteUrl = remoteAddressOf(name)
			if (remoteUrl === undefined) {
				// 本地 profile：Host 生命周期完全在官方壳里（backend 工厂 + binding + 装载）。
				await deps.openHost(name, window)
			} else {
				const launched = { url: remoteOrigin(remoteUrl), authUrl: remoteUrl }
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
						const renewed = await shellFetch(`${lane}/renew`, {
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
						const accepted = await shellFetch(`${lane}/accept`, {
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
			}
			// #③：profile 窗口建好就显示（否则只能从托盘点「显示」才看得到）。
			window.show()
			return { window, host: { stop: async () => { await deps.closeHost(name) } } }
		} catch (error) {
			// A profile that never got a Host leaves no window, no binding, and no state behind.
			deps.unbindProfileHost(name)
			states.delete(name)
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
		// 与产品窗口同一套退出确认：有活动任务时先问，用户取消就不停。
		const inspection = await deps.inspectHost?.(name)
		if (inspection?.activeTasks === true) {
			const approved = await deps.confirmQuit?.(name, true) ?? false
			if (!approved) return { ok: false, reason: 'cancelled' }
		}
		const result = await manager.quitProfile(name)
		if (result.ok) {
			// A quit leaves no window behind: the profile is gone, so its window and binding go with it.
			deps.unbindProfileHost(name)
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
		// 最小化在 windowState 里也算不可见：托盘点「显示」必须把窗口还原，
		// 不能只 show() 把最小化窗口留在任务栏里（一次点击就该唤回）。
		if (window.isMinimized()) window.restore()
		window.show()
		window.focus()
	}

	const focusProfileSession = (name: string, sessionId: string): boolean => {
		const state = states.get(name)
		if (state === undefined || state.window.isDestroyed()) return false
		showProfile(name)
		// #116 通知直通：页面全局由 plus 插件客户端注册（notify/jump.ts，openSession 幂等）。
		// 失败不静默：窗口刚恢复/页面未就绪时跳转可能丢，日志是唯一能看出断在哪的地方。
		if (sessionId !== '') {
			void state.window.webContents.executeJavaScript(plusFocusSessionScript(sessionId)).catch((error: unknown) => {
				deps.log?.(`plus-open: executeJavaScript failed (profile=${name}): ${String(error)}`)
			})
		}
		return true
	}
	const restartProfile = async (name: string): Promise<void> => {
		// #10：profile 重启 = 销毁旧窗口 → 停掉该 profile 的 dsh 进程树 → 走与 profile 启动
		// 完全相同的窗口流程（官方 createWindow：preload/桌面 chrome/DevTools/console）。
		const state = states.get(name)
		if (state === undefined) throw new Error(`dsh desktop: the plus profile ${name} is not open`)
		// 与 quitProfile 同一套预检：有活动任务时先问，取消就不重启。
		const inspection = await deps.inspectHost?.(name)
		if (inspection?.activeTasks === true) {
			const approved = await deps.confirmQuit?.(name, true) ?? false
			if (!approved) return
		}
		if (!state.window.isDestroyed()) state.window.destroy()
		states.delete(name)
		// 旧 binding 随旧窗口作废；重新 open 时会按新 Host 事实重新登记。
		deps.unbindProfileHost(name)
		// 旧进程树必须经 manager 停掉并注销，再走完整 open 流程重新注册；绕过 manager 会泄漏 Host。
		const quit = await manager.quitProfile(name)
		if (!quit.ok) {
			const detail = quit.reason === 'host-stop-failed' ? quit.error : quit.reason
			throw new Error(`dsh desktop: the plus profile ${name} could not be restarted: ${detail}`)
		}
		await manager.open(name)
		// 与 openProfile 同一套：重启后托盘也要看到新的窗口/端口状态。
		changed()
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
		focusProfileSession,
		restartProfile,
		restoreAtStartup,
		saveBeforeQuit,
		dispose: async (): Promise<void> => { await manager.dispose() },
	}
}

