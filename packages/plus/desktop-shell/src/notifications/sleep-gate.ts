/** Reference-counted sleep suppression so N concurrent long tasks share one blocker. */

/** The powerSaveBlocker seam (Electron's powerSaveBlocker object satisfies this). */
export interface PowerSaveBlockerLike {
	start(type: 'prevent-app-suspension'): number
	stop(id: number): void
	isStarted(id: number): boolean
}

/** Per-task sleep gate handle: acquire on start, release exactly once on finish. */
export interface SleepGate {
	/** Register a long task; starts the blocker on the first registration. */
	acquire(key: string): void
	/** Unregister; stops the blocker when the last task leaves. Unknown keys are ignored. */
	release(key: string): void
	/** Whether any task still holds the gate. */
	active(): boolean
	/** Release everything at once (shutdown path); must never leak the blocker. */
	dispose(): void
}

/** @param blocker - powerSaveBlocker seam. @returns the shared gate. */
export function createSleepGate(blocker: PowerSaveBlockerLike): SleepGate {
	let blockerId: number | null = null
	const holders = new Set<string>()

	const stop = (): void => {
		if (blockerId !== null && blocker.isStarted(blockerId)) blocker.stop(blockerId)
		blockerId = null
	}

	return {
		acquire(key) {
			holders.add(key)
			if (blockerId === null) blockerId = blocker.start('prevent-app-suspension')
		},
		release(key) {
			if (!holders.delete(key)) return
			if (holders.size === 0) stop()
		},
		active: () => holders.size > 0,
		dispose() {
			holders.clear()
			stop()
		},
	}
}
