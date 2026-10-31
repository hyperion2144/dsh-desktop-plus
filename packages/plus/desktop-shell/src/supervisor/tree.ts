/** Default process-tree control and leftover sweeping for the host supervisor. */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Stops a host process and everything it spawned. POSIX hosts run as process-group
 * leaders, so `-pid` reaches the whole tree; Windows uses `taskkill /T`. Escalates
 * from SIGTERM to SIGKILL after `graceMs`.
 */
export async function stopProcessTree(pid: number, graceMs = 5_000): Promise<void> {
	if (!Number.isInteger(pid) || pid <= 0) throw new Error(`stopProcessTree: invalid pid ${pid}`)
	if (process.platform === 'win32') {
		await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'])
		return
	}
	signalTree(pid, 'SIGTERM')
	if (await waitUntilGone(pid, graceMs)) return
	signalTree(pid, 'SIGKILL')
	if (!(await waitUntilGone(pid, 2_000))) throw new Error(`process tree ${pid} survived SIGKILL`)
}

function signalTree(pid: number, signal: NodeJS.Signals): void {
	try {
		process.kill(-pid, signal)
	} catch {
		// No group leader (already reaped): fall back to the single process.
		try {
			process.kill(pid, signal)
		} catch {
			// Already gone.
		}
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

async function waitUntilGone(pid: number, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		if (!alive(pid)) return true
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	return !alive(pid)
}

/**
 * Builds a `cleanupLeftovers` implementation from a pid file: kills a still-running
 * host from a crashed previous run (which also releases its claimed ports) and
 * removes the stale file. Callers that keep no pid file pass a path that never exists.
 */
export function pidFileCleanupLeftovers(pidFile: string): () => Promise<void> {
	return async () => {
		if (!existsSync(pidFile)) return
		const raw = readFileSync(pidFile, 'utf8').trim()
		rmSync(pidFile, { force: true })
		const pid = Number(raw)
		if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) return
		await stopProcessTree(pid).catch(() => { /* a leftover that resists reaping must not block startup */ })
	}
}
