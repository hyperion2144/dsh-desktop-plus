// 日志导出（IO 层）：tar.gz 单包、包内按源分文件，manifest 注明范围与近似口径。
//
// 时间过滤口径（与 bun 壳一致）：
//   - 归档份按文件名「内容日」整体进出，`from` 端向前多捞 1 天兜跨天轮转边界；
//   - 壳活跃文件按行首本地时间戳逐行过滤，解析不出时间的行保留；
//   - relay 活跃文件按行首 ISO 戳逐行过滤（同规则）；
//   - webview 活跃文件是**整文件近似**（页面日志行没有时间戳），manifest 里注明。
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  offsetDayKey,
  parseIsoLineDay,
  parseLineDay,
  pickArchivesForRange,
  type ExportRange,
} from './archive-plan.ts'
import { createTarGz, type TarEntry } from './tar.ts'
import { LOG_STEMS, type LoggingKernel } from './kernel.ts'

/** 导出输入：内核、落盘目录、范围与时钟。 */
export interface ExportLogsInput {
  kernel: LoggingKernel
  destDir: string
  range: ExportRange
  now: Date
}

/** 导出结果：产物路径、体积、近似口径与归档份数。 */
export interface ExportLogsResult {
  path: string
  bytes: number
  approximations: string[]
  archivesIncluded: number
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** 导出包名：`dsh-logs-YYYYMMDD-HHmmss.tar.gz`（本地时区）。 */
export function exportLogsFileName(now: Date): string {
  const date = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `dsh-logs-${date}-${time}.tar.gz`
}

function filterLinesByDay(content: string, range: ExportRange, parse: (line: string) => string | null): string {
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const kept = lines.filter((line) => {
    const day = parse(line)
    // 解析不出时间的行保留：宁可多给，不给少。
    if (day === null) return true
    if (range.from !== undefined && day < range.from) return false
    if (range.to !== undefined && day > range.to) return false
    return true
  })
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`
}

/**
 * 按范围导出日志为单个 tar.gz。
 *
 * @param input 内核、目标目录、时间范围与当前时刻。
 * @returns 产物绝对路径、体积、近似说明与纳入的归档份数。
 */
export function exportLogRange(input: ExportLogsInput): ExportLogsResult {
  const { kernel } = input
  const approximations: string[] = []
  const entries: TarEntry[] = []

  const rows = kernel.archiveRows()
  const picked = pickArchivesForRange(rows, input.range)
  for (const row of picked) {
    try {
      entries.push({
        name: `archive/${row.name}`,
        data: readFileSync(join(kernel.archiveDir, row.name)),
      })
    } catch {
      // 单份读不到不炸整个导出（可能刚被并发清理）。
    }
  }

  const files = kernel.files()
  if (existsSync(files.shell)) {
    const filtered = filterLinesByDay(readFileSync(files.shell, 'utf8'), input.range, parseLineDay)
    entries.push({ name: 'active/shell.log', data: Buffer.from(filtered, 'utf8') })
  }
  if (existsSync(files.webview)) {
    entries.push({ name: 'active/dsh-desktop-webview.log', data: readFileSync(files.webview) })
    if (input.range.from !== undefined || input.range.to !== undefined) {
      approximations.push('active/dsh-desktop-webview.log 为整文件近似：页面日志行没有时间戳，无法按行过滤时间')
    }
  }
  if (existsSync(files.relay)) {
    const filtered = filterLinesByDay(readFileSync(files.relay, 'utf8'), input.range, parseIsoLineDay)
    entries.push({ name: 'active/shell-relay.log', data: Buffer.from(filtered, 'utf8') })
  }

  const manifest = {
    generatedAt: input.now.toISOString(),
    range: { from: input.range.from ?? null, to: input.range.to ?? null },
    archivesIncluded: picked.length,
    approximations,
    sources: Object.values(LOG_STEMS),
  }
  entries.push({
    name: 'manifest.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  })

  mkdirSync(input.destDir, { recursive: true })
  const path = join(input.destDir, exportLogsFileName(input.now))
  const packed = createTarGz(entries)
  writeFileSync(path, packed)
  let bytes = packed.length
  try {
    bytes = statSync(path).size
  } catch {
    // stat 失败就用内存长度：写入刚发生，概率极低。
  }
  return { path, bytes, approximations, archivesIncluded: picked.length }
}

/**
 * 预设范围 → 日键区间（「今天」= 本地零点；7d/30d 含今天）。
 *
 * @param preset today | 7d | 30d | all | custom
 * @param from custom 起始日（YYYY-MM-DD 或 YYYYMMDD）
 * @param to custom 截止日（缺省同 from）
 * @param now 当前时刻
 * @returns 日键区间；all 返回空对象表示不设界
 */
export function resolveRangePreset(
  preset: 'today' | '7d' | '30d' | 'all' | 'custom',
  from: string | undefined,
  to: string | undefined,
  now: Date,
): ExportRange {
  const today = `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      return { from: offsetDayKey(today, -6), to: today }
    case '30d':
      return { from: offsetDayKey(today, -29), to: today }
    case 'custom': {
      if (from === undefined || from === '') throw new Error('export_log_range: 自定义范围需要 from（YYYY-MM-DD 或 YYYYMMDD）')
      const normalizedFrom = from.replaceAll('-', '')
      const normalizedTo = to === undefined || to === '' ? normalizedFrom : to.replaceAll('-', '')
      return { from: normalizedFrom, to: normalizedTo }
    }
    case 'all':
    default:
      return {}
  }
}
