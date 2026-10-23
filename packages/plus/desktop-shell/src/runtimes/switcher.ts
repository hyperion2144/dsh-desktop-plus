/**
 * Runtime selection orchestration: startup resolution with fallback, and
 * guarded switching between installed runtimes. Pure logic; filesystem,
 * verification, and restart effects are injected.
 */

import { clearSelectedRuntime, loadSelectedRuntime, runtimeRootFor } from './store.ts'

/** Verification port mirroring the official `verifyDesktopRuntime` contract. */
export type RuntimeVerifier = (root: string, version: string) => Promise<void>

/** Outcome of resolving which runtime root the shell should boot. */
export type StartupRuntimeSelection =
  | { readonly kind: 'builtin' }
  | { readonly kind: 'selected'; readonly version: string; readonly root: string }
  | { readonly kind: 'fallback'; readonly version: string; readonly reason: string }

/** Ports `resolveStartupRuntimeSelection` needs. */
export interface StartupRuntimeDeps {
  verifyRuntime: RuntimeVerifier
  clearSelected(): void
}

/**
 * Decide the runtime root for this launch. A persisted selection that fails
 * verification is cleared and reported as a fallback with a readable reason;
 * the shell then boots the built-in runtime.
 */
export async function resolveStartupRuntimeSelection(
  userDataDir: string,
  deps: StartupRuntimeDeps,
  readSelected: typeof loadSelectedRuntime = loadSelectedRuntime,
): Promise<StartupRuntimeSelection> {
  const selection = readSelected(userDataDir)
  if (selection === null) return { kind: 'builtin' }
  const root = runtimeRootFor(userDataDir, selection.version)
  try {
    await deps.verifyRuntime(root, selection.version)
  } catch (error) {
    deps.clearSelected()
    return { kind: 'fallback', version: selection.version, reason: errorMessage(error) }
  }
  return { kind: 'selected', version: selection.version, root }
}

/** A switch was refused before any state changed. */
export class RuntimeSwitchError extends Error {
  /** @param message Readable refusal reason, safe to surface in UI. */
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeSwitchError'
  }
}

/** Ports `switchRuntime` needs. */
export interface RuntimeSwitchDeps {
  /** True when the version directory exists and carries the runtime marker. */
  isInstalled(version: string): boolean
  verifyRuntime: RuntimeVerifier
  saveSelected(version: string): void
  /** Tear down hosts and relaunch the shell; never returns normally in the real implementation. */
  requestRestart(): void
}

/**
 * Switch to an installed runtime: verify first (a failing target is refused
 * before any state changes), persist the selection, then request a restart.
 * The restart boots every host on the new root; the splash sequence rebuilds
 * the window, so no in-process host surgery is needed.
 */
export async function switchRuntime(userDataDir: string, version: string, deps: RuntimeSwitchDeps): Promise<void> {
  if (!deps.isInstalled(version)) throw new RuntimeSwitchError(`runtime ${version} is not installed`)
  const root = runtimeRootFor(userDataDir, version)
  try {
    await deps.verifyRuntime(root, version)
  } catch (error) {
    throw new RuntimeSwitchError(`runtime ${version} failed verification: ${errorMessage(error)}`)
  }
  deps.saveSelected(version)
  deps.requestRestart()
}

/**
 * Drop a selection that no longer verifies. Used when the user wants to go
 * back to the built-in runtime without reinstalling anything.
 */
export function revertToBuiltinRuntime(userDataDir: string, clear?: typeof clearSelectedRuntime): void {
  ;(clear ?? clearSelectedRuntime)(userDataDir)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
