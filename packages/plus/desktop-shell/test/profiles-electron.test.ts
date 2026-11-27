/** Electron profile runtime: partitions, window lifecycle, restore, and quit persistence. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronProfileRuntime } from '../src/profiles/electron.ts'

const native = vi.hoisted(() => {
	const windows: FakeWindow[] = []
	const partitions: string[] = []
	const webRequests: { onBeforeSendHeaders: ReturnType<typeof vi.fn> }[] = []
	const sessions = new Map<string, { webRequest: { onBeforeSendHeaders: ReturnType<typeof vi.fn> } }>()
	class FakeWindow {
		readonly loaded: string[] = []
		hidden = 0
		shown = 0
		restored = 0
		focused = 0
		visible = false
		hasFocus = false
		minimized = false
		destroyed = false
		closePrevented = 0
		private readonly listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>()
		readonly rendererId: number
		constructor(readonly options: FakeWindowOptions) {
			this.rendererId = windows.length
			windows.push(this)
		}
		on(event: string, listener: (event: { preventDefault(): void }) => void): void {
			const list = this.listeners.get(event) ?? []
			list.push(listener)
			this.listeners.set(event, list)
		}
		hide(): void {
			this.hidden += 1
			this.visible = false
			this.emit('hide')
		}
		show(): void {
			this.shown += 1
			this.visible = true
			this.emit('show')
		}
		focus(): void {
			this.focused += 1
			this.hasFocus = true
		}
		isVisible(): boolean {
			return this.visible
		}
		isFocused(): boolean {
			return this.hasFocus
		}
		isMinimized(): boolean {
			return this.minimized
		}
		restore(): void {
			this.minimized = false
			this.restored += 1
			this.emit('restore')
		}

		minimize(): void {
			this.minimized = true
			this.emit('minimize')
		}
		close(): void {
			this.emitClose()
		}
		isDestroyed(): boolean {
			return this.destroyed
		}
		destroy(): void {
			this.destroyed = true
		}
		/** Renderer identity and session the Host credential is scoped to. */
		get webContents(): { id: number, executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>, session: { webRequest: { onBeforeSendHeaders: ReturnType<typeof vi.fn> } } } {
			return {
				id: this.rendererId,
				// 远程 ensure 链会探一次页面正文；测试里统一回空串（不触发配对分支）。
				executeJavaScript: async () => '',
				session: native.sessions.get(this.options.webPreferences?.partition ?? '')
					?? { webRequest: { onBeforeSendHeaders: vi.fn() } },
			}
		}
		async loadURL(url: string): Promise<void> {
			this.loaded.push(url)
		}
		emit(event: string): void {
			const payload = { preventDefault: () => { this.closePrevented += 1 } }
			for (const listener of this.listeners.get(event) ?? []) listener(payload)
		}

		emitClose(): void {
			this.emit('close')
		}
	}
	return { windows, partitions, webRequests, sessions, FakeWindow, registerPreloadScript: vi.fn(), unregisterPreloadScript: vi.fn(() => { throw new Error('plus preload id not registered yet') }) }
})

vi.mock('electron', () => ({
	BrowserWindow: native.FakeWindow,
	session: {
		fromPartition: vi.fn((partition: string) => {
			native.partitions.push(partition)
			const webRequest = { onBeforeSendHeaders: vi.fn() }
			native.webRequests.push(webRequest)
			const created = {
				partition,
				webRequest,
				registerPreloadScript: native.registerPreloadScript,
				unregisterPreloadScript: native.unregisterPreloadScript,
			}
			native.sessions.set(partition, created)
			return created
		}),
	},
}))

interface FakeWindowOptions {
	readonly title?: string
	readonly webPreferences?: {
		readonly partition?: string
		readonly contextIsolation?: boolean
		readonly nodeIntegration?: boolean
	}
}

const app = {
	getPath: vi.fn((name: string) => `/tmp/${name}`),
	on: vi.fn(),
}

