// 统一日志内核（IO 层）——照 bun 壳的 logging 模块口径重写。
//
// 三个活跃文件是契约：`shell.log` / `dsh-desktop-webview.log` / `shell-relay.log`，
// 路径与文件名不变。轮转产物 gzip 进 `<logs>/archive/`，命名
// `<源词干>-<内容起始日>-<当日序号>.log.gz`（内容日，不是轮转时刻）。
//
// 为什么要有这一层：日志是排障的第一现场，必须「能写、能转、能清、能导、能看健康」，
// 而不是只有样式。写失败要可感知（health 计数 + 一条 `[logging]` 告警），不能静默。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import {
  ARCHIVE_DIR_NAME,
  archiveFileName,
  localDayKey,
  parseArchiveFileName,
  parseLineDay,
  retentionPlan,
  type ArchiveRow,
} from './archive-plan.ts'

/** 三个日志源；文件名是契约红线，永不变。 */
export type LogSource = 'shell' | 'webview' | 'relay'

/** 源 → 文件名词干。 */
export const LOG_STEMS: Record<LogSource, string> = {
  shell: 'shell',
  webview: 'dsh-desktop-webview',
  relay: 'shell-relay',
}

/** 级别（数值越大越严重）；阈值以下的写入直接丢弃。 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** 单份活跃文件上限（与 bun 壳一致：10 MB）。 */
export const LOG_MAX_BYTES = 10_000_000

/** 默认保留天数与总量上限（归档合计 + 活跃合计）。 */
export const LOG_DEFAULT_MAX_DAYS = 14
export const LOG_DEFAULT_MAX_TOTAL_BYTES = 200_000_000

/** 日志 IO 健康度：写/转/删失败不再静默。 */
export interface LogHealth {
  io_error_count: number
  last_io_error: string | null
}

/** 一条活跃文件的现状（wire 形状，字段名 snake_case）。 */
export interface LogActiveFile {
  source: LogSource
  path: string
  bytes: number
  rotated: number
}

/** `list_log_files` 的回执形状（契约 logging.ts）。 */
export interface LogListing {
  archive_dir: string
  level: string
  archives: Array<{ name: string, source: LogSource, day: string, seq: number, bytes: number }>
  active: LogActiveFile[]
  health: LogHealth
}

/** 内核依赖：目录、级别、保留策略与时钟。 */
export interface LoggingKernelOptions {
  /** `$DSH_HOME/logs`。 */
  logsDir: string
  /** 固定级别，或每次判定时现读的回调（面板热切换用后者）。 */
  level?: LogLevel | (() => LogLevel)
  maxDays?: number
  maxTotalBytes?: number
  now?: () => Date
}

/** 日志内核句柄。 */
export interface LoggingKernel {
  append: (source: LogSource, level: LogLevel, message: string) => void
  appendRaw: (source: LogSource, line: string) => void
  files: () => Record<LogSource, string>
  archiveDir: string
  archiveRows: () => ArchiveRow[]
  list: () => LogListing
  clear: () => { removed_files: number, bytes_freed: number }
  health: () => LogHealth
  setLevel: (level: LogLevel) => void
  level: () => LogLevel
  runRetention: () => void
}

const pad = (value: number, width = 2): string => String(value).padStart(width, '0')

