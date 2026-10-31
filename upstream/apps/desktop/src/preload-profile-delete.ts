/** Isolated bridge for the shell-owned delete-confirm modal only. */
import { contextBridge, ipcRenderer } from 'electron'
import { PROFILE_DELETE_IPC } from './profile-delete-window.ts'

const api = {
  confirm: () => ipcRenderer.invoke(PROFILE_DELETE_IPC.confirm) as Promise<{ ok: boolean }>,
  cancel: () => ipcRenderer.invoke(PROFILE_DELETE_IPC.cancel) as Promise<void>,
}

// 前缀匹配：文档 URL 带 ?name=（向 renderer 传 profile 名），全等会把桥拒掉。
if (location.href.startsWith('dsh-app://shell/profile-delete.html')) contextBridge.exposeInMainWorld('dshProfileDelete', api)
