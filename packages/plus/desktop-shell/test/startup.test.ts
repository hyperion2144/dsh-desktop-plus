/** Startup orchestrator: sequence, failure parking, per-stage testability. */

import { describe, expect, it, vi } from 'vitest'

import { hostPhaseToStage, runStartup, type SplashController, type StartupStageUpdate, type StartupSteps } from '../src/startup/orchestrator.ts'

function fakeSplash() {
	const pushes: StartupStageUpdate[] = []
	let disposed = 0
	const controller: SplashController = {
		setStage: (update) => { pushes.push(update) },
		markReady: () => { },
		dispose: () => { disposed += 1 },
	}
	return { controller, pushes, get disposed() { return disposed } }
}

function steps(overrides: Partial<StartupSteps> = {}, splash = fakeSplash()): { steps: StartupSteps; splash: ReturnType<typeof fakeSplash> } {
	return {
		splash,
		steps: {
			startTray: vi.fn(),
			showSplash: vi.fn(() => splash.controller),
			startHost: vi.fn(async () => { }),
			showMainWindow: vi.fn(),
			...overrides,
		},
	}
}

describe('runStartup', () => {
	it('walks tray → splash → host → window and disposes the splash on success', async () => {
		const { steps: s, splash } = steps()
		const result = await runStartup(s)
		expect(result.completed).toBe(true)
		expect(s.startTray).toHaveBeenCalledOnce()
		expect(s.startHost).toHaveBeenCalledOnce()
		expect(splash.disposed).toBe(1)
	})

	it('parks on the splash with the reason when the host fails and never throws', async () => {
		const { steps: s, splash } = steps({ startHost: vi.fn(async () => { throw new Error('port busy') }) })
		const result = await runStartup(s)
		expect(result.completed).toBe(false)
		expect(result.lastStage.detail).toBe('port busy')
		expect(splash.pushes.at(-1)).toMatchObject({ stage: 'host', detail: 'port busy', failed: true })
		expect(splash.disposed).toBe(0)
	})

	it('skips later stages when the tray itself fails', async () => {
		const { steps: s, splash } = steps({ startTray: vi.fn(() => { throw new Error('no tray icon') }) })
		const result = await runStartup(s)
		expect(result.completed).toBe(false)
		expect(s.showSplash).not.toHaveBeenCalled()
		expect(result.lastStage).toMatchObject({ stage: 'tray', failed: true })
		expect(splash.disposed).toBe(0)
	})

	it('keeps the splash when the window handover fails', async () => {
		const { steps: s, splash } = steps({ showMainWindow: vi.fn(() => { throw new Error('renderer crash') }) })
		const result = await runStartup(s)
		expect(result.completed).toBe(false)
		expect(splash.pushes.at(-1)).toMatchObject({ stage: 'window', failed: true })
		expect(splash.disposed).toBe(0)
	})
})

describe('hostPhaseToStage', () => {
	it('maps running to a clean host stage and failed to a failure with reason', () => {
		expect(hostPhaseToStage('running')).toEqual({ stage: 'host' })
		expect(hostPhaseToStage('failed', 'oom')).toEqual({ stage: 'host', detail: 'oom', failed: true })
	})
})
