import type { RpcHandlers } from './types.ts'

/** 下载队列的 RPC 面：查询/控制走 manager，打开文件位置走壳注入的 reveal。 */
export interface DownloadRpcDeps {
	list(): unknown[]
	pause(id: string): boolean
	resume(id: string): boolean
	cancel(id: string): boolean
	clearFinished(): number
	reveal(id: string): boolean
}

/** contracts downloads 组的已接入命令。显式创建类（blob/url）由页面下载拦截闭环，暂不在此暴露。 */
export function createDownloadRpcHandlers(deps: DownloadRpcDeps): RpcHandlers {
	return {
		list_downloads: () => deps.list(),
		pause_download: ({ id }) => ({ paused: deps.pause(String(id)) }),
		resume_download: ({ id }) => ({ resumed: deps.resume(String(id)) }),
		cancel_download: ({ id }) => ({ cancelled: deps.cancel(String(id)) }),
		clear_finished_downloads: () => ({ removed: deps.clearFinished() }),
		reveal_download: ({ id }) => deps.reveal(String(id)),
	}
}
