/** Structural seams the shell kernel depends on; the Electron side supplies the implementations. */

/** Minimal application surface the kernel touches; structural, so tests and the shell can stub it. */
export interface ShellApp {
  whenReady(): Promise<void>
  quit(): void
  on(event: 'will-quit', listener: () => void): unknown
  getPath(name: 'userData'): string
  setPath(name: 'userData', path: string): void
}

/** A created tray icon; destroying it removes the icon from the system tray. */
export interface TrayHandle {
  destroy(): void
}

/** Lifecycle of the DSH host behind the shell, reported by the shell through `noteHostPhase`. */
export type HostPhase = 'stopped' | 'starting' | 'ready' | 'failed'

/** Observable kernel status; the tray and future surfaces read it instead of poking kernel internals. */
export interface ShellKernelState {
  readonly tray: boolean
  readonly hostPhase: HostPhase
}

/** Dependencies injected from the Electron shell; every Electron-specific detail stays on that side. */
export interface ShellKernelDeps {
  readonly app: ShellApp
  /** The shell's own single-instance claim; skipped entirely for isolated instances. */
  readonly claimSingleInstance: (refocus: () => void) => boolean
  /** Create the plus-owned tray icon; called once per `start()`, after the app is ready. */
  readonly createTray: (actions: { readonly onQuit: () => void }) => TrayHandle
  /** The shell's quit path, so the tray quit goes through the same confirmation as every other entry. */
  readonly quit: () => void
  readonly log?: (line: string) => void
}

/** The kernel seam the official shell holds: claim, start, observe, dispose, rebuild. */
export interface ShellKernel {
  /** Own the instance or run isolated; must be called before `app.whenReady()`. */
  claimSingleInstance(refocus: () => void): boolean
  /** Create the tray and lifecycle hooks; idempotent, callable again after `dispose()`. */
  start(): void
  /** Report the DSH host lifecycle; host failure never removes the tray. */
  noteHostPhase(phase: HostPhase, error?: unknown): void
  ownsTray(): boolean
  /** Tear the kernel down; the same instance can `start()` again in the same process. */
  dispose(): Promise<void>
  readonly state: ShellKernelState
}
