/** The host supervisor state machine: launch, watch, back off, stop, sweep. */

import { restartDelayMs } from './backoff.ts'
import type {
	HostExitInfo,
	HostLease,
	HostSupervisorConfig,
	HostSupervisorDeps,
	HostSupervisorState,
	SupervisorPhase,
} from './types.ts'

export const DEFAULT_CONFIG: HostSupervisorConfig = {
	backoff: { baseMs: 1_000, factor: 2, maxMs: 30_000, jitterMs: 500 },
	maxRestartAttempts: 5,
	startupTimeoutMs: 120_000,
}

/**
 * Owns one profile's host lifecycle. States are only ever the five supervisor
 * phases; pids are never surfaced as state. Launch failures, readiness timeouts,
 * and unexpected exits all restart with configured backoff until
 * `maxRestartAttempts`, then park in `failed` with a user notification. An
 * explicit `stop()` is final for that run.
 */
export function createHostSupervisor(deps: HostSupervisorDeps, config: HostSupervisorConfig = DEFAULT_CONFIG) {
	const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
	let phase: SupervisorPhase = 'stopped'
	let profile: string | null = null
	let restartAttempt = 0
	let lastError: string | null = null
	let run: HostLease | null = null
	let generation = 0
	let stopping = false
	const phaseListeners = new Set<(state: HostSupervisorState) => void>()

	const snapshot = (): HostSupervisorState => ({ phase, profile, restartAttempt, lastError })

	const setPhase = (next: SupervisorPhase): void => {
		phase = next
		for (const listener of phaseListeners) listener(snapshot())
	}

	const scheduleRestart = (message: string): void => {
		lastError = message
		run = null
		void restartWithBackoff()
	}

	const handleExit = (info: HostExitInfo): void => {
		if (run === null || stopping) return
		scheduleRestart(`host exited unexpectedly (code ${info.code ?? 'null'}, signal ${info.signal ?? 'null'})`)
	}

	const launchOnce = async (): Promise<void> => {
		const current = generation
		stopping = false
		setPhase('starting')
		let lease: HostLease
		try {
			lease = await deps.launch(profile ?? 'default')
		} catch (error) {
			scheduleRestart(`host launch failed: ${error instanceof Error ? error.message : String(error)}`)
			return
		}
		if (current !== generation) {
			// A stop() raced the launch: reap what just came up and stay stopped.
			await lease.stopTree()
			return
		}
		run = lease
		lease.onExit((info) => {
			if (run !== lease) return
			handleExit(info)
		})
		try {
			await withTimeout(lease.ready, config.startupTimeoutMs, `host not ready within ${config.startupTimeoutMs}ms`)
		} catch (error) {
			if (run !== lease) return
			const message = error instanceof Error ? error.message : String(error)
			await lease.stopTree().catch(() => { /* reaping a failed launch is best-effort; the restart loop retries */ })
			scheduleRestart(message)
			return
		}
		if (run !== lease) return
		// restartAttempt survives a healthy relaunch: only an explicit start()/stop()
		// clears it, so a crash loop cannot hide behind brief running windows.

		setPhase('running')
	}

	const restartWithBackoff = async (): Promise<void> => {
		const attempt = restartAttempt + 1
		if (attempt > config.maxRestartAttempts) {
			setPhase('failed')
			deps.notify(`DSH host kept failing; gave up after ${config.maxRestartAttempts} restarts. ${lastError ?? ''}`.trim())
			return
		}
		restartAttempt = attempt
		setPhase('starting')
		await wait(restartDelayMs(config.backoff, attempt))
		if (stopping || run !== null) return
		await launchOnce()
	}

	return {
		onPhaseChange(listener: (state: HostSupervisorState) => void): () => void {
			phaseListeners.add(listener)
			return () => phaseListeners.delete(listener)
		},
		getState: snapshot,

		/** Sweeps leftovers from a crashed previous run, then starts one host run. */
		async start(profileName: string): Promise<HostSupervisorState> {
			if (phase === 'starting' || phase === 'running') return snapshot()
			profile = profileName
			generation += 1
			restartAttempt = 0
			lastError = null
			try {
				await deps.cleanupLeftovers(profileName)
			} catch (error) {
				lastError = `leftover sweep failed: ${error instanceof Error ? error.message : String(error)}`
				setPhase('blocked')
				deps.notify(`DSH host cannot start: ${lastError}. Close leftover processes and try again.`)
				return snapshot()
			}
			await launchOnce()
			return snapshot()
		},

		/** Stops the current run's whole process tree; the supervisor parks in `stopped`. */
		async stop(): Promise<HostSupervisorState> {
			generation += 1
			stopping = true
			const current = run
			if (current !== null) {
				run = null
				try {
					await current.stopTree()
				} catch (error) {
					lastError = `stop failed: ${error instanceof Error ? error.message : String(error)}`
				}
			}
			setPhase('stopped')
			return snapshot()
		},
	}
}

async function withTimeout(promise: Promise<void>, ms: number, message: string): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | null = null
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms)
	})
	try {
		await Promise.race([promise, timeout])
	} finally {
		if (timer !== null) clearTimeout(timer)
	}
}
