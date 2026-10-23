export { createHostSupervisor, DEFAULT_CONFIG } from './supervisor/supervisor.ts'
export { pidFileCleanupLeftovers, stopProcessTree } from './supervisor/tree.ts'
export { restartDelayMs } from './supervisor/backoff.ts'
export type {
	BackoffConfig,
	HostExitInfo,
	HostLease,
	HostSupervisorConfig,
	HostSupervisorDeps,
	HostSupervisorState,
	SupervisorPhase,
} from './supervisor/types.ts'
