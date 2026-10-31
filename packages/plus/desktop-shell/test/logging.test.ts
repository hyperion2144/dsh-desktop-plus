import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { attachPageConsole, collectDiagnostics, createRotatingLogger, createTar, createTarGz, exportDiagnosticsBundle, type PageConsoleSource } from '../src/index.ts'

const makeDir = (): string => mkdtempSync(join(tmpdir(), 'plus-logging-'))

describe('createRotatingLogger', () => {
	it('writes into the day file and adds newlines', () => {
		const dir = makeDir()
		const logger = createRotatingLogger({ dir, prefix: 'p', now: () => new Date('2026-10-23T10:00:00Z') })
		logger.append('one')
		logger.append('two\n')
		expect(readFileSync(join(dir, 'p-2026-10-23.log'), 'utf8')).toBe('one\ntwo\n')
		rmSync(dir, { recursive: true, force: true })
	})

	it('switches to a new day file when the clock crosses midnight', () => {
		const dir = makeDir()
		let clock = new Date('2026-10-23T23:59:59Z')
		const logger = createRotatingLogger({ dir, prefix: 'p', now: () => clock })
		logger.append('before')
		clock = new Date('2026-10-24T00:00:01Z')
		logger.append('after')
		expect(readFileSync(join(dir, 'p-2026-10-23.log'), 'utf8')).toBe('before\n')
		expect(readFileSync(join(dir, 'p-2026-10-24.log'), 'utf8')).toBe('after\n')
		rmSync(dir, { recursive: true, force: true })
	})

	it('gzips and truncates the active file once it exceeds maxBytes', () => {
		const dir = makeDir()
		const logger = createRotatingLogger({ dir, prefix: 'p', maxBytes: 16, now: () => new Date('2026-10-23T10:00:00Z') })
		logger.append('x'.repeat(20))
		logger.append('fresh')
		const archive = readdirSync(dir).find((name) => name.endsWith('.gz'))
		expect(archive).toBeDefined()
		expect(gunzipSync(readFileSync(join(dir, archive!))).toString('utf8')).toBe('x'.repeat(20) + '\n')
		expect(readFileSync(join(dir, 'p-2026-10-23.log'), 'utf8')).toBe('fresh\n')
		rmSync(dir, { recursive: true, force: true })
	})

	it('prunes only prefix files older than maxAgeDays', () => {
		const dir = makeDir()
		const old = join(dir, 'p-2026-01-01.log')
		writeFileSync(old, 'old')
		const oldArchive = join(dir, 'p-2026-01-01.log.123.gz')
		writeFileSync(oldArchive, 'old-archive')
		const kept = join(dir, 'p-2026-10-23.log')
		writeFileSync(kept, 'kept')
		const foreign = join(dir, 'other.txt')
		writeFileSync(foreign, 'foreign')
		const oldTime = new Date('2026-01-01T00:00:00Z').getTime() / 1000
		utimesSync(old, oldTime, oldTime)
		utimesSync(oldArchive, oldTime, oldTime)
		const logger = createRotatingLogger({ dir, prefix: 'p', maxAgeDays: 14, now: () => new Date('2026-10-23T10:00:00Z') })
		logger.prune()
		expect(existsSync(old)).toBe(false)
		expect(existsSync(oldArchive)).toBe(false)
		expect(existsSync(kept)).toBe(true)
		expect(existsSync(foreign)).toBe(true)
		rmSync(dir, { recursive: true, force: true })
	})
})

