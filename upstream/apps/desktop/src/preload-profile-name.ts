/** Isolated bridge for the shell-owned profile-name prompt only. */
import { contextBridge, ipcRenderer } from 'electron'
import { PROFILE_NAME_IPC, type ProfileNameResult } from './profile-name-window.ts'

const api = {
  submit: (name: string) => ipcRenderer.invoke(PROFILE_NAME_IPC.submit, name) as Promise<ProfileNameResult>,
  cancel: () => ipcRenderer.invoke(PROFILE_NAME_IPC.cancel) as Promise<void>,
}

if (location.href === 'dsh-app://shell/profile-name.html') contextBridge.exposeInMainWorld('dshProfileName', api)
