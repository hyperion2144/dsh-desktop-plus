import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLoggingKernel, LOG_MAX_BYTES } from '../src/index.ts'

const makeDir = (): string => mkdtempSync(join(tmpdir(), 'plus-logging-kernel-'))

describe('createLoggingKernel sources', () => {
	it('writes each source into its own file and leaves relay unfiltered', () => {
		const dir = makeDir()
		try {
			const kernel = createLoggingKernel({ logsDir: dir, level: 'warn' })
			kernel.append('shell', 'info', 'shell-below-threshold')
			kernel.append('shell', 'warn', 'shell-kept')
			kernel.append('webview', 'error', 'webview-kept')
			// relay 源的轮转/归档/导出由内核代管，写入在 relay 进程：级别过滤不作用它。
			kernel.append('relay', 'info', 'relay-kept')
			const files = kernel.files()
			const shell = readFileSync(files.shell, 'utf8')
			expect(shell).toContain('shell-kept')
			expect(shell).not.toContain('shell-below-threshold')
			expect(readFileSync(files.webview, 'utf8')).toContain('webview-kept')
			expect(readFileSync(files.relay, 'utf8')).toContain('relay-kept')
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('createLoggingKernel rotation', () => {
	it('gzips the active file past the size line and names the archive after the content day', () => {
		const dir = makeDir()
		try {
			const kernel = createLoggingKernel({ logsDir: dir, now: () => new Date('2026-10-25T10:00:00') })
			kernel.append('shell', 'info', 'first-line')
			// 一行就超过单文件上限：写入前会先轮转，归档名取「内容日」而不是轮转时刻。
			kernel.append('shell', 'info', 'x'.repeat(LOG_MAX_BYTES))
			const archives = readdirSync(kernel.archiveDir)
			expect(archives).toHaveLength(1)
			expect(archives[0]).toMatch(/^shell-20261025-01\.log\.gz$/) // 内容日紧凑 + 两位序号
			expect(statSync(join(kernel.archiveDir, archives[0])).size).toBeGreaterThan(0)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('createLoggingKernel clear', () => {
	it('drops every archive and truncates the active files', () => {
		const dir = makeDir()
		try {
			const kernel = createLoggingKernel({ logsDir: dir })
			kernel.append('shell', 'info', 'keep-me')
			kernel.append('shell', 'info', 'x'.repeat(LOG_MAX_BYTES))
			expect(readdirSync(kernel.archiveDir).length).toBeGreaterThan(0)
			const result = kernel.clear()
			expect(result.removed_files).toBeGreaterThan(0)
			expect(result.bytes_freed).toBeGreaterThan(0)
			expect(readdirSync(kernel.archiveDir)).toHaveLength(0)
			expect(statSync(kernel.files().shell).size).toBe(0)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
