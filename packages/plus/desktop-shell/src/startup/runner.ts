/** Wiring helper for the official main process: fills in the plus defaults. */

import { runStartup } from './orchestrator.ts'
import { createSplashWindow } from './splash.ts'

/** The steps the official shell must supply; the rest is plus-owned. */
export interface PlusStartupSteps {
	/** Brings the plus tray up (kernel.start). Must precede the host. */
	startTray(): void | Promise<void>
	/** Runs the official main() — runtime, host, and window navigation.
	 * @param onHostOutput - live stdout line from the Host; feed it to the splash.
	 */
	startHost(onHostOutput: (line: string) => void): Promise<void>
	/** UI language for the splash copy（currentDesktopLocale().id）。 */
	splashLocale?: string
	/** Optional override for the final window handover; defaults to a no-op
	 * because the official main() already shows the initial window. */
	showMainWindow?(): void | Promise<void>
}

/**
 * Cold-start sequence for the official Electron shell: tray → splash → host
 * (the official main) → window. Failures park on the splash with the reason;
 * the promise never rejects, so the app stays alive and the tray keeps working.
 */
export function runPlusStartup(steps: PlusStartupSteps): Promise<void> {
	return runStartup({
		startTray: steps.startTray,
		showSplash: () => createSplashWindow(steps.splashLocale === undefined ? {} : { locale: steps.splashLocale }),
		startHost: (onHostOutput) => steps.startHost(onHostOutput),
		showMainWindow: steps.showMainWindow ?? (() => { }),
	}).then(() => { })
}
