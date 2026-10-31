/**
 * In-place application restart: the main process keeps its pid while every
 * host and the tray are rebuilt.
 *
 * Ordering follows the tray-first rule from the shell kernel: the tray is
 * recreated before any host starts, the official backend restarts next, then
 * every plus profile restarts independently — one failing profile never
 * blocks the others.
 */

/** everything the in-place restart needs to rebuild. */
export type RestartAllTargets = {
  /** restarts the official desktop backend (close, then reconcile). */
  official: { restart: () => Promise<void> }
  /** restartable plus profiles in launch order. */
  profiles: Array<{ name: string, restart: () => Promise<void> }>
  /** recreates the tray from current state. */
  recreateTray: () => void
  /** optional progress reporter (splash line); called before each stage. */
  report?: (stage: string) => void
}


/** outcome of one in-place restart. */
export type RestartAllOutcome = {
  /** profiles that restarted successfully, in launch order. */
  restarted: Array<string>
  /** profiles whose restart threw, with the failure reason. */
  failed: Array<{ name: string, reason: string }>
}

/**
 * Restarts everything without exiting the main process.
 *
 * @param targets the official backend, the plus profiles, and the tray.
 * @returns which profiles restarted and which failed, with reasons.
 */
export async function restartApplicationInPlace(targets: RestartAllTargets): Promise<RestartAllOutcome> {
  targets.report?.('tray')
  targets.recreateTray()
  targets.report?.('dsh')
  await targets.official.restart()
  const outcome: RestartAllOutcome = { restarted: [], failed: [] }
  for (const profile of targets.profiles) {
    targets.report?.(profile.name)
    try {
      await profile.restart()
      outcome.restarted.push(profile.name)
    } catch (error) {
      outcome.failed.push({ name: profile.name, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return outcome
}
