// Profile 组命令的壳侧实现。plus 的 profile 由壳直接拉起 host（无 per-profile
// 依赖安装任务），依赖类命令如实回 not-applicable；端口映射与启动询问给真值。
import type { RpcHandlers } from './types.ts'

export interface ProfilesRpcDeps {
	/** profile 名 → host HTTP 端口（未起的 profile 不在表内）。 */
	ports: () => Array<{ profile: string; port: number }>
	/** 启动时是否还有等待确认的 profile 恢复询问。 */
	pendingRestore: () => Array<{ name: string; selectable: boolean }>
	confirm: (name: string) => void
}

export function createProfilesRpcHandlers(deps: ProfilesRpcDeps): RpcHandlers {
	return {
		list_profile_ports: () => ({ ports: deps.ports() }),
		check_startup_needed: () => ({ needed: deps.pendingRestore().length > 0, pending: deps.pendingRestore() }),
		confirm_startup_profile: (params) => {
			deps.confirm(String(params.profile))
			return { ok: true }
		},
		get_pending_active_profile: () => ({ pending: deps.pendingRestore() }),
		list_profile_dependency_status: () => ({ profiles: [], mode: 'shell-managed' as const, reason: 'plus profiles are started directly by the shell; there is no per-profile dependency task' }),
		migrate_profile: () => ({ ok: false, reason: 'not applicable: profiles are shell-managed' }),
		migration_status: () => ({ state: 'not-applicable' as const }),
		rebuild_profile_dependencies: () => ({ ok: false, reason: 'not applicable: profiles are shell-managed' }),
		task_status: () => ({ tasks: [] }),
	}
}
