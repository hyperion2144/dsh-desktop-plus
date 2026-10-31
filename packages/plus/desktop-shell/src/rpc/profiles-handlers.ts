// Profile 组命令的壳侧实现。plus 的 profile 由壳直接拉起 host（无 per-profile
// 依赖安装任务），依赖类命令如实回 not-applicable；端口映射与启动询问给真值。
import type { RpcHandlers } from './types.ts'

export interface ProfilesRpcDeps {
	/** 全部 profile 的真实状态（含未运行的）：壳侧 listProfileDirs + 窗口/端口真值。 */
	profiles: () => Array<{ profile: string; pagePort: number | null; lanePort: number; running: boolean }>
	/** 启动时是否还有等待确认的 profile 恢复询问。 */
	pendingRestore: () => Array<{ name: string; selectable: boolean }>
	confirm: (name: string) => void
	/** 依赖卡的行（壳侧直接给真值：每个 profile 一行）。 */
	dependencyRows: () => Array<{ profile: string; recordedPnpm: string | null; builtinPnpm: string | null; needsRebuild: boolean; running: boolean }>
	createProfile: (name: string) => { ok: boolean; reason?: string }
	deleteProfile: (name: string) => { ok: boolean; reason?: string }
}

export function createProfilesRpcHandlers(deps: ProfilesRpcDeps): RpcHandlers {
	return {
		// 契约 list_profile_ports 返回 ProfilePortRow[]：每个磁盘 profile 一行，页面口/运行态给真值，
		// lane 口以 profile 为唯一维度：显式覆盖优先，未覆盖的由壳自动分配并持久化。
		list_profile_ports: () => deps.profiles().map((row) => ({
			profile: row.profile,
			page_port: row.pagePort,
			lane_port: row.lanePort,
			running: row.running,
		})),
		check_startup_needed: () => ({ needed: deps.pendingRestore().length > 0, pending: deps.pendingRestore() }),
		confirm_startup_profile: (params) => {
			deps.confirm(String(params.profile))
			return { ok: true }
		},
		get_pending_active_profile: () => ({ pending: deps.pendingRestore() }),
		// 依赖卡要真实行：「未发现 profile」是因为之前写死空数组，现在按真实 profile 给。
		list_profile_dependency_status: () => ({ profiles: deps.dependencyRows() }),
		migrate_profile: () => ({ ok: false, reason: 'not applicable: profiles are shell-managed' }),
		migration_status: () => ({ state: 'not-applicable' as const }),
		rebuild_profile_dependencies: () => ({ ok: false, reason: 'not applicable: profiles are shell-managed' }),
		task_status: () => ({ tasks: [] }),
		create_profile: (params) => {
			const name = String(params.name)
			const outcome = deps.createProfile(name)
			return outcome.ok ? { ok: true, profile: name } : { ok: false, profile: name, reason: outcome.reason ?? 'create failed' }
		},
		delete_profile: (params) => {
			const name = String(params.name)
			const outcome = deps.deleteProfile(name)
			return outcome.ok ? { ok: true, profile: name } : { ok: false, profile: name, reason: outcome.reason ?? 'delete failed' }
		},
	}
}
