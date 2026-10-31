/** Electron seam: session will-download interception into the plus queue.
 * The queue UI lives in the desktop plugin (downloads tab over the official /api/shell.invoke channel);
 * this seam only tracks items and surfaces failures. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { app } from 'electron'
import type { Session } from 'electron'

import { createDownloadManager } from './manager.ts'
import { createFileHistoryStore } from './store.ts'

export interface AttachDownloadsOptions {
	/** Session whose downloads are intercepted (usually session.defaultSession). */
	session: Session
	/** Where history JSON lives (the DSH profile directory). */
	profileDir: string
}

export interface AttachedDownloads {
	manager: ReturnType<typeof createDownloadManager>
	dispose(): void
}

/** Intercepts every download on the session into the plus queue. */
export function attachDownloads(options: AttachDownloadsOptions): AttachedDownloads {
	const store = createFileHistoryStore(options.profileDir)
	let disposed = false

	const manager = createDownloadManager({
		now: () => Date.now(),
		defaultDir: () => app.getPath('downloads'),
		onEvent: (event) => {
			if (disposed) return
			if (event.kind === 'finished' && event.record.state === 'failed') {
				// Failures have no UI here; the plugin tab shows them from the queue/history.
				console.error(`download failed: ${event.record.filename}: ${event.record.failureReason ?? 'unknown'}`)
			}
		},
		loadHistory: () => store.load(),
		saveHistory: (records) => { store.save(records) },
	})

	options.session.on('will-download', (_event, item) => {
		item.setSavePath(resolveSavePath(app.getPath('downloads'), item.getFilename()))
		manager.track(item)
	})

	return {
		manager,
		dispose(): void {
			disposed = true
			manager.dispose()
		},
	}
}

/** Downloads land in the system directory without a native save dialog; on a
 * name clash a numbered suffix keeps both files instead of overwriting. */
function resolveSavePath(dir: string, filename: string): string {
	const ext = filename.lastIndexOf('.')
	const stem = ext > 0 ? filename.slice(0, ext) : filename
	const suffix = ext > 0 ? filename.slice(ext) : ''
	let candidate = join(dir, filename)
	for (let n = 1; existsSync(candidate); n += 1) candidate = join(dir, `${stem} (${n})${suffix}`)
	return candidate
}
