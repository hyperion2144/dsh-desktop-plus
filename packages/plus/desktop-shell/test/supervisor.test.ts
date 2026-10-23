/** Supervisor behavior tests: backoff restarts, restart ceiling, stop, sweep. (ticket #15) */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostSupervisor } from '../src/supervisor/supervisor.ts'
import { restartDelayMs } from '../src/supervisor/backoff.ts'
import { pidFileCleanupLeftovers, stopProcessTree } from '../src/supervisor/tree.ts'
import type { HostLease, HostSupervisorConfig, HostSupervisorDeps, SupervisorPhase } from '../src/supervisor/types.ts'

const CONFIG: HostSupervisorConfig = {
	backoff: { baseMs: 10, factor: 1, maxMs: 20, jitterMs: 0 },
	maxRestartAttempts: 3,
	startupTimeoutMs: 100,
}

interface FakeLease {
	lease: HostLease
	readonly pid: number
	readonly stopTree: ReturnType<typeof vi.fn>
	fail(message: string): void
	resolveReady(): void
}

function fakeDeps(options: { autoReady?: boolean } = {}) {
	const launches: FakeLease[] = []
	const cleanups: string[] = []
	const notes: string[] = []
	let nextPid = 100
	const deps: HostSupervisorDeps = {
		launch: vi.fn(async () => {
			let readyResolve: () => void = () => { }
			let readyReject: (error: Error) => void = () => { }
			const ready = new Promise<void>((resolve, reject) => {
				readyResolve = resolve
				readyReject = reject
			})
			const stopTree = vi.fn(async () => { readyReject(new Error('stopped')) })
			const pid = nextPid++
			const lease: FakeLease = {
				pid,
				stopTree,
				lease: { pid, ready, stopTree, onExit: (listener) => { exitListener = listener } },
				fail: (message) => exitListener?.({ code: 1, signal: null }),
				resolveReady: readyResolve,
			}
			let exitListener: ((info: { code: number | null; signal: string | null }) => void) | null = null
			launches.push(lease)
			if (options.autoReady !== false) queueMicrotask(() => readyResolve())
			return lease.lease
		}),
		cleanupLeftovers: vi.fn(async (profile: string) => { cleanups.push(profile) }),
		notify: vi.fn((message: string) => { notes.push(message) }),
		wait: vi.fn(async () => { }),
	}
	return { deps, launches, cleanups, notes }
}

describe('restartDelayMs', () => {
	const backoff = { baseMs: 1_000, factor: 2, maxMs: 10_000, jitterMs: 0 }
	it.each([
		[1, 1_000],
		[2, 2_000],
		[3, 4_000],
		[5, 10_000],
		[9, 10_000],
	])('attempt %i -> %ims', (attempt, expected) => {
		expect(restartDelayMs(backoff, attempt, () => 0)).toBe(expected)
	})
	it('adds jitter below the bound', () => {
		expect(restartDelayMs({ ...backoff, jitterMs: 100 }, 1, () => 0.5)).toBe(1_050)
	})
})

