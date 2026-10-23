/** Shell-owned modal that collects one profile name; the creation rule stays with the caller. */
import { BrowserWindow, app, ipcMain } from 'electron'

/** Channels available only to the isolated profile-name document. */
export const PROFILE_NAME_IPC = {
  submit: 'dsh-profile-name:submit',
  cancel: 'dsh-profile-name:cancel',
} as const

/** What the prompt reports back; a refused name keeps the modal open with its reason. */
export interface ProfileNameResult {
  readonly ok: boolean
  readonly reason?: string
}

/**
 * Opens the profile-name modal and resolves with the created name.
 *
 * The modal owns no rules: the caller's `create` decides whether a name is allowed, so an
 * invalid or taken name comes back as a reason the document shows without closing.
 *
 * @param parent - window the modal belongs to; omitted when a tray click starts the flow.
 * @param create - applies the caller's creation rule.
 * @returns the accepted name, or undefined when the prompt was cancelled or closed.
 */
export async function promptProfileName(
  parent: BrowserWindow | undefined,
  create: (name: string) => { ok: boolean, reason?: string },
): Promise<string | undefined> {
  const window = new BrowserWindow({
    width: 420,
    height: 240,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    ...(parent === undefined ? {} : { parent, modal: true }),
    webPreferences: {
      // 壳 bundle 只允许 electron/events/timers/url 裸导入：路径一律从 app 根拼，不引 node:path。
      preload: `${app.getAppPath()}/lib/preload-profile-name.cjs`,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  window.setMenu(null)
  return await new Promise<string | undefined>((resolve) => {
    let settled = false
    const finish = (name: string | undefined): void => {
      if (settled) return
      settled = true
      ipcMain.removeHandler(PROFILE_NAME_IPC.submit)
      ipcMain.removeHandler(PROFILE_NAME_IPC.cancel)
      if (!window.isDestroyed()) window.destroy()
      resolve(name)
    }
    // Handlers exist before the document loads, so an early submit cannot race registration.
    ipcMain.handle(PROFILE_NAME_IPC.submit, (_event, value: unknown): ProfileNameResult => {
      const name = typeof value === 'string' ? value.trim() : ''
      const outcome = create(name)
      if (!outcome.ok) return { ok: false, reason: outcome.reason ?? '创建失败' }
      // Let the invoke reply reach the document before the window that sent it goes away.
      setTimeout(() => { finish(name) }, 0)
      return { ok: true }
    })
    ipcMain.handle(PROFILE_NAME_IPC.cancel, () => { finish(undefined) })
    window.on('closed', () => { finish(undefined) })
    // 必须走 dsh-app://shell 这个文档 origin：preload 的守卫与 contextBridge 都按它判定，
    // 用 loadFile 会变成 file://，桥不注入 → 点创建/取消都没反应。
    void window.loadURL('dsh-app://shell/profile-name.html')
      .then(() => { if (!window.isDestroyed()) window.show() })
      .catch((error: unknown) => {
        console.error('profile name prompt: failed to load the document', error)
        finish(undefined)
      })
  })
}
