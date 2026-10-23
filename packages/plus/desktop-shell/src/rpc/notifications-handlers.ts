// 通知命令的壳侧实现（contracts/notifications.ts 的中性行）。
// 配置持久化在 desktop-settings.json 的 notification_config 键（单写者、原子写），
// 投递面（policy/sleep-gate/sound 校验）复用 #18 的 notifications 服务模块；
// 音效文件收进 $DSH_HOME/sounds/。

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadDesktopSettings, saveDesktopSettings } from './desktop-settings.ts'
import { validateSoundFile } from '../notifications/sound.ts'

/** Builds sound facts from a path; duration is unknown before decode, playback enforces it. */
function soundFacts(path: string): { extension: string; sizeBytes: number; durationSeconds: number } {
	return { extension: path.slice(path.lastIndexOf('.')), sizeBytes: statSync(path).size, durationSeconds: 0 }
}
import type { NotificationsConfig } from '@deepseek-ai/dsh-desktop-plus-plugin/contracts'
import type { RpcHandlers } from './types.ts'

const DEFAULT_CONFIG: NotificationsConfig = {
  enabled: true,
  dnd: { on: false, from: '22:00', to: '08:00', suppressFullscreen: true },
  scenarios: {},
}

/** Reads the persisted notification config with defaults for missing parts. */
export function loadNotificationConfig(dshHome: string): NotificationsConfig {
  const settings = loadDesktopSettings(dshHome)
  const raw = settings['notification_config']
  if (typeof raw !== 'object' || raw === null) return DEFAULT_CONFIG
  const config = raw as Partial<NotificationsConfig>
  return {
    enabled: config.enabled !== false,
    dnd: { ...DEFAULT_CONFIG.dnd, ...(typeof config.dnd === 'object' && config.dnd !== null ? config.dnd : {}) },
    scenarios: typeof config.scenarios === 'object' && config.scenarios !== null ? { ...config.scenarios } : {},
  }
}

export interface NotificationsRpcDeps {
  dshHome: () => string
  bundleId: () => string | null
  capability: () => import('@deepseek-ai/dsh-desktop-plus-plugin/contracts').SoundCapabilityReport | null
  previewSound: (file: string | undefined) => boolean
  chooseSoundFile: () => string | undefined
  log?: ((line: string) => void) | undefined
}

export function createNotificationsRpcHandlers(deps: NotificationsRpcDeps): RpcHandlers {
  const log = deps.log ?? (() => { })
  const soundsDir = (): string => join(deps.dshHome(), 'sounds')
  const soundNames = (): string[] => {
    const dir = soundsDir()
    return existsSync(dir) ? readdirSync(dir) : []
  }
  const resolveSoundFile = (name: string): string | undefined => {
    if (name === '' || name === 'default') return undefined
    const bare = name.startsWith('custom:') ? name.slice(7) : name
    const file = join(soundsDir(), bare)
    return existsSync(file) ? file : undefined
  }
  return {
    get_notifications_state: () => {
      const config = loadNotificationConfig(deps.dshHome())
      const names = soundNames()
      return {
        permission: 'granted',
        config,
        scenarios: [],
        groups: [],
        sounds: names,
        capability: deps.capability(),
        bundleId: deps.bundleId(),
      }
    },

    set_notifications_config: (params) => {
      const config = params.config
      if (typeof config !== 'object' || config === null) throw new Error('notification config must be an object')
      saveDesktopSettings(deps.dshHome(), { notification_config: config })
      log('notification config saved')
      return { config }
    },

    request_notification_permission_cmd: () => ({ granted: true, permission: 'granted' as const, prompted: false }),

    preview_notification_sound: (params) => {
      const name = typeof params.sound === 'string' && params.sound !== '' ? params.sound
        : typeof params.name === 'string' ? params.name : 'default'
      const audible = deps.previewSound(resolveSoundFile(name))
      return { played: name, sound: name, audible }
    },

    choose_notification_sound: () => {
      const chosen = deps.chooseSoundFile()
      if (chosen === undefined) return null
      const check = validateSoundFile(soundFacts(chosen))
      if (!check.ok) {
        log(`sound rejected: ${check.reason}`)
        return null
      }
      mkdirSync(soundsDir(), { recursive: true })
      const name = chosen.split('/').pop() ?? 'sound'
      copyFileSync(chosen, join(soundsDir(), name))
      return name
    },

    import_notification_sound: (params) => {
      const source = typeof params.path === 'string' ? params.path : ''
      if (source === '' || !existsSync(source)) throw new Error(`file not found: ${source}`)
      const check = validateSoundFile(soundFacts(source))
      if (!check.ok) throw new Error(check.reason)
      mkdirSync(soundsDir(), { recursive: true })
      const name = source.split('/').pop() ?? 'sound'
      copyFileSync(source, join(soundsDir(), name))
      log(`notification sound imported: ${name}`)
      return name
    },
  }
}
