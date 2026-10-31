/** The download queue core: intercept, track, control, persist. Electron-free. */

import { join } from 'node:path'

import type { DownloadItemLike, DownloadManagerDeps, DownloadRecord, DownloadState } from './types.ts'

const SPEED_SMOOTHING = 0.3
/** bytes/second under which a downloading item counts as stalled. */
const STALLED_SPEED = 1

interface Tracked {
	record: DownloadRecord
	item: DownloadItemLike
	lastReceived: number
	lastAt: number
}

export interface DownloadManager {
	/** Registers an intercepted item; the caller must have set a save path. */
	track(item: DownloadItemLike): DownloadRecord
	pause(id: string): boolean
	resume(id: string): boolean
	cancel(id: string): boolean
	list(): DownloadRecord[]
	history(): DownloadRecord[]
	clearFinished(): number
	dispose(): void
}

export function createDownloadManager(deps: DownloadManagerDeps): DownloadManager {
	const history = dedupeById(deps.loadHistory())
	const tracked = new Map<string, Tracked>()
	let sequence = 0

	const persist = (): void => {
		try {
			deps.saveHistory(history)
		} catch {
			// history persistence is best-effort; the live queue keeps working
		}
	}

	const finish = (entry: Tracked, state: DownloadState, failureReason?: string): void => {
		entry.record.state = state
		entry.record.completedAt = deps.now()
		if (state === 'failed') {
			entry.record.failureReason = failureReason ?? 'download failed'
		} else {
			delete entry.record.failureReason
		}
		entry.record.speedBps = 0
		history.unshift(entry.record)
		persist()
		deps.onEvent({ kind: 'finished', record: { ...entry.record } })
	}

	const detach = (entry: Tracked): void => {
		tracked.delete(entry.record.id)
	}

	return {
		track(item: DownloadItemLike): DownloadRecord {
			sequence += 1
			const now = deps.now()
			const record: DownloadRecord = {
				id: `dl-${now}-${sequence}`,
				url: item.getURL(),
				filename: item.getFilename(),
				savedPath: item.getSavePath() || join(deps.defaultDir(), item.getFilename()),
				totalBytes: item.getTotalBytes(),
				receivedBytes: item.getReceivedBytes(),
				speedBps: 0,
				state: item.isPaused() ? 'paused' : 'downloading',
				startedAt: now,
			}
			const entry: Tracked = { record, item, lastReceived: record.receivedBytes, lastAt: now }
			tracked.set(record.id, entry)

			item.on('updated', (_event, state) => {
				const received = item.getReceivedBytes()
				const at = deps.now()
				const elapsed = at - entry.lastAt
				if (elapsed > 0) {
					const instant = ((received - entry.lastReceived) * 1000) / elapsed
					entry.record.speedBps = entry.record.speedBps === 0 ? instant : entry.record.speedBps * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING
				}
				entry.lastReceived = received
				entry.lastAt = at
				entry.record.receivedBytes = received
				entry.record.totalBytes = Math.max(entry.record.totalBytes, item.getTotalBytes())
				entry.record.state = state === 'progressing' && item.isPaused() ? 'paused' : state === 'progressing' ? 'downloading' : entry.record.state
				if (state === 'interrupted' && entry.record.state !== 'failed') {
					entry.record.state = 'downloading'
				}
				deps.onEvent({ kind: 'updated', record: { ...entry.record } })
			})

			item.once('done', (_event, state) => {
				entry.record.receivedBytes = item.getReceivedBytes()
				if (state === 'completed') {
					finish(entry, 'completed')
				} else if (state === 'cancelled') {
					finish(entry, 'cancelled')
				} else {
					finish(entry, 'failed', `server interrupted the download (${state})`)
				}
				detach(entry)
			})

			return { ...record }
		},

		pause(id: string): boolean {
			const entry = tracked.get(id)
			if (entry === undefined || entry.record.state !== 'downloading') return false
			entry.item.pause()
			entry.record.state = 'paused'
			deps.onEvent({ kind: 'updated', record: { ...entry.record } })
			return true
		},

		resume(id: string): boolean {
			const entry = tracked.get(id)
			if (entry === undefined || entry.record.state !== 'paused') return false
			entry.item.resume()
			entry.record.state = 'downloading'
			entry.lastAt = deps.now()
			entry.lastReceived = entry.item.getReceivedBytes()
			deps.onEvent({ kind: 'updated', record: { ...entry.record } })
			return true
		},

		cancel(id: string): boolean {
			const entry = tracked.get(id)
			if (entry === undefined) return false
			if (entry.record.state !== 'downloading' && entry.record.state !== 'paused' && entry.record.state !== 'queued') return false
			entry.item.cancel()
			return true
		},

		list(): DownloadRecord[] {
			return [...tracked.values()].map((entry) => ({ ...entry.record }))
		},

		history(): DownloadRecord[] {
			return history.map((record) => ({ ...record }))
		},

		/** Drops terminal records (done/failed/cancelled) from the queue and history; returns the count. */
		clearFinished(): number {
			let removed = 0
			for (const [id, entry] of [...tracked]) {
				if (isActiveState(entry.record.state)) continue
				tracked.delete(id)
				removed += 1
			}
			const before = history.length
			const kept = history.filter((record) => isActiveState(record.state))
			history.length = 0
			history.push(...kept)
			removed += before - kept.length
			if (before !== kept.length) persist()
			return removed
		},
		dispose(): void {
			for (const entry of tracked.values()) {
				if (entry.record.state === 'downloading' || entry.record.state === 'paused') entry.item.cancel()
			}
			tracked.clear()
		},
	}
}

/** Keeps only the newest record per id and fails stalled downloads a reason. */
function dedupeById(records: DownloadRecord[]): DownloadRecord[] {
	const seen = new Set<string>()
	const kept: DownloadRecord[] = []
	for (const record of records) {
		if (seen.has(record.id)) continue
		seen.add(record.id)
		kept.push(record)
	}
	return kept
}

/** Human-readable failure text for the UI; tests pin the wording. */
export function describeFailure(record: DownloadRecord): string {
	if (record.state !== 'failed') return ''
	return record.failureReason ?? 'download failed'
}

/** True when the record counts as still moving (used to keep windows alive). */
export function isActiveState(state: DownloadState): boolean {
	return state === 'queued' || state === 'downloading' || state === 'paused'
}

export function stalled(record: DownloadRecord): boolean {
	return record.state === 'downloading' && record.speedBps < STALLED_SPEED
}
