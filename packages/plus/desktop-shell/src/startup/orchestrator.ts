/** Cold-start orchestration: tray → splash → host → window, every stage visible. */

import type { ShellKernel } from '../types.ts'

/**
 * A stage the orchestrator walks through while the user watches the splash.
 * `detail` carries the human-readable reason when a stage fails or wants to
 * report progress text.
 */
export type StartupStage = 'tray' | 'splash' | 'host' | 'window'

/** What the splash shows; `failed: true` parks the splash with the reason. */
export interface StartupStageUpdate {
	stage: StartupStage
	detail?: string
	failed?: boolean
}

/**
 * The splash surface. Stage pushes sent before the page is ready are buffered
 * and flushed on `markReady`, so nothing is ever injected into a blank page.
 */
export interface SplashController {
	/** Pushes a stage update; buffers until the splash page finished loading. */
	setStage(update: StartupStageUpdate): void
	/** Called by the window layer once `did-finish-load` fired; flushes the buffer. */
	markReady(): void
	/** Closes the splash window. Idempotent. */
	dispose(): void
}

/**
 * One cold-start step. Each stage is individually replaceable so tests and
 * future shells can swap any step without touching the sequence.
 */
export interface StartupSteps {
	/** Brings the tray up; must run before anything DSH-related. */
	startTray(): Promise<void> | void
	/** Creates and shows the splash. */
	showSplash(): Promise<SplashController> | SplashController
 	/** Starts the host; resolves once the host is running (or throws with the reason).
 	 * @param onHostOutput - live stdout line from the Host; the splash renders it as progress.
 	 */
 	startHost(onHostOutput: (line: string) => void): Promise<void>
	/** Hands over from the splash to the real window. */
	showMainWindow(): Promise<void> | void
}

export interface StartupResult {
	/** Whether the sequence reached the main window. */
	completed: boolean
	/** The last stage update pushed to the splash (failure reason on failure). */
	lastStage: StartupStageUpdate
}

export type StartupOrchestrator = (steps: StartupSteps) => Promise<StartupResult>

/**
 * Runs the cold-start sequence tray → splash → host → window. Every failure
 * parks on the splash with the reason and resolves (never throws): the app
 * stays alive and the tray remains usable as the self-rescue entry.
 */
export function runStartup(steps: StartupSteps): Promise<StartupResult> {
	return runStartupSequence(steps)
}

/** The concrete sequence; every step comes from `steps` so tests can fake any of them. */
export async function runStartupSequence(steps: StartupSteps): Promise<StartupResult> {
	const tray = await guard('tray', () => steps.startTray())
	if (!tray.completed) return { completed: false, lastStage: tray.lastStage }

	const splash = await guard('splash', () => steps.showSplash())
	if (!splash.completed) return { completed: false, lastStage: splash.lastStage }
	const controller = splash.value!

	controller.setStage({ stage: 'splash' })

 	const host = await guard('host', () => steps.startHost((line) => {
 		controller.setStage({ stage: 'host', detail: line.length > 200 ? `${line.slice(0, 200)}…` : line })
 	}))
	if (!host.completed) {
		controller.setStage({ stage: 'host', ...spreadDetail(host.lastStage.detail), failed: true })
		return { completed: false, lastStage: host.lastStage }
	}
	controller.setStage({ stage: 'host' })

	const window = await guard('window', () => steps.showMainWindow())
	if (!window.completed) {
		controller.setStage({ stage: 'window', ...spreadDetail(window.lastStage.detail), failed: true })
		return { completed: false, lastStage: window.lastStage }
	}
	controller.dispose()
	return { completed: true, lastStage: { stage: 'window' } }
}

type Guarded<T> = { completed: boolean; value?: T; lastStage: StartupStageUpdate }

async function guard<T>(stage: StartupStage, step: () => T | Promise<T>): Promise<Guarded<T>> {
	try {
		return { completed: true, value: await step(), lastStage: { stage } }
	} catch (error) {
		return {
			completed: false,
			lastStage: { stage, detail: error instanceof Error ? error.message : String(error), failed: true },
		}
	}
}

function spreadDetail(detail: string | undefined): { detail?: string } {
	return detail === undefined ? {} : { detail }
}

/** Wires the kernel's host-phase stream into startup stage updates. */
export function hostPhaseToStage(phase: string, detail?: string): StartupStageUpdate {
	switch (phase) {
		case 'running':
			return { stage: 'host' }
		case 'failed':
			return { stage: 'host', ...spreadDetail(detail), failed: true }
		default:
			return { stage: 'host', detail: phase }
	}
}

/** Convenience: assert the kernel owns the instance before any stage runs. */
export function requireTrayOwned(kernel: ShellKernel): void {
	if (!kernel.ownsTray()) throw new Error('plus shell does not own the tray')
}
