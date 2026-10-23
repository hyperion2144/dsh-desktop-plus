import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLoggingKernel, installShellConsoleTee } from '../src/index.ts'

const makeDir = (): string => mkdtempSync(join(tmpdir(), 'plus-logging-tee-'))

describe('installShellConsoleTee', () => {
	it('maps console methods to levels, formats arguments, and restores on dispose', () => {
		const seen: Array<[string, string]> = []
		const originals = { info: console.info, warn: console.warn, error: console.error }
		// Keep the test output quiet: the tee prints through the method it wrapped.
		console.info = (): void => {}
		console.warn = (): void => {}
		console.error = (): void => {}
		const uninstall = installShellConsoleTee((level, line) => { seen.push([level, line]) })
		try {
			console.info('boot %s', 'ok')
			console.warn('careful')
			console.error('boom')
		} finally {
			uninstall()
			console.info = originals.info
			console.warn = originals.warn
			console.error = originals.error
		}
		expect(seen).toEqual([['info', 'boot ok'], ['warn', 'careful'], ['error', 'boom']])
	})
})

describe('createLoggingKernel level', () => {
	it('reads the level on every append, so a settings change applies without a restart', () => {
		const dir = makeDir()
		try {
			let level: 'debug' | 'info' | 'warn' | 'error' = 'warn'
			const kernel = createLoggingKernel({ logsDir: dir, level: () => level })
			kernel.append('shell', 'info', 'below-threshold')
			kernel.append('shell', 'warn', 'visible-warning')
			level = 'debug'
			kernel.append('shell', 'info', 'visible-after-switch')
			const text = readFileSync(kernel.files().shell, 'utf8')
			expect(text).not.toContain('below-threshold')
			expect(text).toContain('visible-warning')
			expect(text).toContain('visible-after-switch')
			expect(kernel.level()).toBe('debug')
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
