/** Shell-owned modal that confirms one profile deletion; the deletion rule stays with the caller. */
import { BrowserWindow, app, ipcMain } from 'electron'

/** Channels available only to the isolated delete-confirm document. */
export const PROFILE_DELETE_IPC = {
  confirm: 'dsh-profile-delete:confirm',
  cancel: 'dsh-profile-delete:cancel',
} as const

/**
 * Opens the delete-confirm modal and resolves with the user's choice.
 *
 * @param parent - window the modal belongs to; omitted when a tray click starts the flow.
 * @param name - profile name shown in the copy.
 * @returns true when the user confirmed the deletion; false on cancel or close.
 */
export async function confirmProfileDelete(parent: BrowserWindow | undefined, name: string): Promise<boolean> {
  const window = new BrowserWindow({
    width: 440,
    height: 220,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    ...(parent === undefined ? {} : { parent, modal: true }),
    webPreferences: {
      preload: `${app.getAppPath()}/lib/preload-profile-delete.cjs`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.setMenu(null)
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (confirmed: boolean): void => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(PROFILE_DELETE_IPC.confirm)
      ipcMain.removeHandler(PROFILE_DELETE_IPC.cancel)
      if (!window.isDestroyed()) window.destroy()
      resolve(confirmed)
    }
    ipcMain.handle(PROFILE_DELETE_IPC.confirm, () => {
      setTimeout(() => { finish(true) }, 0)
      return { ok: true }
    })
    ipcMain.handle(PROFILE_DELETE_IPC.cancel, () => { finish(false) })
    window.on('closed', () => { finish(false) })
    // 必须走 dsh-app://shell 文档 origin：preload 的守卫按它判定，loadFile 会让桥不注入。
    void window.loadURL(`dsh-app://shell/profile-delete.html?name=${encodeURIComponent(name)}`)
      .then(() => { if (!window.isDestroyed()) window.show() })
      .catch((error: unknown) => {
        console.error('profile delete confirm: failed to load the document', error)
        finish(false)
      })
  })
}