describe('host supervisor', () => {
	it('goes starting -> running on a healthy launch and sweeps leftovers first', async () => {
		const { deps, cleanups } = fakeDeps()
		const supervisor = createHostSupervisor(deps, CONFIG)
		const phases: SupervisorPhase[] = []
		supervisor.onPhaseChange((state) => phases.push(state.phase))
		const state = await supervisor.start('work')
		expect(state.phase).toBe('running')
		expect(cleanups).toEqual(['work'])
		expect(phases).toEqual(['starting', 'running'])
	})

	it('restarts with backoff after a crash and keeps the attempt across a healthy relaunch', async () => {
		const { deps, launches } = fakeDeps()
		const supervisor = createHostSupervisor(deps, CONFIG)
		await supervisor.start('work')
		const waits = deps.wait as ReturnType<typeof vi.fn>
		waits.mockClear()
		launches[0]!.fail('boom')
		await vi.waitFor(() => { expect(launches.length).toBe(2) })
		// the attempt survives a healthy relaunch; only an explicit start()/stop() clears it
		expect(supervisor.getState().restartAttempt).toBe(1)
		expect(waits).toHaveBeenCalledWith(10)
		expect(supervisor.getState().phase).toBe('running')
	})

	it('gives up after maxRestartAttempts, notifies, and parks in failed', async () => {
		const { deps, launches, notes } = fakeDeps()
		const supervisor = createHostSupervisor(deps, CONFIG)
		await supervisor.start('work')
		for (let round = 1; round <= 6; round += 1) {
			if (supervisor.getState().phase === 'failed') break
			launches[launches.length - 1]!.fail('boom')
			await vi.waitFor(() => {
				if (supervisor.getState().phase === 'failed') return
				expect(launches.length).toBeGreaterThan(round)
			})
		}
		await vi.waitFor(() => { expect(supervisor.getState().phase).toBe('failed') })
		expect(notes).toHaveLength(1)
		expect(notes[0]).toContain('gave up after 3 restarts')
		const launchesAfterGiveUp = launches.length
		launches[launches.length - 1]!.fail('again')
		expect(launches.length).toBe(launchesAfterGiveUp)
	})

	it('treats a readiness timeout as a failure and reaps the stuck launch', async () => {
		const { deps, launches } = fakeDeps({ autoReady: false })
		const supervisor = createHostSupervisor(deps, CONFIG)
		const started = supervisor.start('work')
		await vi.waitFor(() => { expect(launches[0]!.stopTree).toHaveBeenCalled() })
		await started
		await vi.waitFor(() => { expect(launches.length).toBeGreaterThanOrEqual(2) })
	})

	it('stop() reaps the current tree and parks in stopped; later crashes do not restart', async () => {
		const { deps, launches } = fakeDeps()
		const supervisor = createHostSupervisor(deps, CONFIG)
		await supervisor.start('work')
		const state = await supervisor.stop()
		expect(state.phase).toBe('stopped')
		expect(launches[0]!.stopTree).toHaveBeenCalled()
		launches[0]!.fail('late crash')
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(launches.length).toBe(1)
	})

	it('start() while running is a no-op', async () => {
		const { deps, launches } = fakeDeps()
		const supervisor = createHostSupervisor(deps, CONFIG)
		await supervisor.start('work')
		await supervisor.start('other')
		expect(launches.length).toBe(1)
		expect(supervisor.getState().profile).toBe('work')
	})
})

describe('stopProcessTree', () => {
	it.runIf(process.platform !== 'win32')('kills a spawned child tree', async () => {
		const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
		try {
			await new Promise((resolve) => setTimeout(resolve, 100))
			await stopProcessTree(child.pid!, 2_000)
			expect(() => process.kill(child.pid!, 0)).toThrow()
		} finally {
			try { child.kill('SIGKILL') } catch { /* already reaped */ }
		}
	}, 15_000)

	it('rejects invalid pids', async () => {
		await expect(stopProcessTree(0)).rejects.toThrow('invalid pid')
	})
})

describe('pidFileCleanupLeftovers', () => {
	it('removes a stale pid file without a live process', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'sup-'))
		const pidFile = join(dir, 'host.pid')
		writeFileSync(pidFile, '999999999\n')
		await pidFileCleanupLeftovers(pidFile)()
		expect(existsSync(pidFile)).toBe(false)
	})
})

describe('blocked phase', () => {
	it('parks in blocked and notifies when the leftover sweep fails', async () => {
		const { deps, launches, notes } = fakeDeps()
		deps.cleanupLeftovers = vi.fn(async () => { throw new Error('port 6390 busy') })
		const supervisor = createHostSupervisor(deps, CONFIG)
		const state = await supervisor.start('work')
		expect(state.phase).toBe('blocked')
		expect(state.lastError).toContain('port 6390 busy')
		expect(launches).toHaveLength(0)
		expect(notes).toHaveLength(1)
	})
})
