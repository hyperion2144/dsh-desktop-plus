import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSettingsRpcHandlers } from '../src/rpc/settings-handlers.ts'

function harness() {
	const home = mkdtempSync(join(tmpdir(), 'plus-settings-'))
	const applied: string[] = []
	const handlers = createSettingsRpcHandlers({
		platform: () => 'darwin',
		profile: () => 'desktop',
		locale: () => 'zh-CN',
		builtinVersion: () => null,
		dshHome: () => home,
		port: () => 6390,
		profileNames: () => [{ name: 'desktop', active: true, selectable: true }],
		keepAwakeCapability: () => ({ platform: 'darwin', backend: null, available: false, reason: 'no consumer' }),
		preventSleepActive: () => false,
		devToolsActive: () => false,
		applySetting: (key) => { applied.push(key) },
		cleanupLogs: () => ({ removed_files: 2, bytes_freed: 1024 }),
	})
	return { home, handlers, applied }
}

describe('settings rpc handlers', () => {
	it('returns the client environment', () => {
		const { handlers } = harness()
		expect(handlers.get_desktop_client_environment({})).toEqual({ platform: 'darwin', profile: 'desktop', locale: 'zh-CN' })
	})

	it('serves defaults when no settings file exists and persists a patch atomically', () => {
		const { home, handlers, applied } = harness()
		const data = handlers.get_desktop_settings_data({})
		expect(data.port).toBe(6390)
		expect((data.settings as Record<string, unknown>)['download_concurrency']).toBe(3)
		const saved = handlers.save_desktop_settings({ patch: { download_concurrency: 5, log_retention_days: 7 } })
		expect((saved.settings as Record<string, unknown>)['download_concurrency']).toBe(5)
		expect(saved.log_cleanup).toEqual({ removed_files: 2, bytes_freed: 1024 })
		expect(applied).toContain('download_concurrency')
		const reread = handlers.get_desktop_settings_data({})
		expect((reread.settings as Record<string, unknown>)['download_concurrency']).toBe(5)
		const onDisk = JSON.parse(readFileSync(join(home, 'desktop-settings.json'), 'utf8'))
		expect(onDisk['log_retention_days']).toBe(7)
		expect(existsSync(join(home, 'desktop-settings.json.tmp'))).toBe(false)
	})

	it('falls back to defaults on a corrupted file and keeps saving', () => {
		const { home, handlers } = harness()
		writeFileSync(join(home, 'desktop-settings.json'), '{ broken')
		const data = handlers.get_desktop_settings_data({})
		expect((data.settings as Record<string, unknown>)['prevent_sleep']).toBe(true)
		handlers.save_desktop_settings({ patch: { prevent_sleep: true } })
		const reread = handlers.get_desktop_settings_data({})
		expect((reread.settings as Record<string, unknown>)['prevent_sleep']).toBe(true)
	})

	it('round-trips proxy settings with an effective preview', () => {
		const { handlers } = harness()
		expect(handlers.get_proxy_settings({}).effective).toBeNull()
		const saved = handlers.save_proxy_settings({ proxy_url: 'http://127.0.0.1:7890', no_proxy: 'localhost' })
		expect(saved.ok).toBe(true)
		expect(saved.effective?.http).toBe('http://127.0.0.1:7890')
		expect(handlers.get_proxy_settings({}).proxy_mode).toBe('system')
	})
})
