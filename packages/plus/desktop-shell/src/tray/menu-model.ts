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
 * Resolves the tray's application-level left click across every open profile.
 * The target window decides: a focused window hides, anything else comes forward.
 * A window that is on screen but lost focus is focused, never hidden — hiding it
 * would make the user click twice to get back to it.
 * @param states - every open profile with its live window facts.
 * @param target - profile the click acts on.
 * @returns the action the click maps to, the profiles it applies to, and the focus target.
 */
export function resolveTrayClick(
  states: readonly { readonly name: string, readonly window: TrayWindowState }[],
  target: string | undefined,
): { readonly action: 'hide' | 'show', readonly names: readonly string[], readonly focus: string | undefined } {
  const focused = target === undefined ? undefined : states.find((state) => state.name === target)
  const decision = focused === undefined ? 'show-or-focus' : resolveProfileClick(focused.window)
  if (decision === 'hide') {
    return { action: 'hide', names: states.filter((state) => state.window.visible).map((state) => state.name), focus: undefined }
  }
  return { action: 'show', names: states.map((state) => state.name), focus: target }
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
