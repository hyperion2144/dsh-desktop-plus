import { describe, expect, it } from 'vitest'
import { createProfilesRpcHandlers } from '../src/rpc/profiles-handlers.ts'
import { createUpdatesRpcHandlers } from '../src/rpc/updates-handlers.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('profiles and updates handlers', () => {
	it('reports ports, startup asks and not-applicable dependency tasks', () => {
		let confirmed: string[] = []
		const h = createProfilesRpcHandlers({
			ports: () => [{ profile: 'writing', port: 6391 }],
			pendingRestore: () => [{ name: 'writing', selectable: true }],
			confirm: (n) => { confirmed.push(n) },
		})
		expect(h.list_profile_ports({})).toEqual({ ports: [{ profile: 'writing', port: 6391 }] })
		expect(h.check_startup_needed({}).needed).toBe(true)
		expect(h.confirm_startup_profile({ profile: 'writing' })).toEqual({ ok: true })
		expect(confirmed).toEqual(['writing'])
		expect(h.list_profile_dependency_status({}).mode).toBe('shell-managed')
		expect(h.task_status({}).tasks).toEqual([])
	})

	it('persists notice preferences and reports a disabled backend outside packaged builds', async () => {
		const home = mkdtempSync(join(tmpdir(), 'plus-updates-'))
		let checked = 0
		const h = createUpdatesRpcHandlers({
			dshHome: () => home,
			enabled: () => false,
			check: async () => { checked += 1; return { update_available: true, version: '9.9.9' } },
			download: async () => ({ ok: false, reason: 'disabled' }),
			apply: async () => ({ ok: false, reason: 'disabled' }),
		})
		const state = await h.get_update_state({})
		expect(state).toMatchObject({ update_available: false, backend: 'disabled', enabled: true })
		expect(checked).toBe(0)
		expect(h.set_update_notice_enabled({ enabled: false }).enabled).toBe(false)
		expect(h.restore_update_notice({})).toMatchObject({ enabled: true, ignored_version: null })
	})
})