describe('createTar / createTarGz', () => {
	it('produces ustar headers with correct size and checksum', () => {
		const tar = createTar([{ name: 'a.txt', data: 'hello' }])
		expect(tar.length).toBe(512 * 4)
		const head = tar.subarray(0, 512)
		expect(head.toString('binary', 257, 263)).toBe('ustar\0')
		expect(head.toString('binary', 0, 5)).toBe('a.txt')
		expect(head[134]).toBe(53)
		expect(head[135]).toBe(0)
		let sum = 0
		for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : head[index]!
		expect(head.toString('ascii', 148, 154)).toBe(sum.toString(8).padStart(6, '0'))
		expect(head[154]).toBe(0)
		expect(head[155]).toBe(32)
		expect(tar.toString('utf8', 512, 517)).toBe('hello')
	})

	it('round-trips through the real tar tool (skipped on Windows)', () => {
		if (process.platform === 'win32') return
		const dir = makeDir()
		const archive = join(dir, 'bundle.tar.gz')
		writeFileSync(archive, createTarGz([
			{ name: 'logs/plus.log', data: 'line one\nline two\n' },
			{ name: 'diagnostics.json', data: '{"pid":1}' },
		]))
		const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
		expect(listing.split('\n').filter(Boolean).sort()).toEqual(['diagnostics.json', 'logs/plus.log'])
		rmSync(dir, { recursive: true, force: true })
	})
})

describe('exportDiagnosticsBundle', () => {
	it('bundles every log file plus diagnostics.json', () => {
		if (process.platform === 'win32') return
		const logDir = makeDir()
		writeFileSync(join(logDir, 'plus-2026-10-23.log'), 'runtime log line\n')
		const outDir = makeDir()
		const outFile = join(outDir, 'diagnostics.tar.gz')
		const result = exportDiagnosticsBundle({ logDir, outFile, diagnostics: { pid: 42, runtimeVersion: '6.87.0', logDir } })
		expect(result.entries).toBe(2)
		expect(statSync(outFile).size).toBeGreaterThan(0)
		const listing = execFileSync('tar', ['-tzf', outFile], { encoding: 'utf8' })
		expect(listing).toContain('diagnostics.json')
		expect(listing).toContain('plus-2026-10-23.log')
		rmSync(logDir, { recursive: true, force: true })
		rmSync(outDir, { recursive: true, force: true })
	})

	it('tolerates a missing log directory', () => {
		const outDir = makeDir()
		const result = exportDiagnosticsBundle({ logDir: join(outDir, 'absent'), outFile: join(outDir, 'b.tar.gz'), diagnostics: {} })
		expect(result.entries).toBe(1)
		rmSync(outDir, { recursive: true, force: true })
	})
})

describe('attachPageConsole', () => {
	const fakeSource = () => {
		let listener: ((event: { level: string; message: string; sourceId?: string; lineNumber?: number }) => void) | undefined
		const lines: string[] = []
		const source: PageConsoleSource = {
			on: (_event, cb) => {
				listener = cb
			},
			off: () => {
				listener = undefined
			},
		}
		return {
			source,
			emit: (event: { level: string; message: string; sourceId?: string; lineNumber?: number }) => listener?.(event),
			lines,
		}
	}

	it('forwards warning and error, drops info, formats source location', () => {
		const fake = fakeSource()
		const capture = attachPageConsole(fake.source, (line) => fake.lines.push(line))
		fake.emit({ level: 'info', message: 'noise' })
		fake.emit({ level: 'warning', message: 'careful' })
		fake.emit({ level: 'error', message: 'boom', sourceId: 'http://dsh-app/app/x.js', lineNumber: 7 })
		expect(fake.lines).toEqual([
			'page-console [warn] careful',
			'page-console [error] boom (http://dsh-app/app/x.js:7)',
		])
		capture.dispose()
		fake.emit({ level: 'error', message: 'after dispose' })
		expect(fake.lines.length).toBe(2)
	})
})

describe('collectDiagnostics', () => {
	it('stamps pid, time and caller facts', () => {
		const snapshot = collectDiagnostics(
			{ logDir: '/logs', runtimeVersion: '6.87.0', hostPort: 6390, hostPid: 100, profile: 'desktop', deviceInfo: 'platform=darwin' },
			() => new Date('2026-10-23T10:00:00Z'),
		)
		expect(snapshot).toMatchObject({
			logDir: '/logs',
			runtimeVersion: '6.87.0',
			hostPort: 6390,
			hostPid: 100,
			profile: 'desktop',
			deviceInfo: 'platform=darwin',
			capturedAt: '2026-10-23T10:00:00.000Z',
		})
		expect(Number.isInteger(snapshot.pid)).toBe(true)
	})
})
