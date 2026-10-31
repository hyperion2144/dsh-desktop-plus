// 生命周期与连通性命令的壳侧实现（contracts runtime 组的 restart/proxy + diagnostics 组的窗口退出）。
// 曾随 runtime handlers 删除而缺失（PR #33 反馈 #5/#12/#13），现按契约形状恢复为独立组。
import { connect } from 'node:net'
import type { RpcHandlers } from './types.ts'

/** 生命周期组依赖（实现由壳注入：重启/关窗/代理连通探测）。 */
export interface LifecycleRpcDeps {
	/** dsh 服务重启：默认 profile 停止后拉起（壳本体不动）。 */
	restartDshService: () => Promise<void>
	/** 整应用就地重启：官方 backend + 全部 plus profile + 托盘（托盘「重启应用与宿主」同路径）。 */
	restartDesktopApp: () => Promise<{ restarted: string[], failed: Array<{ name: string, reason: string }> }>
	/** 关闭当前聚焦的 plus 窗口（侧边栏「退出」按钮语义）。 */
	exitWindow: () => void
}

const PROXY_CONNECT_TIMEOUT_MS = 5_000

/** 生命周期组 handlers（键与 contracts 对齐）。 */
export function createLifecycleRpcHandlers(deps: LifecycleRpcDeps): RpcHandlers {
	return {
		// TCP 直连代理地址测耗时：能建连即视为代理可用（不做代理协议握手）。
		test_proxy_connectivity: ({ url }) => new Promise((resolve, reject) => {
			let target: URL
			try {
				target = new URL(String(url))
			} catch {
				reject(new Error(`bad proxy url: ${url}`))
				return
			}
			const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)
			const started = Date.now()
			const socket = connect(port, target.hostname, () => {
				const ms = Date.now() - started
				socket.destroy()
				resolve(ms)
			})
			socket.setTimeout(PROXY_CONNECT_TIMEOUT_MS, () => {
				socket.destroy()
				reject(new Error(`proxy connect timeout after ${String(PROXY_CONNECT_TIMEOUT_MS)}ms: ${url}`))
			})
			socket.on('error', (error: Error) => {
				reject(new Error(`proxy connect failed: ${error.message}`))
			})
		}),
		restart_dsh_service: async () => {
			await deps.restartDshService()
			return {}
		},
		restart_desktop_app: async () => {
			const outcome = await deps.restartDesktopApp()
			return {
				ok: outcome.failed.length === 0,
				reason: outcome.failed[0]?.reason,
				message: outcome.restarted.length > 0 ? `已重启 ${String(outcome.restarted.length)} 个 profile` : undefined,
			}
		},
		exit_window_instance: () => {
			deps.exitWindow()
			return {}
		},
	}
}
