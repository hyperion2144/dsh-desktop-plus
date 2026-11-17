import { describe, expect, it, vi } from 'vitest'
import { createPlusUpdateGate, wrapPlusUpdateInstallGate } from '../../src/updates/install-gate.ts'

function makeInstaller() {
	const install = vi.fn(async (version: string) => ({ kind: 'opened' as const, path: `/tmp/${version}.dmg` }))
	return { install, installer: { install } }
}

describe('createPlusUpdateGate', () => {
	it('passes signed or non-mac builds through to the official flow', async () => {
		const { install, installer } = makeInstaller()
		const gate = createPlusUpdateGate({
			coordinator: () => ({ state: { phase: 'ready', version: '1.2.3' } }),
			resolveInstallMode: async () => 'shipit', manualInstaller: installer, onOutcome: vi.fn(),
		})
		await expect(gate()).resolves.toBe(true)
		expect(install).not.toHaveBeenCalled()
	})

	it('runs the manual installer and vetoes the ShipIt handoff for unsigned builds', async () => {
		const { install, installer } = makeInstaller()
		const onOutcome = vi.fn()
		const gate = createPlusUpdateGate({
			coordinator: () => ({ state: { phase: 'installing', version: '1.2.3' } }),
			resolveInstallMode: async () => 'manual', manualInstaller: installer, onOutcome,
		})
		await expect(gate()).resolves.toBe(false)
		expect(install).toHaveBeenCalledWith('1.2.3')
		expect(onOutcome).toHaveBeenCalledTimes(1)
	})

	it('vetoes the handoff with a failure outcome when no target version is observable', async () => {
		const { install, installer } = makeInstaller()
		const onOutcome = vi.fn()
		const gate = createPlusUpdateGate({
			coordinator: () => undefined,
			resolveInstallMode: async () => 'manual', manualInstaller: installer, onOutcome,
		})
		await expect(gate()).resolves.toBe(false)
		expect(install).not.toHaveBeenCalled()
		expect(onOutcome).toHaveBeenCalledWith({ kind: 'failed', reason: 'desktop update: no checked version is observable' }, '')
	})
})

describe('wrapPlusUpdateInstallGate', () => {
	it('runs the official preparation only when the gate approves', async () => {
		const original = vi.fn(async () => true)
		const wrapped = wrapPlusUpdateInstallGate(async () => true, original)
		await expect(wrapped()).resolves.toBe(true)
		expect(original).toHaveBeenCalledTimes(1)
	})

	it('vetoes without touching the official preparation when the gate declines', async () => {
		const original = vi.fn(async () => true)
		const wrapped = wrapPlusUpdateInstallGate(async () => false, original)
		await expect(wrapped()).resolves.toBe(false)
		expect(original).not.toHaveBeenCalled()
	})
})
