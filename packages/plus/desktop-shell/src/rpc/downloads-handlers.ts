import type { RpcHandlers } from './types.ts'

/** 壳侧下载记录（manager 的 DownloadRecord）；只声明映射需要的字段。 */
export interface DownloadRecordLike {
	id: string
	url: string
	filename: string
	savedPath: string
	totalBytes: number
	receivedBytes: number
	state: 'queued' | 'downloading' | 'paused' | 'completed' | 'cancelled' | 'failed'
	startedAt: number
	completedAt?: number | undefined
	failureReason?: string | undefined
}

/** 下载队列的 RPC 面：查询/控制走 manager，打开文件位置走壳注入的 reveal。 */
export interface DownloadRpcDeps {
	list(): DownloadRecordLike[]
	pause(id: string): boolean
	resume(id: string): boolean
	cancel(id: string): boolean
	clearFinished(): number
	reveal(id: string): boolean
	/** 下载设置（并发/目录）：与 plus 桌面设置同一份文件。 */
	settings(): { concurrency: number; directory: string }
	/** 回写并发（钳到 1..5，与管理器上限一致）。 */
	saveConcurrency(value: number): void
}

/** contract 的 wire 形状：id 是数字、状态叫 status、时间是 unix 秒。 */
interface DownloadTaskWire {
	id: number
	kind: 'url'
	url: string
	filename: string
	targetPath: string
	total: number | null
	received: number
	etag: null
	resumed: boolean
	status: 'queued' | 'downloading' | 'paused' | 'completed' | 'cancelled' | 'failed'
	error: string | null
	createdAt: number
	updatedAt: number
}

/** contracts downloads 组的已接入命令。显式创建类（blob/url）由页面下载拦截闭环，暂不在此暴露。 */
export function createDownloadRpcHandlers(deps: DownloadRpcDeps): RpcHandlers {
	// 壳内记录 id 是字符串（dl-<ts>-<seq>），契约那侧要数字：一张双向表把两边钉住，
	// 页面把数字 id 传回来时按同一张表还原，避免每次调用都按位置猜。
	const numericIds = new Map<string, number>()
	const recordIds = new Map<number, string>()
	let nextId = 1

	const wireId = (recordId: string): number => {
		const existing = numericIds.get(recordId)
		if (existing !== undefined) return existing
		const assigned = nextId
		nextId += 1
		numericIds.set(recordId, assigned)
		recordIds.set(assigned, recordId)
		return assigned
	}

	const recordIdOf = (wire: unknown): string => {
		const id = typeof wire === 'number' ? wire : Number(wire)
		return recordIds.get(id) ?? ''
	}

	const toTask = (record: DownloadRecordLike): DownloadTaskWire => ({
		id: wireId(record.id),
		kind: 'url',
		url: record.url,
		filename: record.filename,
		targetPath: record.savedPath,
		total: record.totalBytes > 0 ? record.totalBytes : null,
		received: record.receivedBytes,
		etag: null,
		resumed: false,
		status: record.state,
		error: record.failureReason ?? null,
		createdAt: Math.floor(record.startedAt / 1000),
		updatedAt: Math.floor((record.completedAt ?? record.startedAt) / 1000),
	})

	return {
		list_downloads: () => deps.list().map(toTask),
		// 卡片先读这一组：缺一条就会整张下载页空白（调用方把两条 invoke 包在同一个 try 里）。
		get_download_settings: () => {
			const settings = deps.settings()
			return { concurrency: settings.concurrency, download_dir: settings.directory }
		},
		set_download_concurrency: ({ value }) => {
			const next = Math.max(1, Math.min(5, Math.round(Number(value))))
			deps.saveConcurrency(next)
			return { concurrency: next }
		},
		pause_download: ({ id }) => ({ paused: deps.pause(recordIdOf(id)) }),
		resume_download: ({ id }) => ({ resumed: deps.resume(recordIdOf(id)) }),
		cancel_download: ({ id }) => ({ cancelled: deps.cancel(recordIdOf(id)) }),
		clear_finished_downloads: () => ({ removed: deps.clearFinished() }),
		reveal_download: ({ id }) => deps.reveal(recordIdOf(id)),
	}
}
