/** Shell kernel: the plus-owned lifecycle assets of the desktop shell, built on injected seams. */

import type { HostPhase, ShellKernel, ShellKernelDeps, ShellKernelState, TrayHandle } from './types.ts'

/** Set to a non-empty value to run an isolated instance beside the user's running desktop application. */
export const NO_SINGLETON_ENV = 'DSH_DESKTOP_NO_SINGLETON'

/** @param environment Candidate environment; defaults to `process.env`. @returns Whether the instance must run isolated. */
export function isolatedInstance(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment[NO_SINGLETON_ENV]
  return value !== undefined && value !== ''
}

/**
 * Build the shell kernel. All Electron specifics arrive through `deps`, so the kernel stays a pure
 * lifecycle owner: tray first, host phases observed, disposal reversible within the same process.
 * @param deps Injected application seams from the official shell.
 * @returns The kernel; call `claimSingleInstance` before `app.whenReady()`, then `start()` after it.
 */
export function createShellKernel(deps: ShellKernelDeps): ShellKernel {
  const log = deps.log ?? ((line: string): void => { console.log(`plus shell: ${line}`) })
  let tray: TrayHandle | undefined
  let started = false
  let willQuitHooked = false
  let hostPhase: HostPhase = 'stopped'

  const kernel: ShellKernel = {
    get state(): ShellKernelState {
      return { tray: tray !== undefined, hostPhase }
    },
    claimSingleInstance(refocus: () => void): boolean {
      if (isolatedInstance()) {
        // Isolated instances must never touch the running application: a distinct userData directory
        // keeps Electron's single-instance lock and its storage apart from the user's installation.
        deps.app.setPath('userData', `${deps.app.getPath('userData')}-isolated`)
        log('single-instance claim skipped: isolated instance requested')
        return true
      }
      return deps.claimSingleInstance(refocus)
    },
    start(): void {
      if (started) return
      started = true
      tray = deps.createTray({ onQuit: () => { deps.quit() } })
      if (!willQuitHooked) {
        willQuitHooked = true
        deps.app.on('will-quit', () => { void kernel.dispose() })
      }
      log(`tray ready (host ${hostPhase})`)
    },
    noteHostPhase(phase: HostPhase, error?: unknown): void {
      hostPhase = phase
      if (phase === 'failed') log(`host failed; tray stays available${error === undefined ? '' : `: ${String(error)}`}`)
      else log(`host ${phase}`)
    },
    ownsTray(): boolean {
      return tray !== undefined
    },
    async dispose(): Promise<void> {
      tray?.destroy()
      tray = undefined
      started = false
      hostPhase = 'stopped'
    },
  }
  return kernel
}

export type { HostPhase, ShellKernel, ShellKernelDeps, ShellKernelState, TrayHandle } from './types.ts'
