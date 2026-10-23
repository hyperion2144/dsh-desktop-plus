/**
 * Pure click-resolution for the plus profile tray.
 *
 * The tray's top level IS profile management: one entry per profile with the
 * three per-profile actions, then application-level restart and quit. Remote
 * addresses are not listed separately — one remote address is one profile and
 * shows up as that profile's entry.
 */

/** injected per-profile operations; every action must be a real effect. */
export type TrayProfileActions = {
  /** shows the profile window, or focuses it when visible but unfocused. */
  showOrFocus: (name: string) => void
  /** starts a not-running profile: full host bring-up plus its window. */
  startProfile: (name: string) => void
  /** hides the profile window. */
  hide: (name: string) => void
  /** restarts the profile: full process tree, window rebuilt through splash. */
  restart: (name: string) => void
  /** quits the profile: runtime destroyed, window closed. */
  quit: (name: string) => void
  /** restarts the application without exiting the main process. */
  restartApp: () => void
  /** quits the application through the confirm-quit flow. */
  quitApp: () => void
}

/** window visibility/focus facts needed to resolve the show/hide click. */
export type TrayWindowState = {
  visible: boolean
  focused: boolean
}

/**
 * Resolves the per-profile primary click. A click on an unfocused profile
 * focuses it — never hides; only an already-focused profile toggles to hide.
 *
 * @param state current window visibility and focus.
 * @returns the action the click maps to.
 */
export function resolveProfileClick(state: TrayWindowState): 'show-or-focus' | 'hide' {
  if (!state.visible) return 'show-or-focus'
  return state.focused ? 'hide' : 'show-or-focus'
}

/**
 * Dispatches a profile click to the injected actions.
 *
 * @param name profile name from the menu entry.
 * @param action resolved click action.
 * @param state current window state, used only for show-or-focus vs hide.
 * @param actions injected operations.
 */
export function dispatchProfileClick(
  name: string,
  action: 'show-or-focus' | 'hide' | 'restart' | 'quit',
  state: TrayWindowState,
  actions: TrayProfileActions,
): void {
  if (action === 'restart') { actions.restart(name); return }
  if (action === 'quit') { actions.quit(name); return }
  if (resolveProfileClick(state) === 'hide') actions.hide(name)
  else actions.showOrFocus(name)
}

/**
 * Dispatches an application-level tray click.
 *
 * @param entry the application entry that was clicked.
 * @param actions injected operations.
 */
export function dispatchApplicationClick(entry: 'restart-app' | 'quit-app', actions: TrayProfileActions): void {
  if (entry === 'restart-app') actions.restartApp()
  else actions.quitApp()
}

/** One top-level slot of the plus tray, in the order it is rendered. */
export type TrayMenuSlot = 'profiles' | 'application' | 'separator' | 'restart-app' | 'quit-app'

/**
 * Plans the top-level tray order: the profile section, the application block only when the
 * shell supplies items, then the separator and the two application entries.
 * @param options applicationItemCount - how many items the shell returned for `extraItems`.
 * @returns the slots in render order.
 */
export function trayMenuOrder(options: { applicationItemCount: number }): TrayMenuSlot[] {
  return [
    'profiles',
    ...(options.applicationItemCount === 0 ? [] : ['separator' as const, 'application' as const]),
    'separator',
    'restart-app',
    'quit-app',
  ]
}
