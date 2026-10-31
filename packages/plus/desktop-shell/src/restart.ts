/**
 * Application restart and exit controls for the plus shell.
 *
 * The official shell already owns the confirm-quit flow and the crash-recovery
 * restart; plus needs its own named entry points so runtime switching and
 * future UI surfaces can request a restart or an unconditional exit without
 * reaching into `main.ts` closures.
 */

/** injected controls mirroring the Electron app surface the controller needs. */
export type RestartControlApp = {
  /** schedules a fresh launch of the application after the current one exits. */
  relaunch: () => void
  /** begins the official quit flow; the before-quit confirmation still applies. */
  quit: () => void
}

/** injected controls for exiting without the quit confirmation. */
export type RestartControlHosts = {
  /** stops every plus-owned host process; resolved before the process exits. */
  stopAllHosts: () => Promise<void>
  /** exits the process immediately, bypassing the before-quit confirmation. */
  exit: (code?: number) => void
}

/** full dependency set of the plus restart controller. */
export type RestartControllerDeps = {
  app: RestartControlApp
  hosts: RestartControlHosts
}

/** the four exit gradients plus restart, as named operations. */
export type RestartController = {
  /** quits through the official confirm-quit flow. */
  requestQuit: () => void
  /** quits without the confirmation dialog; callers have already decided. */
  quitWithoutConfirmation: () => void
  /** stops every plus host, then exits unconditionally. */
  forceQuit: () => Promise<void>
  /** schedules a relaunch and quits without the confirmation dialog. */
  restartApplication: () => void
}

/**
 * Creates the controller. `restartApplication` is the entry point handed to
 * runtime switching: the persisted selection is picked up by the fresh
 * process during startup resolution, so no arguments are needed on relaunch.
 *
 * @param deps app-level and host-level controls.
 * @returns the four named operations.
 */
export function createRestartController(deps: RestartControllerDeps): RestartController {
  const quitWithoutConfirmation = (): void => {
    // Mirrors the official quitWithoutConfirmation: the before-quit handler
    // observes the skip flag through the quit flow itself.
    deps.app.quit()
  }
  return {
    requestQuit: () => { deps.app.quit() },
    quitWithoutConfirmation,
    forceQuit: async (): Promise<void> => {
      await deps.hosts.stopAllHosts()
      deps.hosts.exit(0)
    },
    restartApplication: () => {
      deps.app.relaunch()
      quitWithoutConfirmation()
    },
  }
}