/** 本地时区时间戳，与 bun 壳逐字一致（两边日志能对着 grep）。 */
function formatStamp(now: Date): string {
  return (
    `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
  )
}

/**
 * 统一日志内核：一个进程一个实例，三源共用一个 sink。
 *
 * @param options 目录、级别、保留策略与时钟（测试注入固定时钟）。
 * @returns 追加、列举、清理、健康度与保留执行的句柄。
 */
export function createLoggingKernel(options: LoggingKernelOptions): LoggingKernel {
  const now = options.now ?? (() => new Date())
  const archiveDir = join(options.logsDir, ARCHIVE_DIR_NAME)
  const maxDays = options.maxDays ?? LOG_DEFAULT_MAX_DAYS
  const maxTotalBytes = options.maxTotalBytes ?? LOG_DEFAULT_MAX_TOTAL_BYTES
  let explicitLevel: LogLevel = typeof options.level === 'string' ? options.level : 'info'
  /** 每次判定都现读：面板把 log_level 写进设置文件后立即生效，不需要重启。 */
  const readLevel = (): LogLevel => (typeof options.level === 'function' ? options.level() : explicitLevel)
  let ioErrorCount = 0
  let lastIoError: string | null = null

  const files = (): Record<LogSource, string> => ({
    shell: join(options.logsDir, `${LOG_STEMS.shell}.log`),
    webview: join(options.logsDir, `${LOG_STEMS.webview}.log`),
    relay: join(options.logsDir, `${LOG_STEMS.relay}.log`),
  })

  const noteError = (detail: string): void => {
    ioErrorCount += 1
    lastIoError = detail
  }

  const ensureDirs = (): void => {
    try {
      mkdirSync(archiveDir, { recursive: true })
    } catch (error) {
      noteError(`mkdir ${archiveDir}: ${String(error)}`)
    }
  }

  const sizeOf = (path: string): number => {
    try {
      return existsSync(path) ? statSync(path).size : 0
    } catch {
      return 0
    }
  }

  /** 当前文件第一行所属的内容日；读不到/空文件用「今天」。 */
  const contentDayOf = (path: string, fallback: string): string => {
    try {
      if (!existsSync(path)) return fallback
      const head = readFileSync(path, 'utf8').slice(0, 4096)
      for (const line of head.split('\n')) {
        const day = parseLineDay(line)
        if (day !== null) return day
      }
      return fallback
    } catch {
      return fallback
    }
  }

  const rotate = (source: LogSource): void => {
    const path = files()[source]
    const stem = LOG_STEMS[source]
    try {
      if (!existsSync(path) || sizeOf(path) === 0) return
      ensureDirs()
      const day = contentDayOf(path, localDayKey(now()))
      const existing = readdirSync(archiveDir)
      const sameDay = existing.filter((name) => {
        const parsed = parseArchiveFileName(name)
        return parsed !== null && parsed.stem === stem && parsed.day === day
      })
      const seq = sameDay.length + 1
      const target = join(archiveDir, archiveFileName(stem, day, seq))
      writeFileSync(target, gzipSync(readFileSync(path)))
      truncateSync(path, 0)
    } catch (error) {
      noteError(`rotate ${source}: ${String(error)}`)
    }
  }

  const runRetention = (): void => {
    try {
      const rows = archiveRows()
      const activeBytes = (Object.keys(LOG_STEMS) as LogSource[])
        .map((source) => sizeOf(files()[source]))
        .reduce((sum, size) => sum + size, 0)
      const plan = retentionPlan({ archives: rows, activeBytes, maxDays, maxTotalBytes, now: now() })
      for (const name of plan.delete) {
        try {
          rmSync(join(archiveDir, name), { force: true })
        } catch (error) {
          noteError(`prune ${name}: ${String(error)}`)
        }
      }
    } catch (error) {
      noteError(`retention: ${String(error)}`)
    }
  }

  /** 写一行；调用方负责给出级别。超过大小线或跨内容日时先轮转再写。 */
  const write = (source: LogSource, text: string): void => {
    const path = files()[source]
    try {
      mkdirSync(options.logsDir, { recursive: true })
      const size = sizeOf(path)
      const dayChanged = size > 0 && contentDayOf(path, localDayKey(now())) !== localDayKey(now())
      if (dayChanged || (size > 0 && size + text.length > LOG_MAX_BYTES)) {
        rotate(source)
        runRetention()
      }
      appendFileSync(path, text)
    } catch (error) {
      // 壳日志自己写不下去时只能退 stderr——绝不递归回内核。
      noteError(`append ${source}: ${String(error)}`)
      try {
        process.stderr.write(`[logging] ${text}`)
      } catch {
        // stderr 也写不了：已经无从记录，保留 health 计数即可。
      }
    }
  }

  const archiveRows = (): ArchiveRow[] => {
    try {
      if (!existsSync(archiveDir)) return []
      const rows: ArchiveRow[] = []
      for (const name of readdirSync(archiveDir)) {
        const parsed = parseArchiveFileName(name)
        if (parsed === null) continue
        rows.push({ name, day: parsed.day, seq: parsed.seq, bytes: sizeOf(join(archiveDir, name)) })
      }
      return rows.sort((left, right) => (left.day === right.day ? left.seq - right.seq : left.day < right.day ? 1 : -1))
    } catch (error) {
      noteError(`list archives: ${String(error)}`)
      return []
    }
  }

  return {
    append: (source, lineLevel, message) => {
      // relay 源由内核代管（轮转/归档/保留/导出），写入在 relay 进程：级别过滤不作用它。
      if (source !== 'relay' && LEVEL_ORDER[lineLevel] < LEVEL_ORDER[readLevel()]) return
      const tag = `[${source}] [${lineLevel}]`
      write(source, `${formatStamp(now())} ${tag} ${message}\n`)
    },
    appendRaw: (source, line) => { write(source, line.endsWith('\n') ? line : `${line}\n`) },
    files,
    archiveDir,
    archiveRows,
    list: () => {
      const archives = archiveRows().map((row) => {
        const parsed = parseArchiveFileName(row.name)
        const stem = parsed?.stem ?? ''
        const source: LogSource = stem === LOG_STEMS.shell
          ? 'shell'
          : stem === LOG_STEMS.webview
            ? 'webview'
            : 'relay'
        return { name: row.name, source, day: row.day, seq: row.seq, bytes: row.bytes }
      })
      const active: LogActiveFile[] = (Object.keys(LOG_STEMS) as LogSource[]).map((source) => ({
        source,
        path: files()[source],
        bytes: sizeOf(files()[source]),
        rotated: archives.filter((entry) => entry.source === source).length,
      }))
      return {
        archive_dir: archiveDir,
        level: readLevel(),
        archives,
        active,
        health: { io_error_count: ioErrorCount, last_io_error: lastIoError },
      }
    },
    clear: () => {
      let removed = 0
      let bytes = 0
      try {
        for (const name of existsSync(archiveDir) ? readdirSync(archiveDir) : []) {
          const path = join(archiveDir, name)
          bytes += sizeOf(path)
          rmSync(path, { force: true })
          removed += 1
        }
        for (const source of Object.keys(LOG_STEMS) as LogSource[]) {
          const path = files()[source]
          if (!existsSync(path)) continue
          bytes += sizeOf(path)
          truncateSync(path, 0)
          removed += 1
        }
      } catch (error) {
        noteError(`clear: ${String(error)}`)
      }
      return { removed_files: removed, bytes_freed: bytes }
    },
    health: () => ({ io_error_count: ioErrorCount, last_io_error: lastIoError }),
    setLevel: (next) => { explicitLevel = next },
    level: () => readLevel(),
    runRetention,
  }
}
