// plus 桌面设置存储（bun 口径：$DSH_HOME/desktop-settings.json，宿主单写者）。
// 官方 settings.ts 只管壳自身的 updates 开关；plus 的设置面（运行时/更新偏好/通知
// 场景/日志保留/托盘/登录启动）住在这个独立文件里，走原子写，坏文件回落默认。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** plus 设置的默认值；键随版本增加，读侧对缺失键回落这里。 */
export const DEFAULT_DESKTOP_SETTINGS: Record<string, unknown> = {
  // 缺省开（对齐设置页文案「缺省开」）：此前默认 false 而文案说缺省开，用户以为生效实际 blocker 从未启动。
  prevent_sleep: true,
  notification_scenes: { updates: true, downloads: true, profiles: true, diagnostics: true },
  do_not_disturb: false,
  log_retention_days: 14,
  download_concurrency: 3,
}

/** 读设置；文件缺失或损坏时回落默认（写侧第一次保存会重建文件）。 */
export function loadDesktopSettings(dshHome: string): Record<string, unknown> {
  const file = join(dshHome, 'desktop-settings.json')
  if (!existsSync(file)) return { ...DEFAULT_DESKTOP_SETTINGS }
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_DESKTOP_SETTINGS }
    return { ...DEFAULT_DESKTOP_SETTINGS, ...(raw as Record<string, unknown>) }
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS }
  }
}

/** 原子写一个设置补丁：先读全量，浅合并 patch，tmp+rename 落盘，返回合并后的全量。 */
export function saveDesktopSettings(dshHome: string, patch: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...loadDesktopSettings(dshHome), ...patch }
  const file = join(dshHome, 'desktop-settings.json')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`)
  renameSync(tmp, file)
  return merged
}

/** 远程地址列表（desktop-settings 的 remote_list 键，唯一事实源）：缺键、形状不对或元素非法时丢弃。 */
export function loadRemoteAddressList(dshHome: string): string[] {
	const list = loadDesktopSettings(dshHome)['remote_list']
	if (!Array.isArray(list)) return []
	return list.filter((addr): addr is string => typeof addr === 'string' && /^https?:\/\//.test(addr))
}
