/** Plus-owned tray icon: the lifecycle anchor that exists before and beyond the DSH host. */

import { Menu, nativeImage, Tray } from 'electron'
import type { TrayHandle } from './types.ts'

/** Actions and copy the tray needs from the shell; labels come from the shell's locale. */
export interface PlusTrayActions {
  /** Context-menu label for quitting, already resolved in the active locale. */
  readonly quitLabel: string
  /** Quit through the shell's own quit path (confirmations included). */
  readonly onQuit: () => void
}

/**
 * Create the tray with the kernel's minimal menu (quit only). The icon survives host failures;
 * only `destroy()` or process exit removes it.
 * @param iconPath Icon readable at runtime; dev builds use repo resources, packaged builds resourcesPath.
 * @param actions Tray actions and copy.
 * @returns A handle whose `destroy()` removes the icon.
 */
export function createPlusTray(iconPath: string, actions: PlusTrayActions): TrayHandle {
  const tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setToolTip('DeepSeek Harness Plus')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: actions.quitLabel, click: () => { actions.onQuit() } },
  ]))
  return { destroy: () => { tray.destroy() } }
}
