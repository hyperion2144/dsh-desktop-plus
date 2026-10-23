import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { RpcHandlers } from './types.ts'

const execFileAsync = promisify(execFile)

/** 诊断/日志的 RPC 面：控制台镜像与诊断快照落盘都汇到 plus 日志层。 */
export interface LoggingRpcDeps {
	append(line: string): void
	logDir(): string
	collectDiagnostics(): Promise<unknown>
}

function formatConsoleEntry(level: string, msg: string, pageUrl: string): string {
	const prefix = pageUrl === '' ? '' : ` (${pageUrl})`
	return `page-console [${level}] ${msg}${prefix}`
}

/** contracts diagnostics/logging 组的已接入命令。 */
export function createLoggingRpcHandlers(deps: LoggingRpcDeps): RpcHandlers {
	return {
		log_console: ({ level, msg, pageUrl }) => {
			deps.append(formatConsoleEntry(String(level ?? 'info'), String(msg ?? ''), String(pageUrl ?? '')))
			return {}
		},
		log_console_batch: ({ items }) => {
			const rows = Array.isArray(items) ? items : []
			for (const item of rows) {
				const row = item as { level?: unknown; msg?: unknown; pageUrl?: unknown }
				deps.append(
					formatConsoleEntry(String(row.level ?? 'info'), String(row.msg ?? ''), String(row.pageUrl ?? '')),
				)
			}
			return { count: rows.length }
		},
		log_diag: ({ msg }) => {
			deps.append(String(msg ?? ''))
			return {}
		},
		get_diagnostics: async () => ({ diagnostics: await deps.collectDiagnostics() }),
		export_diagnostics: async () => {
			const diagnostics = await deps.collectDiagnostics()
			const target = join(tmpdir(), `dsh-plus-diagnostics-${Date.now()}.json`)
			const { writeFile } = await import('node:fs/promises')
			const payload = JSON.stringify(diagnostics, null, 2)
			await writeFile(target, payload, 'utf8')
			const bytes = (await stat(target)).size
			return { path: target, bytes }
		},
		list_log_files: async ({ reveal }) => {
			const dir = deps.logDir()
			const { readdir } = await import('node:fs/promises')
			const entries = await readdir(dir)
			const archives = entries.filter((name) => name.endsWith('.gz')).sort().reverse()
			const first = archives[0]
			if (reveal === true && first !== undefined) {
				await execFileAsync('open', ['-R', join(dir, first)]).catch(() => undefined)
			}
			return { archive_dir: dir, archives, active: archives.length }
		},
	}
}