describe('createElectronProfileRuntime', () => {
	let dir = ''
	let dshHome = ''
	let userDataDir = ''

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dsh-plus-profiles-electron-'))
		dshHome = join(dir, 'home')
		userDataDir = join(dir, 'userData')
		native.windows.length = 0
		native.partitions.length = 0
		native.webRequests.length = 0
		native.sessions.clear()
		app.getPath.mockClear()
		app.on.mockClear()
		native.registerPreloadScript.mockClear()
		native.unregisterPreloadScript.mockClear()
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	function runtime(
		options: {
			failOn?: (name: string) => boolean
			authUrlOf?: (name: string) => string | undefined
		} = {},
		onChanged?: () => void,
		onWindowVisibilityChanged?: (name: string, event: string) => void,
	) {
		const opened: string[] = []
		const stopped: string[] = []
		const unbound: string[] = []
		const created = createElectronProfileRuntime({
			app,
			dshHome,
			// 本地 profile 的 Host 生命周期在官方壳里：plus 只负责窗口与装载。
			openHost: async (name, window) => {
				if (options.failOn?.(name) === true) throw new Error(`host failed: ${name}`)
				opened.push(name)
				await window.loadURL(`dsh-app://profile-${name}/`)
			},
			closeHost: async (name) => { stopped.push(name) },
			userDataDir,
			unbindProfileHost: (name) => { unbound.push(name) },
			...(onChanged === undefined ? {} : { onChanged }),
			...(onWindowVisibilityChanged === undefined ? {} : { onWindowVisibilityChanged }),
		})
		return { created, opened, stopped, unbound }
	}

	function writeOpenSet(names: readonly string[]): void {
		mkdirSync(userDataDir, { recursive: true })
		writeFileSync(join(userDataDir, 'plus-profiles.json'), JSON.stringify({ version: 1, open: names }), 'utf8')
	}

	it('opens a profile in its own session partition', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		expect(native.partitions).toEqual(['persist:plus-work'])
		const window = native.windows[0]!
		expect(window.options.title).toBe('DeepSeek Harness — work')
		expect(window.options.webPreferences).toEqual({
			partition: 'persist:plus-work',
			contextIsolation: true,
			nodeIntegration: false,
		})
		expect(window.loaded).toEqual(['dsh-app://profile-work/'])
		// #③：窗口建好即显示（此前只能从托盘点「显示」才看得到）。
		expect(window.shown).toBe(1)
	})

	it('opens the local profile through the shell seam and loads the dsh-app document (#140)', async () => {
		const { created, opened } = runtime()
		await created.manager.open('work')
		const window = native.windows[0]!
		// 本地 profile 的 Host 生命周期在官方壳里：plus 只调 openHost，页面走 dsh-app://profile-<name>/。
		expect(opened).toEqual(['work'])
		expect(window.loaded).toEqual(['dsh-app://profile-work/'])
		// plus 不再装任何 webRequest 监听：直连签名与代理都在官方壳里。
		expect(native.webRequests.map((webRequest) => webRequest.onBeforeSendHeaders.mock.calls.length)).toEqual([0])
	})

	it('restarts through closeHost + openHost and unbinds in between (#140)', async () => {
		const { created, opened, stopped, unbound } = runtime()
		await created.openProfile('work')
		await created.restartProfile('work')
		// 重启 = 旧 Host 经 closeHost 停掉 + 重新 open 走 openHost。
		expect(stopped).toEqual(['work'])
		expect(opened).toEqual(['work', 'work'])
		expect(unbound).toEqual(['work'])
	})

	it('unbinds a profile whose Host never started, leaving no window or binding behind (#140)', async () => {
		const { created, unbound } = runtime({ failOn: (name) => name === 'broken' })
		await expect(created.manager.open('broken')).rejects.toThrow('host failed: broken')
		expect(unbound).toEqual(['broken'])
		expect(created.windowState('broken')).toBeUndefined()
	})

	it('destroys the window and unbinds when the Host opens but the page fails to load (#140)', async () => {
		// openHost 在「Host 已起来、页面装载失败」时抛：窗口必须销毁、binding 必须清掉。
		const { created, unbound } = runtime({ failOn: (name) => name === 'broken' })
		await expect(created.manager.open('broken')).rejects.toThrow('host failed: broken')
		expect(unbound).toEqual(['broken'])
		expect(created.windowState('broken')).toBeUndefined()
		expect(native.windows[0]!.destroyed).toBe(true)
	})

	it('loads a remote profile from its origin as-is and never opens a local host (#140)', async () => {
		// 远程 profile 的地址来自远程访问插件已配对的主机（Host 不在本机）。
		mkdirSync(join(dshHome, 'storages', 'remote-access'), { recursive: true })
		writeFileSync(join(dshHome, 'storages', 'remote-access', 'remote-hosts.json'), JSON.stringify({ hosts: [{ origin: 'https://remote.example' }] }), 'utf8')
		const { created, opened, unbound } = runtime()
		await created.manager.open('remote-remote-example')
		const window = native.windows[0]!
		// 远程分支一行不动：裸 origin 装载，配对在窗口侧 ensure 链里做。
		expect(window.loaded).toEqual(['https://remote.example'])
		expect(opened).toEqual([])
		expect(unbound).toEqual([])
	})
	it('leaves window identity to the window instead of a session marker preload (#125)', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		await created.restartProfile('work')
		expect(native.registerPreloadScript).not.toHaveBeenCalled()
		expect(native.unregisterPreloadScript).not.toHaveBeenCalled()
		expect(existsSync(join(userDataDir, 'plus-preloads'))).toBe(false)
	})

	it('hides the window instead of closing it, and keeps the host running', async () => {
		const { created, stopped } = runtime()
		await created.manager.open('work')
		const window = native.windows[0]!
		window.emitClose()
		expect(window.closePrevented).toBe(1)
		expect(window.hidden).toBe(1)
		expect(stopped).toEqual([])
	})

	it('reports every visibility transition of a profile window to the shell', async () => {
		const seen: string[] = []
		const { created } = runtime({}, undefined, (name, event) => { seen.push(`${name}:${event}`) })
		await created.manager.open('work')
		seen.length = 0 // the open flow shows the window once; count only the tray interactions below
		const window = native.windows[0]!
		window.emitClose() // the close button: preventDefault + hide()
		window.minimize()
		created.showProfile('work') // restore() → restore, then show() → show
		expect(seen).toEqual(['work:hide', 'work:minimize', 'work:restore', 'work:show'])
	})

	it('keeps visibility transitions out of the open-set change and its persistence', async () => {
		const changed = vi.fn()
		const visibility = vi.fn()
		const { created } = runtime({}, changed, visibility)
		await created.openProfile('work')
		expect(changed).toHaveBeenCalledTimes(1)
		const window = native.windows[0]!
		window.emitClose()
		window.minimize()
		created.showProfile('work')
		expect(visibility).toHaveBeenCalled()
		expect(changed).toHaveBeenCalledTimes(1)
		expect(existsSync(join(userDataDir, 'plus-profiles.json'))).toBe(false)
	})

	it('hides a profile window on request', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		expect(created.manager.hideOrClose('work')).toBe(true)
		expect(native.windows[0]!.hidden).toBe(1)
	})

	it('restores a minimized window when the tray shows it', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		const window = native.windows[0]!
		window.minimized = true
		window.visible = false
		created.showProfile('work')
		expect(window.minimized).toBe(false)
		expect(window.restored).toBe(1)
		expect(window.visible).toBe(true)
		expect(window.focused).toBe(1)
	})

	it('reopens the profiles recorded by the last run', async () => {
		writeOpenSet(['work', 'play'])
		const { created, opened } = runtime()
		await created.restoreAtStartup()
		expect(created.manager.list().map((entry) => entry.name)).toEqual(['work', 'play'])
		expect(opened).toEqual(['work', 'play'])
	})

	it('starts with no profile when the last run recorded none', async () => {
		const { created } = runtime()
		await created.restoreAtStartup()
		expect(created.manager.list()).toEqual([])
	})

	it('writes the open set once when the application quits', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		expect(app.on).toHaveBeenCalledTimes(1)
		expect(app.on.mock.calls[0]![0]).toBe('before-quit')
		const file = join(userDataDir, 'plus-profiles.json')
		created.saveBeforeQuit()
		created.saveBeforeQuit()
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, open: ['work'] })
		const quit = app.on.mock.calls[0]![1] as () => void
		quit()
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, open: ['work'] })
	})

	it('records a host failure and leaves no window behind', async () => {
		const { created } = runtime({ failOn: (name) => name === 'broken' })
		await expect(created.manager.open('broken')).rejects.toThrow('host failed: broken')
		expect(created.manager.lastError('broken')?.message).toBe('host failed: broken')
		expect(created.manager.list()).toEqual([])
		expect(native.windows[0]!.destroyed).toBe(true)
	})

	it('keeps restoring after one profile fails', async () => {
		const reported = vi.spyOn(console, 'error').mockImplementation(() => { })
		writeOpenSet(['work', 'broken'])
		const { created } = runtime({ failOn: (name) => name === 'broken' })
		await expect(created.restoreAtStartup()).resolves.toBeUndefined()
		expect(created.manager.list().map((entry) => entry.name)).toEqual(['work'])
		expect(reported).toHaveBeenCalledWith('plus profile broken could not be restored: host failed: broken')
	})

	it('restarts a profile: the Host tree relaunches and a fresh window loads the new Host', async () => {
		const { created, stopped, opened } = runtime()
		await created.openProfile('work')
		await created.restartProfile('work')
		expect(stopped).toEqual(['work'])
		expect(opened).toEqual(['work', 'work'])
		// #10: the old window is torn down; the replacement walks the full open flow again.
		expect(native.windows[0]!.destroyed).toBe(true)
		expect(native.windows[1]!.loaded).toEqual(['dsh-app://profile-work/'])
		expect(created.manager.list().map((entry) => entry.name)).toEqual(['work'])
	})

	it('refuses to restart a profile that is not open', async () => {
		const { created } = runtime()
		await expect(created.restartProfile('work')).rejects.toThrow('the plus profile work is not open')
	})

	it('reports the window facts of an open profile', async () => {
		const { created } = runtime()
		await created.openProfile('work')
		// #③：窗口建好即显示；showProfile 只负责把焦点拉回来。
		expect(created.windowState('work')).toEqual({ visible: true, focused: false })
		created.showProfile('work')
		expect(created.windowState('work')).toEqual({ visible: true, focused: true })
		expect(created.windowState('missing')).toBeUndefined()
	})

	it('quits a profile and leaves no window behind', async () => {
		const { created, stopped } = runtime()
		await created.openProfile('work')
		await expect(created.quitProfile('work')).resolves.toEqual({ ok: true })
		expect(stopped).toEqual(['work'])
		expect(native.windows[0]!.destroyed).toBe(true)
		expect(created.manager.list()).toEqual([])
	})

	it('refuses to quit the desktop profile', async () => {
		const { created } = runtime()
		await expect(created.quitProfile('desktop')).resolves.toEqual({ ok: false, reason: 'default-profile-owned-by-shell' })
	})

	it('reports every change of the open profile set', async () => {
		const changed = vi.fn()
		const { created } = runtime({}, changed)
		await created.openProfile('work')
		expect(changed).toHaveBeenCalledTimes(1)
		await created.quitProfile('work')
		expect(changed).toHaveBeenCalledTimes(2)
	})

	it('reports the restored profile set', async () => {
		writeOpenSet(['work'])
		const changed = vi.fn()
		const { created } = runtime({}, changed)
		await created.restoreAtStartup()
		expect(changed).toHaveBeenCalledTimes(1)
	})

	it('stops every host it started', async () => {
		const { created, stopped } = runtime()
		await created.manager.open('work')
		await created.dispose()
		expect(stopped).toEqual(['work'])
		expect(created.manager.list()).toEqual([])
	})
})
