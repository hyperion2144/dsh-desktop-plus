import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createManualDmgInstaller, parseAppUpdateFeedUrl, resolveManualDmgTarget } from '../../src/updates/manual-dmg.ts'

const appUpdateYaml = 'provider: generic\nurl: https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/\nchannel: nightly\n'
const feedUrl = 'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/'

describe('parseAppUpdateFeedUrl', () => {
	it('reads the url line from app-update.yml', () => {
		expect(parseAppUpdateFeedUrl(appUpdateYaml)).toBe(feedUrl)
	})
	it('returns undefined without a url line', () => {
		expect(parseAppUpdateFeedUrl('provider: generic\nchannel: nightly\n')).toBeUndefined()
	})
})

describe('resolveManualDmgTarget', () => {
	const version = '0.2.2-rc.3.plus.1'
	it('derives the tagged release asset for GitHub-shaped feeds', () => {
		expect(resolveManualDmgTarget(feedUrl, version, 'arm64')).toEqual({
			url: 'https://github.com/hyperion2144/dsh-desktop-plus/releases/download/v0.2.2-rc.3.plus.1/dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-arm64-unsigned.dmg',
			fileName: 'dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-arm64-unsigned.dmg',
			releasePageUrl: 'https://github.com/hyperion2144/dsh-desktop-plus/releases/tag/v0.2.2-rc.3.plus.1',
		})
	})
	it('falls back to the feed root for custom mirrors', () => {
		const target = resolveManualDmgTarget('https://mirror.example.com/dsh/', version, 'x64')
		expect(target.url).toBe('https://mirror.example.com/dsh/dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-x64-unsigned.dmg')
	})
})

describe('createManualDmgInstaller', () => {
	const copy = (version: string) => ({ startedTitle: 't', startedBody: `b ${version}`, openedTitle: 'o', openedBody: 'ob' })

	it('downloads the tagged dmg, opens it and reports success', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'plus-manual-dmg-'))
		const download = vi.fn(async (_url: string, destination: string) => { writeFileSync(destination, 'dmg') })
		const openPath = vi.fn(async () => { })
		const notify = vi.fn()
		const installer = createManualDmgInstaller({
			feedUrl: async () => feedUrl, arch: () => 'arm64', targetDir: () => dir, download, openPath, notify, notifyCopy: copy,
		})
		const outcome = await installer.install('0.2.2-rc.3.plus.1')
		expect(outcome).toEqual({ kind: 'opened', path: join(dir, 'dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-arm64-unsigned.dmg') })
		expect(download.mock.calls[0]?.[0]).toBe('https://github.com/hyperion2144/dsh-desktop-plus/releases/download/v0.2.2-rc.3.plus.1/dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-arm64-unsigned.dmg')
		expect(openPath).toHaveBeenCalledOnce()
		expect(notify).toHaveBeenCalledTimes(2)
	})

	it('collapses download failures into a failed outcome with the release page', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'plus-manual-dmg-'))
		const download = vi.fn(async () => { throw new Error('HTTP 404') })
		const openPath = vi.fn(async () => { })
		const installer = createManualDmgInstaller({
			feedUrl: async () => feedUrl, arch: () => 'arm64', targetDir: () => dir, download, openPath, notifyCopy: copy,
		})
		const outcome = await installer.install('0.2.2-rc.3.plus.1')
		expect(outcome).toEqual({
			kind: 'failed', reason: 'HTTP 404',
			releasePageUrl: 'https://github.com/hyperion2144/dsh-desktop-plus/releases/tag/v0.2.2-rc.3.plus.1',
		})
		expect(openPath).not.toHaveBeenCalled()
	})

	it('reuses a local dmg instead of re-downloading the whole package', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'plus-manual-dmg-'))
		const cached = join(dir, 'dsh-desktop-plus-0.2.2-rc.3.plus.1-mac-arm64-unsigned.dmg')
		writeFileSync(cached, 'dmg')
		const download = vi.fn(async () => { throw new Error('must not re-download') })
		const openPath = vi.fn(async () => { })
		const installer = createManualDmgInstaller({
			feedUrl: async () => feedUrl, arch: () => 'arm64', targetDir: () => dir, download, openPath, notifyCopy: copy,
		})
		const outcome = await installer.install('0.2.2-rc.3.plus.1')
		expect(outcome).toEqual({ kind: 'opened', path: cached })
		expect(download).not.toHaveBeenCalled()
	})
})
