/** Page-side console capture: renderer warn/error lines into the same log. */

import { format } from 'node:util'

/** The `webContents` surface the capture reads. */
export interface PageConsoleSource {
	on(event: 'console-message', listener: (event: PageConsoleEvent) => void): unknown
	off?(event: 'console-message', listener: (event: PageConsoleEvent) => void): unknown
}

/** Subset of Electron's console-message event the capture formats. */
export interface PageConsoleEvent {
	level: string
	message: string
	sourceId?: string
	lineNumber?: number
}

export interface PageConsoleCapture {
	/** Detach the listener (window close path). */
	dispose(): void
}

const LEVELS = new Set(['warning', 'error'])

/** Forward renderer `warning`/`error` console lines into `sink`; info stays out. */
export function attachPageConsole(source: PageConsoleSource, sink: (line: string) => void): PageConsoleCapture {
	const listener = (event: PageConsoleEvent): void => {
		if (!LEVELS.has(event.level)) return
		const label = event.level === 'error' ? 'error' : 'warn'
		const where = event.sourceId === undefined ? '' : ` (${event.sourceId}${event.lineNumber === undefined ? '' : `:${event.lineNumber}`})`
		sink(`page-console [${label}] ${event.message}${where}`)
	}
	source.on('console-message', listener)
	return {
		dispose: () => {
			source.off?.('console-message', listener)
		},
	}
}

/** Console methods the main-process tee wraps, and the log level each maps to. */
const TEE_METHODS: ReadonlyArray<[method: 'log' | 'info' | 'warn' | 'error' | 'debug', level: 'debug' | 'info' | 'warn' | 'error']> = [
	['log', 'info'],
	['info', 'info'],
	['warn', 'warn'],
	['error', 'error'],
	['debug', 'debug'],
]

/**
 * Tee the main-process console into the shell log source.
 *
 * Each method keeps printing to the real console: the tee only adds the file line, and the
 * line is formatted with `util.format` so arguments read the way the terminal showed them.
 * The sink runs behind a re-entrancy flag, so a log write that itself prints cannot loop.
 * @param sink - receives the mapped level and the formatted line.
 * @returns the uninstaller, which restores every original method.
 */
export function installShellConsoleTee(sink: (level: 'debug' | 'info' | 'warn' | 'error', line: string) => void): () => void {
	const target = console as unknown as Record<string, (...data: unknown[]) => void>
	const originals: Array<readonly [string, (...data: unknown[]) => void]> = []
	let reentrant = false
	for (const [method, level] of TEE_METHODS) {
		const original = target[method]
		if (typeof original !== 'function') continue
		originals.push([method, original])
		target[method] = (...data: unknown[]): void => {
			original.apply(console, data)
			if (reentrant) return
			reentrant = true
			try {
				sink(level, format(...data))
			} catch (error) {
				// 落盘失败不能把异常扔回调用方的 console 调用点；内核的 IO 健康度自己记账。
				void error
			} finally {
				reentrant = false
			}
		}
	}
	return () => {
		for (const [method, original] of originals) target[method] = original
	}
}
