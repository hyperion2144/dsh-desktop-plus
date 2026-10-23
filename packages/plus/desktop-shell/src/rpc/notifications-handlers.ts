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

/** 场景展示分组（顺序即设置页里出现的顺序），与 bun 壳一致。 */
export const NOTIFICATION_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['g-run', '启动与服务'],
  ['g-win', '窗口与实例'],
  ['g-prof', 'Profile'],
  ['g-dl', '下载'],
  ['g-task', '任务'],
  ['g-cfg', '配置'],
]

/** 通知场景元数据（设置页 15 张场景卡的数据源，与旧壳逐条对齐）。 */
export interface NotificationScenarioMeta {
  id: string
  group: string
  name: string
  desc: string
  defaultOn: boolean
}

export const NOTIFICATION_SCENARIOS: readonly NotificationScenarioMeta[] = [
  { id: 'startup.error', group: 'g-run', name: '启动受阻', desc: 'spawn 失败 · 自愈封顶', defaultOn: true },
  { id: 'service.health', group: 'g-run', name: '服务健康', desc: '不可达 · 自动重启', defaultOn: true },
  { id: 'window.lifecycle', group: 'g-win', name: '窗口生命周期', desc: '窗口恢复 / 异常', defaultOn: false },
  { id: 'instance.lifecycle', group: 'g-win', name: '实例生命周期', desc: '端口认领冲突 / 归属提示', defaultOn: false },
  { id: 'profile.op', group: 'g-prof', name: 'Profile 操作', desc: '新建 / 迁移完成', defaultOn: true },
  { id: 'profile.error', group: 'g-prof', name: 'Profile 错误', desc: '启动失败 / 修复失败', defaultOn: true },
  { id: 'download.complete', group: 'g-dl', name: '下载完成', desc: '文件下载结束', defaultOn: true },
  { id: 'task.complete', group: 'g-task', name: '任务完成', desc: '失焦时提醒回来看看', defaultOn: true },
  { id: 'config.error', group: 'g-cfg', name: '配置错误', desc: 'token 无法识别等', defaultOn: true },
  { id: 'config.info', group: 'g-cfg', name: '配置提示', desc: '端口保存等低危信息', defaultOn: false },
  { id: 'register.cli', group: 'g-cfg', name: 'CLI 注册', desc: '注册/注销 dsh 系统命令的结果反馈', defaultOn: true },
  { id: 'dsh.approval', group: 'g-task', name: '等待审批', desc: 'dsh 会话等待你的审批确认', defaultOn: true },
  { id: 'dsh.error', group: 'g-task', name: '会话错误', desc: 'dsh 会话运行出错', defaultOn: true },
]
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
        // 场景不能是空数组：通知设置页靠它渲染场景卡（分组 + 默认开关 + 当前配置）。
        scenarios: NOTIFICATION_SCENARIOS.map((meta) => ({
          ...meta,
          config: config.scenarios[meta.id] ?? { enabled: meta.defaultOn, sound: 'default' },
        })),
        groups: NOTIFICATION_GROUPS,
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
