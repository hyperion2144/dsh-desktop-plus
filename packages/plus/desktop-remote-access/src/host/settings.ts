// settings.yaml 行级 merge（仅用于桌面壳专属键）：保留注释、原子写。
// 顶层键 `dsh-desktop-tauriapp:` 下的子键读取/写入，只动目标行，不动其它内容。
// 值始终以 JSON 字符串形式写（YAML 双引号标量合法，且能表达 Windows 反斜杠路径）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { profileStoragePath } from './profile-scope.js'

const TOP_KEY = 'dsh-desktop-tauriapp'

/** settings.yaml 的绝对路径（$DSH_HOME 优先）。 */
export function settingsPath(): string {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'settings.yaml')
}

// 读子键：返回原始字符串值（未解析），不存在返回 null。
export function readSettingsKey(subKey: string): string | null {
  const p = settingsPath()
  let lines: string[]
  try {
    lines = fs.readFileSync(p, 'utf8').split('\n')
  } catch {
    return null
  }
  const top = lines.findIndex((l) => /^dsh-desktop-tauriapp:\s*$/.test(l))
  if (top < 0) return null
  for (let i = top + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^\S/.test(l) && l.trim()) break; // 下一个顶层键
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/)
    if (m && m[1] === subKey) return m[2]?.trim() ?? ''
  }
  return null
}

// 写子键（行级插入/替换，保留注释），原子写（先 tmp 后 rename）。
// 顶层块不存在则追加；子键不存在则在块头行后插入。
export function writeSettingsKey(subKey: string, rawValue: string): string {
  const p = settingsPath()
  let text: string
  try {
    text = fs.readFileSync(p, 'utf8')
  } catch {
    text = ''
  }
  const lines = text.split('\n')
  const top = lines.findIndex((l) => /^dsh-desktop-tauriapp:\s*$/.test(l))
  const line = `  ${subKey}: ${rawValue}`

  if (top >= 0) {
    // 块内已有该子键 → 替换值
    let replaced = false
    for (let i = top + 1; i < lines.length; i++) {
      const l = lines[i] ?? ''
      if (/^\S/.test(l) && l.trim()) break; // 下一个顶层键
      if (l.startsWith('  ' + subKey + ':')) {
        lines[i] = line
        replaced = true
        break
      }
    }
    if (!replaced) lines.splice(top + 1, 0, line)
  } else {
    // 顶层块不存在 → 追加
    if (lines.length && lines[lines.length - 1]?.trim() !== '') lines.push('')
    lines.push(TOP_KEY + ':')
    lines.push(line)
  }
  const out = lines.join('\n') + '\n'
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, out)
  fs.renameSync(tmp, p)
  return out
}

// 子键值为 YAML 字符串标量（JSON 双引号形式），读取时剥掉包围引号。
export function readSettingsString(subKey: string): string | null {
  const raw = readSettingsKey(subKey)
  if (raw == null) return null
  const m = String(raw).match(/^"(.*)"$/s)
  if (m) {
    try { return JSON.parse(m[0]) as string } catch { return m[1] ?? '' }
  }
  return String(raw)
}

// 读取任意顶层块下的子键标量（如 `ui-theme:` 块的 `preference: dark`）。
// 只做「顶层块 + 二级键」的简单文本解析，不动 YAML 复杂结构。
export function readTopLevelBlockKey(block: string, subKey: string): string | null {
  let lines: string[]
  try {
    lines = fs.readFileSync(settingsPath(), 'utf8').split('\n')
  } catch {
    return null
  }
  const top = lines.findIndex((l) => new RegExp(`^${block}:\\s*$`).test(l))
  if (top < 0) return null
  for (let i = top + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (/^\S/.test(l) && l.trim()) break; // 下一个顶层键
    const m = l.match(/^  ([A-Za-z0-9_-]+):\s*(.*)$/)
    if (m && m[1] === subKey) return m[2]?.trim() ?? ''
  }
  return null
}

// ── #116：壳设置（desktop-settings.json）读写 ──────────────────────────────
// #95 v0.1.7 后壳设置的权威落点是 $DSH_HOME/desktop-settings.json（dsh settings 的插件
// 命名空间与 settings.yaml 均已废除）。远程访问的壳专属键（tunnel_url/cloudflared_bin/ws_*）
// 走这里读写；字段名与 Rust 侧 DesktopSettings 一致（Rust 未知字段会在其读改写时被丢弃）。
// 读改写 + 原子写（tmp+rename），保留文件内其它字段。

/** 壳设置 JSON 的绝对路径（$DSH_HOME 优先）。 */
export function shellSettingsPath(): string {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'desktop-settings.json')
}

/** 读壳设置字段；文件缺失/损坏/字段不存在 → null。 */
export function readShellSetting(subKey: string): unknown {
  try {
    const obj = JSON.parse(fs.readFileSync(shellSettingsPath(), 'utf8')) as Record<string, unknown> | null
    const v = obj?.[subKey]
    return v === undefined ? null : v
  } catch {
    return null
  }
}

// ── #145 独立发布：插件自己的设置落点（按 profile 隔离）────────────────────
// 以前远程访问的配置键（tunnel_url/cloudflared_bin/ws_*）只存在壳的
// desktop-settings.json 里，插件离开桌面壳就读不到。现在权威落点是
// $DSH_HOME/storages/remote-access/profiles/<profile>/settings.json（与 pairing.json
// 同一目录）；壳设置只作为旧数据的一次性迁移来源。

/** 插件设置 JSON 的绝对路径（按 profile 隔离）。 */
export function remoteSettingsPath(): string {
  return profileStoragePath('settings.json')
}

/**
 * 读插件设置字段；插件设置优先，缺失时回退壳设置（旧数据迁移）。
 * @param subKey - 设置键名。
 * @returns 字符串值，或 null（两处都没有）。
 */
export function readRemoteSetting(subKey: string): string | null {
  try {
    const obj = JSON.parse(fs.readFileSync(remoteSettingsPath(), 'utf8')) as Record<string, unknown> | null
    const v = obj?.[subKey]
    if (v !== undefined && v !== null) return typeof v === 'string' ? v : JSON.stringify(v)
  } catch { /* 文件缺失或损坏：继续回退 */ }
  // 旧数据迁移：壳设置里有的键读一次，下次写入就落到插件自己的文件。
  const legacy = readShellSetting(subKey)
  if (legacy === null || legacy === undefined) return null
  return typeof legacy === 'string' ? legacy : JSON.stringify(legacy)
}

/**
 * 写插件设置字段（读改写 + 原子写）；返回写入值。
 * @param subKey - 设置键名。
 * @param value - 要写入的值。
 * @returns 写入的值。
 */
export function writeRemoteSetting(subKey: string, value: unknown): unknown {
  const p = remoteSettingsPath()
  let obj: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown> | null
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed
  } catch { /* 新建 */ }
  obj[subKey] = value
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmp = p + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, p)
  } catch { /* 写失败不抛：设置是尽力而为 */ }
  return value
}

/** 写壳设置字段（读改写 + 原子写）；返回写入值。 */
export function writeShellSetting(subKey: string, value: unknown): unknown {
  const p = shellSettingsPath()
  let obj: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>
  } catch { /* 首次写入或文件损坏 → 新建 */ }
  obj[subKey] = value
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  fs.renameSync(tmp, p)
  return value
}
