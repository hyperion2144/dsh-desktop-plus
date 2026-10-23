import { Menu, Tray, type MenuItemConstructorOptions } from 'electron'
import {
  dispatchApplicationClick,
  dispatchProfileClick,
  resolveProfileClick,
  type TrayProfileActions,
  type TrayWindowState,
} from './menu-model.ts'

/** sources the tray reads on every refresh; all getters re-read live state. */
export type ProfileTrayDeps = {
  /** absolute path of the tray icon image. */
  icon: string
  /** ordered live profile entries: stable name plus running flag. */
  getStates: () => Array<{ name: string, running: boolean }>
  /** live window facts for one profile; missing profile reads as hidden. */
  getWindowState: (name: string) => TrayWindowState
  /** localized labels for the application-level entries. */
  labels: { restartApp: string, quitApp: string, showHide: string, restart: string, quit: string }
  /** injected click operations. */
  actions: TrayProfileActions
  /** profiles whose lifecycle the tray may not manage keep restart and quit disabled. */
  canManage?: (name: string) => boolean
}

/** live handle of the plus profile tray. */
export type ProfileTray = {
  /** rebuilds the menu from current state without recreating the Tray. */
  refresh: () => void
  /** removes the tray icon; safe to call again. */
  destroy: () => void
}

/**
 * Creates the tray whose top level is profile management. One entry per
 * profile with show-or-focus, restart, and quit; application-level restart
 * and quit below a separator. Remote addresses appear only as their profile.
 *
 * @param deps icon, live state getters, localized labels, and click actions.
 * @returns the tray handle; `refresh` re-reads state on every call.
 */
export function createProfileTray(deps: ProfileTrayDeps): ProfileTray {
  const tray = new Tray(deps.icon)
  tray.setToolTip('DeepSeek Harness Plus')
  const build = (): void => {
    const template: MenuItemConstructorOptions[] = deps.getStates().map((state) => ({
      label: state.name,
      submenu: [
        {
          label: deps.labels.showHide,
          click: () => {
            const resolved = resolveProfileClick(deps.getWindowState(state.name))
            dispatchProfileClick(state.name, resolved, deps.getWindowState(state.name), deps.actions)
          },
        },
        {
          label: deps.labels.restart,
          enabled: state.running && (deps.canManage?.(state.name) ?? true),
          click: () => { dispatchProfileClick(state.name, 'restart', deps.getWindowState(state.name), deps.actions) },
        },
        {
          label: deps.labels.quit,
          enabled: state.running && (deps.canManage?.(state.name) ?? true),
          click: () => { dispatchProfileClick(state.name, 'quit', deps.getWindowState(state.name), deps.actions) },
        },
      ],
    }))
    template.push(
      { type: 'separator' },
      { label: deps.labels.restartApp, click: () => { dispatchApplicationClick('restart-app', deps.actions) } },
      { label: deps.labels.quitApp, click: () => { dispatchApplicationClick('quit-app', deps.actions) } },
    )
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }
  build()
  return {
    refresh: build,
    destroy: () => { tray.destroy() },
  }
}
