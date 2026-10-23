// plus 桌面设置存储（bun 口径：$DSH_HOME/desktop-settings.json，宿主单写者）。
// 官方 settings.ts 只管壳自身的 updates 开关；plus 的设置面（运行时/更新偏好/通知
// 场景/日志保留/托盘/登录启动）住在这个独立文件里，走原子写，坏文件回落默认。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** plus 设置的默认值；键随版本增加，读侧对缺失键回落这里。 */
export const DEFAULT_DESKTOP_SETTINGS: Record<string, unknown> = {
  prevent_sleep: false,
  notification_scenes: { updates: true, downloads: true, profiles: true, diagnostics: true },
  do_not_disturb: false,
  log_retention_days: 14,
  tray_click_behavior: 'show-hide',
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
