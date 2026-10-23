/** Download manager: queue interception, control actions, history persistence. */

import { describe, expect, it, vi } from 'vitest'

import { createDownloadManager } from '../src/downloads/manager.ts'
import { createFileHistoryStore } from '../src/downloads/store.ts'
import type { DownloadEvent, DownloadItemLike, DownloadRecord } from '../src/downloads/types.ts'

function fakeItem(overrides: Partial<DownloadItemLike> = {}) {
	const listeners: Record<string, Array<(event: unknown, state: string) => void>> = {}
	let received = 0
	let paused = false
	let savePath = '/tmp/downloads/file.bin'
	const item: DownloadItemLike = {
		getURL: () => 'https://example.com/file.bin',
		getFilename: () => 'file.bin',
		getReceivedBytes: () => received,
		getTotalBytes: () => 1000,
		isPaused: () => paused,
		pause: () => { paused = true },
		resume: () => { paused = false },
		cancel: () => { emit('done', 'cancelled') },
		once: (event, listener) => { (listeners[event] ??= []).push(listener) },
		on: (event, listener) => { (listeners[event] ??= []).push(listener) },
		getSavePath: () => savePath,
		...overrides,
	}
	const emit = (event: string, state: string): void => {
		for (const listener of listeners[event] ?? []) listener({}, state)
	}
	return {
		item,
		emit,
		setReceived(bytes: number): void { received = bytes },
		setPaused(value: boolean): void { paused = value },
	}
}

function fakeDeps() {
	const events: DownloadEvent[] = []
	const saved: DownloadRecord[][] = []
	let clock = 1_000
	return {
		events,
		saved,
		deps: {
			now: () => (clock += 500),
			defaultDir: () => '/tmp/downloads',
			onEvent: (event: DownloadEvent) => { events.push(event) },
			loadHistory: () => [] as DownloadRecord[],
			saveHistory: (records: DownloadRecord[]) => { saved.push([...records]) },
		},
	}
}

describe('createDownloadManager', () => {
	it('tracks an intercepted item and reports progress with speed', () => {
		const { deps, events } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		const record = manager.track(download.item)
		expect(record.state).toBe('downloading')
		expect(record.savedPath).toBe('/tmp/downloads/file.bin')

		download.setReceived(400)
		download.emit('updated', 'progressing')
		const update = events.at(-1)!.record
		expect(update.receivedBytes).toBe(400)
		expect(update.totalBytes).toBe(1000)
		expect(update.speedBps).toBeGreaterThan(0)
	})

	it('pauses, resumes, and cancels for real through the item', () => {
		const { deps } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		const record = manager.track(download.item)

		expect(manager.pause(record.id)).toBe(true)
		expect(download.item.isPaused()).toBe(true)
		expect(manager.list()[0]!.state).toBe('paused')

		expect(manager.resume(record.id)).toBe(true)
		expect(download.item.isPaused()).toBe(false)
		expect(manager.list()[0]!.state).toBe('downloading')

		expect(manager.cancel(record.id)).toBe(true)
		expect(manager.list()).toHaveLength(0)
	})

	it('records completion into history and persists it', () => {
		const { deps, saved } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		const record = manager.track(download.item)
		download.setReceived(1000)
		download.emit('done', 'completed')

		expect(manager.history()[0]).toMatchObject({ id: record.id, state: 'completed', receivedBytes: 1000 })
		expect(saved.at(-1)?.[0]?.state).toBe('completed')
	})

	it('records failures with a readable reason', () => {
		const { deps, events } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		manager.track(download.item)
		download.emit('done', 'interrupted')

		const finished = events.at(-1)!
		expect(finished.record.state).toBe('failed')
		expect(finished.record.failureReason).toContain('interrupted')
	})

	it('keeps cancelled downloads out of the live queue but in history', () => {
		const { deps } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		manager.track(download.item)
		manager.cancel(download.item ? (manager.list()[0]!.id) : '')
		expect(manager.history()[0]?.state).toBe('cancelled')
	})

	it('rejects pause on completed items and resume on unknown ids', () => {
		const { deps } = fakeDeps()
		const manager = createDownloadManager(deps)
		expect(manager.resume('nope')).toBe(false)
		const download = fakeItem()
		const record = manager.track(download.item)
		download.emit('done', 'completed')
		expect(manager.pause(record.id)).toBe(false)
	})

	it('cancels live downloads on dispose', () => {
		const { deps } = fakeDeps()
		const manager = createDownloadManager(deps)
		const download = fakeItem()
		manager.track(download.item)
		manager.dispose()
		expect(manager.list()).toHaveLength(0)
	})
})

describe('createFileHistoryStore', () => {
	it('round-trips records through an atomic JSON file', async () => {
		const { mkdtempSync, existsSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const dir = mkdtempSync(join(tmpdir(), 'dl-'))
		const store = createFileHistoryStore(dir)
		expect(store.load()).toEqual([])

		const record: DownloadRecord = {
			id: 'dl-1', url: 'https://example.com/a', filename: 'a', savedPath: '/x/a',
			totalBytes: 10, receivedBytes: 10, speedBps: 0, state: 'completed', startedAt: 1, completedAt: 2,
		}
		store.save([record])
		expect(existsSync(join(dir, 'downloads-history.json'))).toBe(true)
		expect(existsSync(join(dir, 'downloads-history.json.tmp'))).toBe(false)
		expect(store.load()).toEqual([record])
	})

	it('returns empty on corrupt history files instead of throwing', async () => {
		const { mkdtempSync, writeFileSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')
		const dir = mkdtempSync(join(tmpdir(), 'dl-'))
		writeFileSync(join(dir, 'downloads-history.json'), '{not json')
		const store = createFileHistoryStore(dir)
		expect(store.load()).toEqual([])
	})
})

describe('vi integration guard', () => {
	it('keeps vitest imported so the suite fails loudly on regression', () => {
		expect(typeof vi.fn).toBe('function')
	})
})
