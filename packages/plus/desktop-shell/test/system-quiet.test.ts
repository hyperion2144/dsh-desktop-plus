import { describe, expect, it, vi } from 'vitest'
import { createSystemQuietGate, focusAssertionsFromPlutilJson, quietModeFromRegOutput } from '../src/notifications/system-quiet.ts'

describe('quietModeFromRegOutput', () => {
	it('treats QuietMode 0x0 as not muted', () => {
		expect(quietModeFromRegOutput('    QuietMode    REG_DWORD    0x0')).toBe(false)
	})

	it('treats non-zero QuietMode (priority / alarms only) as muted', () => {
		expect(quietModeFromRegOutput('    QuietMode    REG_DWORD    0x1')).toBe(true)
		expect(quietModeFromRegOutput('    QuietMode    REG_DWORD    0x2')).toBe(true)
	})

	it('fails open on unrecognised output', () => {
		expect(quietModeFromRegOutput('ERROR: The system was unable to find the specified registry key')).toBe(false)
	})
})

describe('focusAssertionsFromPlutilJson', () => {
	it('detects an active Focus assertion', () => {
		const stdout = JSON.stringify({ data: [{ storeAssertionRecords: [{ assertionDetails: { modeDisplayName: '专注模式' } }] }] })
		expect(focusAssertionsFromPlutilJson(stdout)).toBe(true)
	})

	it('treats an empty assertion store as not muted', () => {
		expect(focusAssertionsFromPlutilJson(JSON.stringify({ data: [{ storeAssertionRecords: [] }] }))).toBe(false)
		expect(focusAssertionsFromPlutilJson(JSON.stringify({ data: [] }))).toBe(false)
	})

	it('fails open on invalid JSON', () => {
		expect(focusAssertionsFromPlutilJson('not json')).toBe(false)
	})
})

describe('createSystemQuietGate', () => {
	it('win32: reads the QuietHours registry and caches within the TTL', () => {
		const execSync = vi.fn(() => '    QuietMode    REG_DWORD    0x1')
		const gate = createSystemQuietGate({ platform: 'win32', execSync, ttlMs: 60_000 })
		expect(gate.isQuiet()).toBe(true)
		expect(gate.isQuiet()).toBe(true)
		expect(execSync).toHaveBeenCalledTimes(1)
	})

	it('win32: missing QuietMode key fails open', () => {
		const gate = createSystemQuietGate({ platform: 'win32', execSync: () => 'ERROR: The system was unable to find the specified registry key' })
		expect(gate.isQuiet()).toBe(false)
	})

	it('darwin: reads Focus assertions from the DoNotDisturbDB', () => {
		const execSync = vi.fn(() => JSON.stringify({ data: [{ storeAssertionRecords: [{ assertionDetails: {} }] }] }))
		const gate = createSystemQuietGate({ platform: 'darwin', execSync, homedir: () => '/Users/tester' })
		expect(gate.isQuiet()).toBe(true)
		expect(execSync).toHaveBeenCalledWith('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '/Users/tester/Library/DoNotDisturbDB/Assertions.json'])
	})

	it('darwin: missing assertions file fails open', () => {
		const gate = createSystemQuietGate({ platform: 'darwin', execSync: () => { throw new Error('no such file') } })
		expect(gate.isQuiet()).toBe(false)
	})

	it('unknown platform probes nothing', () => {
		const execSync = vi.fn(() => '')
		const gate = createSystemQuietGate({ platform: 'linux', execSync })
		expect(gate.isQuiet()).toBe(false)
		expect(execSync).not.toHaveBeenCalled()
	})

	it('re-probes after the TTL expires', () => {
		let now = 0
		vi.spyOn(Date, 'now').mockImplementation(() => now)
		let output = '    QuietMode    REG_DWORD    0x0'
		const execSync = vi.fn(() => output)
		const gate = createSystemQuietGate({ platform: 'win32', execSync, ttlMs: 1_000 })
		expect(gate.isQuiet()).toBe(false)
		output = '    QuietMode    REG_DWORD    0x1'
		now = 500
		expect(gate.isQuiet()).toBe(false)
		now = 2_500
		expect(gate.isQuiet()).toBe(true)
		vi.restoreAllMocks()
	})
})
