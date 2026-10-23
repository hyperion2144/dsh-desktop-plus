/** Login-at-launch toggle over Electron's `setLoginItemSettings`, kept failure-safe for startup. */

/**
 * Minimal app surface used by the login-item helpers.
 *
 * - `setLoginItemSettings` - registers or removes the OS login item.
 * - `getLoginItemSettings` - reads back the registered state.
 */
export interface LoginItemApp {
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
  getLoginItemSettings(): { openAtLogin: boolean }
}

/** Environment switch read once at startup: `1` enables, `0` disables, unset leaves the OS state alone. */
export const LOGIN_ITEM_ENV = 'DSH_DESKTOP_SET_LOGIN_ITEM'

/**
 * Read the current login-at-launch registration.
 * @param app - Electron app or test double.
 * @returns whether the app is registered to launch at login.
 */
export function isLoginItemEnabled(app: LoginItemApp): boolean {
  return app.getLoginItemSettings().openAtLogin
}

/**
 * Enable or disable launch at login.
 * @param app - Electron app or test double.
 * @param enabled - desired registration state.
 * @returns false when the OS call threw; the caller decides whether to surface it.
 */
export function setLoginItemEnabled(app: LoginItemApp, enabled: boolean): boolean {
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return true
  } catch (error) {
    console.warn(`plus login item: failed to ${enabled ? 'enable' : 'disable'}: ${String(error)}`)
    return false
  }
}

/**
 * Apply the `DSH_DESKTOP_SET_LOGIN_ITEM` environment switch at startup.
 * Never throws: a failing OS call must not block application launch.
 * @param app - Electron app or test double.
 * @param env - environment to read; defaults to `process.env`.
 * @returns the applied state, or null when the switch is unset or the call failed.
 */
export function applyLoginItemFromEnv(
  app: LoginItemApp,
  env: NodeJS.ProcessEnv = process.env,
): boolean | null {
  const raw = env[LOGIN_ITEM_ENV]
  if (raw !== '1' && raw !== '0') return null
  const desired = raw === '1'
  return setLoginItemEnabled(app, desired) ? desired : null
}
