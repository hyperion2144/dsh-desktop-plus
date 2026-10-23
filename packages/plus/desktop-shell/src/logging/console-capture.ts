/** Page-side console capture: renderer warn/error lines into the same log. */

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
