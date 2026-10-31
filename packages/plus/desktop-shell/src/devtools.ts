/** Packaged-mode DevTools toggle on the main window: detach mode, no leftover window after close. */

/** Key-down subset of Electron's `Input` relevant to the toggle. */
export interface DevToolsInput {
  type: string
  key: string
  alt: boolean
  meta: boolean
  control: boolean
}

/** Minimal window surface used by the DevTools toggle. */
export interface DevToolsWindow {
  webContents: {
    on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: DevToolsInput) => void): unknown
    off(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: DevToolsInput) => void): unknown
    isDevToolsOpened(): boolean
    openDevTools(options: { mode: 'detach' }): void
    closeDevTools(): void
  }
}

/** Key combinations accepted in packaged mode: `F12` everywhere, plus Alt+Cmd+I on macOS. */
const isToggleKeyCombination = (input: DevToolsInput): boolean => {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F12') return true
  return process.platform === 'darwin' && input.alt && input.meta && (input.key === 'i' || input.key === 'I')
}

/**
 * Toggle DevTools on the window: open detached when closed, close fully when open.
 * @param window - main window or test double.
 */
export function toggleDevTools(window: DevToolsWindow): void {
  if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools()
  else window.webContents.openDevTools({ mode: 'detach' })
}

/** Disposes the input listener installed by {@link attachPackagedDevTools}. */
export interface DevToolsAttachment {
  dispose(): void
}

/**
 * Attach the packaged-mode DevTools toggle to a window via `before-input-event`.
 * Active when packaged, or in development when `DSH_DESKTOP_DEVTOOLS=1`.
 * Never throws to its caller: listener errors are caught per event so startup stays unaffected.
 * @param window - main window or test double.
 * @param packaged - whether the app runs packaged; defaults to false.
 * @param env - environment to read; defaults to `process.env`.
 * @returns a disposer, or null when the toggle is not active in this runtime.
 */
export function attachPackagedDevTools(
  window: DevToolsWindow,
  packaged = false,
  env: NodeJS.ProcessEnv = process.env,
): DevToolsAttachment | null {
  if (!packaged && env.DSH_DESKTOP_DEVTOOLS !== '1') return null
  const listener = (event: { preventDefault(): void }, input: DevToolsInput): void => {
    if (!isToggleKeyCombination(input)) return
    try {
      toggleDevTools(window)
      event.preventDefault()
    } catch (error) {
      console.warn(`plus devtools toggle failed: ${String(error)}`)
    }
  }
  window.webContents.on('before-input-event', listener)
  return { dispose: () => window.webContents.off('before-input-event', listener) }
}
