/** Host supervisor contracts: five phases, injectable process control, configurable policy. */

/** The only lifecycle states a supervised host can be reported in; never a pid. */
export type SupervisorPhase = 'stopped' | 'starting' | 'running' | 'failed' | 'blocked'

/**
 * One launched host process. The supervisor never spawns by itself: the embedder
 * owns how a host starts (official IPC handshake or stdout line) and reports the
 * result through this handle.
 */
export interface HostLease {
	/** OS pid of the launched host process. */
	readonly pid: number
	/** Resolves when the host reported readiness; rejects with the startup failure. */
	readonly ready: Promise<void>
	/** Registers a callback for an unexpected process exit with its exit info. */
	onExit(listener: (info: HostExitInfo) => void): void
	/** Stops the whole process tree (host plus everything it spawned). */
	stopTree(): Promise<void>
}

export interface HostExitInfo {
	readonly code: number | null
	readonly signal: string | null
}

export interface HostSupervisorConfig {
	/** Backoff before restart attempt n (1-based). */
	readonly backoff: BackoffConfig
	/** Restarts are abandoned after this many consecutive failures. */
	readonly maxRestartAttempts: number
	/** How long a launch may take before it counts as a failed attempt. */
	readonly startupTimeoutMs: number
}

export interface BackoffConfig {
	/** Delay before the first restart. */
	readonly baseMs: number
	/** Multiplier applied per consecutive attempt. */
	readonly factor: number
	/** Upper bound for one delay. */
	readonly maxMs: number
	/** Extra random wait in [0, jitterMs) added to every delay. */
	readonly jitterMs: number
}

/** What the supervisor needs from the platform; tests inject fakes here. */
export interface HostSupervisorDeps {
	/** Launches one host process for the given profile name. */
	launch(profile: string): Promise<HostLease>
	/** Removes leftovers from a previous crashed run: orphan pids and port claims. */
	cleanupLeftovers(profile: string): Promise<void>
	/** User-facing notification once restarts are abandoned. */
	notify(message: string): void
	/** Delay provider; defaults to a global timer, tests inject an immediate one. */
	wait?(ms: number): Promise<void>
}

/** Read-only view of the supervisor state for UI wiring. */
export interface HostSupervisorState {
	readonly phase: SupervisorPhase
	readonly profile: string | null
	/** Consecutive failed restart attempts for the current running period. */
	readonly restartAttempt: number
	/** Last failure detail, when the phase is failed or blocked. */
	readonly lastError: string | null
}
