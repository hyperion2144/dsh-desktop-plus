/** Electron profile runtime: partitions, window lifecycle, restore, and quit persistence. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElectronProfileRuntime } from '../src/profiles/electron.ts'

const native = vi.hoisted(() => {
	const windows: FakeWindow[] = []
	const partitions: string[] = []
	class FakeWindow {
		readonly loaded: string[] = []
		hidden = 0
		shown = 0
		focused = 0
		visible = false
		hasFocus = false
		minimized = false
		destroyed = false
		closePrevented = 0
		private readonly closeListeners: ((event: { preventDefault(): void }) => void)[] = []
		constructor(readonly options: FakeWindowOptions) {
			windows.push(this)
		}
		on(event: string, listener: (event: { preventDefault(): void }) => void): void {
			if (event === 'close') this.closeListeners.push(listener)
		}
		hide(): void {
			this.hidden += 1
			this.visible = false
		}
		show(): void {
			this.shown += 1
			this.visible = true
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
		close(): void {
			this.emitClose()
		}
		isDestroyed(): boolean {
			return this.destroyed
		}
		destroy(): void {
			this.destroyed = true
		}
		async loadURL(url: string): Promise<void> {
			this.loaded.push(url)
		}
		emitClose(): void {
			const event = { preventDefault: () => { this.closePrevented += 1 } }
			for (const listener of this.closeListeners) listener(event)
		}
	}
	return { windows, partitions, FakeWindow }
})

vi.mock('electron', () => ({
	BrowserWindow: native.FakeWindow,
	session: {
		fromPartition: vi.fn((partition: string) => {
			native.partitions.push(partition)
			return { partition }
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
		app.getPath.mockClear()
		app.on.mockClear()
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	function runtime(options: { failOn?: (name: string) => boolean, urlOf?: (name: string, attempt: number) => string } = {}, onChanged?: () => void) {
		const hosts: string[] = []
		const stopped: string[] = []
		let launches = 0
		const created = createElectronProfileRuntime({
			app,
			dshHome,
			createHost: async (name, profileDir) => {
				hosts.push(`${name}:${profileDir}`)
				if (options.failOn?.(name) === true) throw new Error(`host failed: ${name}`)
				const attempt = launches
				launches += 1
				return {
					url: options.urlOf?.(name, attempt) ?? `http://127.0.0.1:7777/${name}`,
					stop: async () => { stopped.push(name) },
				}
			},
			userDataDir,
			...(onChanged === undefined ? {} : { onChanged }),
		})
		return { created, hosts, stopped }
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
		expect(window.loaded).toEqual(['http://127.0.0.1:7777/work'])
		// #③：窗口建好即显示（此前只能从托盘点「显示」才看得到）。
		expect(window.shown).toBe(1)
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

	it('hides a profile window on request', async () => {
		const { created } = runtime()
		await created.manager.open('work')
		expect(created.manager.hideOrClose('work')).toBe(true)
		expect(native.windows[0]!.hidden).toBe(1)
	})

	it('reopens the profiles recorded by the last run', async () => {
		writeOpenSet(['work', 'play'])
		const { created, hosts } = runtime()
		await created.restoreAtStartup()
		expect(created.manager.list().map((entry) => entry.name)).toEqual(['work', 'play'])
		expect(hosts).toEqual([
			`work:${join(dshHome, 'profiles', 'work')}`,
			`play:${join(dshHome, 'profiles', 'play')}`,
		])
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
		const { created, stopped, hosts } = runtime({ urlOf: (name, attempt) => `http://127.0.0.1:${7777 + attempt}/${name}` })
		await created.openProfile('work')
		await created.restartProfile('work')
		expect(stopped).toEqual(['work'])
		expect(hosts).toEqual([
			`work:${join(dshHome, 'profiles', 'work')}`,
			`work:${join(dshHome, 'profiles', 'work')}`,
		])
		// #10: the old window is torn down; the replacement walks the full open flow again.
		expect(native.windows[0]!.destroyed).toBe(true)
		expect(native.windows[1]!.loaded).toEqual(['http://127.0.0.1:7778/work'])
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
