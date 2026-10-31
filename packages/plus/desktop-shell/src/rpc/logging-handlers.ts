// 日志与诊断命令的壳侧实现（contracts/logging.ts 的中性行）。
//
// 日志不是「只有样式」：这里接的是 logging/kernel 那个真实的内核——三源写入、
// 级别过滤、按天/按大小轮转、gzip 归档、保留清理、导出 tar.gz，全部落在这里。
// 「打开目录」走 shell.openPath（真的打开文件管理器），不是弹个提示了事。
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { RpcHandlers } from './types.ts'
import type { LoggingKernel, LogLevel } from '../logging/kernel.ts'
import { exportLogRange, resolveRangePreset } from '../logging/exporter.ts'

/** 页面控制台级别 → 内核级别。 */
function toLogLevel(raw: unknown): LogLevel {
  return raw === 'error' ? 'error' : raw === 'warn' ? 'warn' : raw === 'debug' ? 'debug' : 'info'
}

/** 日志/诊断 RPC 面：写入、列举、清理、导出与诊断快照。 */
export interface LoggingRpcDeps {
  /** 进程级日志内核。 */
  kernel: LoggingKernel
  /** 打开目录（Electron `shell.openPath`，成功回空串）。 */
  openPath: (path: string) => Promise<string>
  /** 诊断快照（版本/端口/pid/设备信息）。 */
  collectDiagnostics: () => Promise<unknown>
  log?: ((line: string) => void) | undefined
}

/** contracts logging 组的已接入命令。 */
export function createLoggingRpcHandlers(deps: LoggingRpcDeps): RpcHandlers {
  const log = deps.log ?? (() => { })
  const writePage = (rawLevel: unknown, msg: unknown, rawPage: unknown): void => {
    const page = String(rawPage ?? '')
    const text = `${page === '' ? '' : `[page=${page}] `}${String(msg ?? '')}`
    const lineLevel = toLogLevel(rawLevel)
    deps.kernel.append('webview', lineLevel, text)
    // warn/error 同时镜像进壳日志：排障时一条时间线看得完。
    if (lineLevel === 'warn' || lineLevel === 'error') deps.kernel.append('shell', lineLevel, text)
  }
  return {
    log_console: ({ level, msg, pageUrl }) => {
      writePage(level, msg, pageUrl)
      return {}
    },
    log_console_batch: ({ items }) => {
      const rows = Array.isArray(items) ? items : []
      for (const item of rows) {
        const row = item as { level?: unknown, msg?: unknown, pageUrl?: unknown }
        writePage(row.level, row.msg, row.pageUrl)
      }
      return { count: rows.length }
    },
    log_diag: ({ msg }) => {
      deps.kernel.append('shell', 'info', `[diag] ${String(msg ?? '')}`)
      return {}
    },
    get_diagnostics: async () => ({ diagnostics: await deps.collectDiagnostics() }),
	export_diagnostics: async () => {
		// 诊断导出：诊断快照 + 活跃日志清单写成一个 JSON，落到临时目录后由壳 reveal。
		// 日志全集走 export_log_range（tar.gz），这里只包诊断面（#220 的快照语义）。
		const { writeFileSync, mkdirSync } = await import('node:fs')
		const dir = join(tmpdir(), 'dsh-diagnostics')
		mkdirSync(dir, { recursive: true })
		const payload = {
			capturedAt: new Date().toISOString(),
			diagnostics: await deps.collectDiagnostics(),
			activeLogs: deps.kernel.files(),
			archives: deps.kernel.list(),
		}
		const body = `${JSON.stringify(payload, null, 2)}\n`
		const path = join(dir, `diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
		writeFileSync(path, body, 'utf8')
		return { path, bytes: Buffer.byteLength(body) }
	},
    list_log_files: async ({ reveal }) => {
      const listing = deps.kernel.list()
      if (reveal === true) {
        // 打开日志根目录（活跃 shell.log/webview.log/relay.log 与 archive/ 都在里面），
        // 不是只打开归档子目录。
        const root = dirname(deps.kernel.files().shell)
        const failure = await deps.openPath(root)
        if (failure !== '') {
          // 打不开就说实话，别假装已经打开。
          deps.kernel.append('shell', 'warn', `[logging] open ${root} failed: ${failure}`)
          log(`list_log_files reveal failed: ${failure}`)
        }
      }
      return listing
    },
    export_log_range: ({ range, from, to }) => {
      const preset = range === 'today' || range === '7d' || range === '30d' || range === 'custom' ? range : 'all'
      const now = new Date()
      const bounds = resolveRangePreset(
        preset,
        typeof from === 'string' ? from : undefined,
        typeof to === 'string' ? to : undefined,
        now,
      )
      const result = exportLogRange({ kernel: deps.kernel, destDir: join(tmpdir(), 'dsh-logs'), range: bounds, now })
      return {
        path: result.path,
        bytes: result.bytes,
        approximations: result.approximations,
        archives_included: result.archivesIncluded,
      }
    },
    clear_logs: () => deps.kernel.clear(),
  }
}
