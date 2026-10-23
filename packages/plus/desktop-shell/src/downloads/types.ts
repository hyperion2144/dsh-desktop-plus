/** Download manager contracts: records, states, and the item seam we control. */

/** Lifecycle of one tracked download. */
export type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'cancelled' | 'failed'

/** The subset of Electron's DownloadItem the manager drives. */
export interface DownloadItemLike {
	getURL(): string
	getFilename(): string
	getReceivedBytes(): number
	getTotalBytes(): number
	isPaused(): boolean
	pause(): void
	resume(): void
	cancel(): void
	once(event: 'done', listener: (event: unknown, state: string) => void): void
	on(event: 'updated', listener: (event: unknown, state: string) => void): void
	getSavePath(): string
}

/** What the manager persists and reports per download. */
export interface DownloadRecord {
	id: string
	url: string
	filename: string
	savedPath: string
	totalBytes: number
	receivedBytes: number
	/** Exponentially smoothed bytes/second; 0 while not moving. */
	speedBps: number
	state: DownloadState
	startedAt: number
	completedAt?: number
	/** Human-readable reason for `failed`; absent otherwise. */
	failureReason?: string
}

/** Manager → UI/notify events. */
export type DownloadEvent =
	| { kind: 'updated'; record: DownloadRecord }
	| { kind: 'finished'; record: DownloadRecord }

export interface DownloadManagerDeps {
	/** Monotonic-ish wall clock in ms; injectable for tests. */
	now(): number
	/** Where downloads land when the user picked no explicit path. */
	defaultDir(): string
	/** Completed/failed/cancelled announcements (notification, window push, …). */
	onEvent(event: DownloadEvent): void
	/** History persistence; injectable so tests use memory. */
	loadHistory(): DownloadRecord[]
	saveHistory(records: DownloadRecord[]): void
}
