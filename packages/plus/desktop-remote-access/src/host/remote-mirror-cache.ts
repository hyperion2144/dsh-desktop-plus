//! 镜像缓存（#107）：A 的会话事件在本机的一份顺序副本，带 seq 水位。
//!
//! 支撑三件事：重启后从水位续传（不重下整段历史）、离线时仍可读、接管时做种子与回推时做前缀。
//! 事件保持**远端原始 seq**——水位与缺口检测都按它算；本机镜像会话里的重编号是另一回事（见 remote-sessions.ts）。
//!
//! 落点：`<root>/remote-sessions/<hostId>/<sid>.jsonl`，生产环境 root 是按 profile 隔离的目录
//! （`$DSH_HOME/storages/remote-access/profiles/<profile>`）。主机 id 带斜杠与冒号，做目录名时整体转义。
//!
//! 文件格式：第一行是元信息，之后每行一个事件。写到一半的最后一行（断电 / 崩溃）读取时丢弃：
//! 从第一条解析不了的行起全部不再采信，中间不会悄悄少一条。

import fs from 'node:fs'
import path from 'node:path'
import type { RemoteSessionEvent } from './remote-sessions.js'

/** 缓存文件的元信息。 */
export interface MirrorCacheMeta {
  /** 提供会话的主机 id。 */
  hostId: string
  /** 远端会话 id。 */
  sessionId: string
  /** 会话在 A 上的工作目录。 */
  cwd: string
  /** 会话在 A 上的创建时间（毫秒，未知时省略）。 */
  createdAt?: number
}

/** 读出的缓存。 */
export interface MirrorCacheSnapshot {
  /** 元信息。 */
  meta: MirrorCacheMeta
  /** 事件，按远端 seq 升序。 */
  events: RemoteSessionEvent[]
  /** 水位：最后一条事件的远端 seq；没有事件时为 -1。 */
  watermark: number
}

/** 镜像缓存的读写面。 */
export interface MirrorCache {
  /** 读缓存；不存在或不可读时返回 undefined。 */
  read: (hostId: string, remoteSessionId: string) => MirrorCacheSnapshot | undefined
  /** 当前水位；没有缓存时为 -1。 */
  watermark: (hostId: string, remoteSessionId: string) => number
  /** 追加一批事件（按远端 seq 升序）；缓存文件不存在时先写入元信息。写失败会抛错。 */
  append: (meta: MirrorCacheMeta, events: readonly RemoteSessionEvent[]) => void
  /** 删除缓存；不存在时什么也不做。 */
  remove: (hostId: string, remoteSessionId: string) => void
}

/** 元信息行的标记。 */
const META_KIND = 'meta'

function fileOf(rootDir: string, hostId: string, remoteSessionId: string): string {
  return path.join(rootDir, 'remote-sessions', encodeURIComponent(hostId), `${encodeURIComponent(remoteSessionId)}.jsonl`)
}

/** 把一行解析成事件；不是合法事件时返回 undefined。 */
function eventOfLine(line: string): RemoteSessionEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const record = parsed as Partial<RemoteSessionEvent>
  if (typeof record.type !== 'string' || typeof record.seq !== 'number' || typeof record.time !== 'number') return undefined
  const event: RemoteSessionEvent = { type: record.type, seq: record.seq, time: record.time, data: record.data }
  if (record.surfaceOp !== undefined) event.surfaceOp = record.surfaceOp
  if (record.sourceEventSeqs !== undefined) event.sourceEventSeqs = record.sourceEventSeqs
  return event
}

function lineOfEvent(event: RemoteSessionEvent): string {
  return JSON.stringify({
    seq: event.seq,
    time: event.time,
    type: event.type,
    data: event.data,
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
    ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
  })
}

/**
 * 建一个镜像缓存。
 * @param rootDir 缓存根目录（其下再分 `remote-sessions/<hostId>/<sid>.jsonl`）。
 * @returns 缓存的读写面。
 */
export function createMirrorCache(rootDir: string): MirrorCache {
  const read = (hostId: string, remoteSessionId: string): MirrorCacheSnapshot | undefined => {
    const file = fileOf(rootDir, hostId, remoteSessionId)
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error(`镜像缓存读取失败（${file}）：${String((error as Error)?.message ?? error)}`)
    }
    const lines = text.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    const first = lines[0]
    if (first === undefined) return undefined
    let meta: (MirrorCacheMeta & { kind?: unknown }) | undefined
    try {
      meta = JSON.parse(first) as MirrorCacheMeta & { kind?: unknown }
    } catch {
      // 元信息行本身残缺：整个文件不可信，按没有缓存处理，下一次同步会重新写。
      return undefined
    }
    if (meta.kind !== META_KIND || typeof meta.sessionId !== 'string') return undefined
    const { kind: _kind, ...rest } = meta
    const events: RemoteSessionEvent[] = []
    for (const line of lines.slice(1)) {
      // 从第一条解析不了的行起全部不再采信：写到一半的尾巴就在这里被丢掉。
      const event = eventOfLine(line)
      if (event === undefined) break
      events.push(event)
    }
    return {
      meta: { hostId: rest.hostId, sessionId: rest.sessionId, cwd: rest.cwd, ...(rest.createdAt === undefined ? {} : { createdAt: rest.createdAt }) },
      events,
      watermark: events.at(-1)?.seq ?? -1,
    }
  }

  return {
    read,
    watermark: (hostId, remoteSessionId) => read(hostId, remoteSessionId)?.watermark ?? -1,
    append(meta, events) {
      const file = fileOf(rootDir, meta.hostId, meta.sessionId)
      const exists = fs.existsSync(file)
      // 一次写入整批：批内不会出现「写了一半」的行，最坏情况是这批全部没落下，由水位保证下次重拉。
      const body = exists ? '' : `${JSON.stringify({ kind: META_KIND, ...meta })}\n`
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      fs.appendFileSync(file, body + (events.length === 0 ? '' : `${events.map(lineOfEvent).join('\n')}\n`), { mode: 0o600 })
    },
    remove(hostId, remoteSessionId) {
      const file = fileOf(rootDir, hostId, remoteSessionId)
      try {
        fs.rmSync(file, { force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw new Error(`镜像缓存删除失败（${file}）：${String((error as Error)?.message ?? error)}`)
      }
    },
  }
}
