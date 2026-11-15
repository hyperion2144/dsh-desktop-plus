import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPlusMacosUpdateGate } from '../../src/updates/electron.ts'

vi.mock('electron', () => ({
	app: { getLocale: () => 'zh_CN', getPath: () => '/nonexistent' },
	dialog: {},
	shell: {},
	Notification: { isSupported: () => false },
}))

const adhocCodesign = 'flags=0x10002(adhoc,runtime)\nSignature=adhoc\nTeamIdentifier=not set\n'
const feedUrl = 'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/'
const version = '0.2.2-rc.3.plus.1'

function fixtureRoot(): string { return mkdtempSync(join(tmpdir(), 'plus-electron-gate-')) }

describe('createPlusMacosUpdateGate', () => {
	it('downloads and opens the dmg for ad-hoc bundles and vetoes the handoff', async () => {
		const root = fixtureRoot()
		const resources = join(root, 'resources')
		mkdirSync(resources)
		writeFileSync(join(resources, 'app-update.yml'), `provider: generic\nurl: ${feedUrl}\nchannel: nightly\n`)
		const userData = join(root, 'userData')
		const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => new Response('dmg-bytes', { status: 200 }))
		const openPath = vi.fn(async () => { })
		const showOutcome = vi.fn(async () => { })
		const gate = createPlusMacosUpdateGate({
			coordinator: () => ({ state: { phase: 'installing', version } }),
			runCodesign: async () => ({ stdout: '', stderr: adhocCodesign }),
			fetchImpl, openPath, showOutcome, notify: vi.fn(),
			resourcesPath: () => resources, userDataPath: () => userData, platform: 'darwin', arch: 'arm64',
		})
		await expect(gate()).resolves.toBe(false)
		const dmg = join(userData, 'manual-update', `dsh-desktop-plus-${version}-mac-arm64-unsigned.dmg`)
		expect(fetchImpl.mock.calls[0]?.[0]).toBe(`https://github.com/hyperion2144/dsh-desktop-plus/releases/download/v${version}/dsh-desktop-plus-${version}-mac-arm64-unsigned.dmg`)
		expect(existsSync(dmg)).toBe(true)
		expect(readFileSync(dmg, 'utf8')).toBe('dmg-bytes')
		expect(openPath).toHaveBeenCalledWith(dmg)
		expect(showOutcome).toHaveBeenCalledTimes(1)
	})

	it('keeps Developer-ID signed bundles on the official flow without fetching', async () => {
		const fetchImpl = vi.fn()
		const gate = createPlusMacosUpdateGate({
			coordinator: () => ({ state: { phase: 'ready', version: '1.0.0' } }),
			runCodesign: async () => ({ stdout: '', stderr: 'TeamIdentifier=ABCDEF1234\n' }), fetchImpl,
			platform: 'darwin', arch: 'arm64', resourcesPath: () => '/nonexistent', userDataPath: () => '/nonexistent',
		})
		await expect(gate()).resolves.toBe(true)
		expect(fetchImpl).not.toHaveBeenCalled()
	})

	it('treats a failing codesign run as unsigned and takes the manual path', async () => {
		const fetchImpl = vi.fn()
		const openPath = vi.fn(async () => { })
		const showOutcome = vi.fn(async (_outcome: unknown, _version: string) => { })
		const gate = createPlusMacosUpdateGate({
			coordinator: () => ({ state: { phase: 'ready', version: '1.0.0' } }),
			runCodesign: async () => { throw new Error('spawn codesign ENOENT') },
			fetchImpl, openPath, showOutcome, notify: vi.fn(),
			resourcesPath: () => '/nonexistent', userDataPath: () => fixtureRoot(), platform: 'darwin', arch: 'arm64',
		})
		await expect(gate()).resolves.toBe(false)
		expect(fetchImpl).not.toHaveBeenCalled()
		expect(openPath).not.toHaveBeenCalled()
		expect(showOutcome).toHaveBeenCalledTimes(1)
		expect(showOutcome.mock.calls[0]?.[0]).toEqual({ kind: 'failed', reason: 'no packaged update feed is configured' })
	})
})
