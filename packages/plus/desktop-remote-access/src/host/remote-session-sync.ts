//! 镜像同步（#107）：把 A 上一条会话的事件按 seq 游标分页拉进本机。
//!
//! 两处落点，各管一件事：
//!   · 插件侧镜像缓存（remote-mirror-cache.ts）：远端原始 seq + 水位。重启后从这里续传，不重拉历史；
//!     也是离线阅读、接管种子与回推前缀的数据源。
//!   · 官方会话存储里的镜像会话：id 带 `remote-` 前缀（mirror-id.ts），事件重编号成连续的本机 seq。
//!     官方侧栏、会话页、搜索读的都是它，所以它是本机镜像的**唯一真相**。
//!
//! 磁盘日志是真相，活体会话只是视图：界面打开一条镜像会话时，官方自己从磁盘把它载入活体；
//! 同步不急着建活体，只在界面开着（活体存在）时把新事件按同一套序号也追加给活体。
//!
//! 单写者：镜像只接收从 A 回流的事件，本机从不直写它——对会话的操作经桥接转发到 A 执行（#151）。
//!
//! 写入顺序是「缓存先落盘、磁盘后写」：任何一步崩溃之后，缓存都不落后于磁盘，下一次同步不联网
//! 就能把磁盘缺的尾巴补齐。反方向（缓存文件丢失）靠登记表里的进度跳过已落盘的部分。

import type { RemoteHostRecord } from './remote-hosts.js'
import { mirrorIdOf } from './mirror-id.js'
import type { MirrorCache, MirrorCacheMeta } from './remote-mirror-cache.js'
import type { PersistedSessionHeader, RemoteSessionEvent } from './remote-sessions.js'
import { clampPageLimit, fetchRemoteEventPage, normalizeCreatedAt, SESSION_LOG_VERSION, translateSessionEvents } from './remote-sessions.js'

/** 官方会话存储里同步用到的最小结构契约。 */
export interface MirrorStoreLike {
  /** 取活体会话；不存在返回 undefined。 */
  get: (id: string) => unknown
  /** 建会话并把事件作为初始日志。 */
  create: (id: string, options: { seed: RemoteSessionEvent[]; meta: { cwd: string, createdAt?: number } }) => { readonly id: string }
}

/** 官方持久化服务的读写句柄（只声明同步用到的动作）。 */
export interface MirrorHandleLike {
  /** 追加一批连续事件。 */
  append?: (events: readonly RemoteSessionEvent[]) => Promise<void>
  /** 耐久屏障：返回即已落盘。 */
  flush?: () => Promise<void>
  /** 只读句柄上读出全部事件。 */
  read?: () => Promise<{ events: readonly unknown[] }>
  /** 关闭句柄并释放所有权。 */
  close?: () => Promise<void>
}

/** 官方持久化服务里同步用到的最小结构契约（`ctx.sessionPersistence`）。 */
export interface MirrorPersistenceLike {
  /** 新建一个存储会话并取得写句柄；已存在时抛错。 */
  create: (header: PersistedSessionHeader, options?: { inheritedEventCount?: number }) => Promise<MirrorHandleLike>
  /** 查询会话是否已在存储里。 */
  stat?: (id: string) => Promise<unknown>
  /** 打开已落盘的会话；不存在返回 undefined。 */
  open?: (id: string, access: 'read' | 'write') => Promise<MirrorHandleLike | undefined>
}

/** 官方投影缓存（`sessionProjectionCache`）里同步用到的最小结构契约。 */
export interface MirrorProjectionCacheLike {
  /**
   * 把一条不在内存里的会话的完整日志折一遍投影并写回缓存。
   * 侧栏的标题、列表元数据只从这个缓存读，而官方只给活体会话自动写投影。
   */
  coldSnapshot: (meta: PersistedSessionHeader, inheritedEventCount: number, events: readonly RemoteSessionEvent[]) => unknown
}

/** 一次同步的输入。 */
export interface MirrorSyncRequest {
  /** 已配对主机记录。 */
  host: RemoteHostRecord
  /** 远端会话 id。 */
  remoteSessionId: string
  /** 会话在 A 上的工作目录：写进本机镜像会话头，官方据此把它归到对应的远程工作区。 */
  cwd: string
  /** 官方会话存储（`ctx.sessions`）。 */
  store: MirrorStoreLike
  /** 官方持久化服务；缺省时退化成纯内存镜像（重启后消失）。 */
  persistence?: MirrorPersistenceLike | undefined
  /** 官方投影缓存；缺省时侧栏只能把镜像显示成「未命名」。 */
  projectionCache?: MirrorProjectionCacheLike | undefined
  /** 镜像缓存。 */
  cache: MirrorCache
  /** 已写进官方镜像会话的远端事件数（上一次同步的结果，由登记表恢复）；缺省按磁盘现状推断。 */
  materialized?: number | undefined
  /** 每页条数；缺省取 `SESSION_PAGE_DEFAULT`。 */
  pageSize?: number
  /** 单次最多拉几页；缺省 20。一条超长会话不该独占一轮同步，剩下的留给下一次。 */
  maxPages?: number
}

/** 一次同步的结果。 */
export interface MirrorSyncResult {
  /** 本机镜像会话 id。 */
  localId: string
  /** 本次新写进官方镜像会话的远端事件数（含按缓存补齐磁盘的部分）。 */
  appended: number
  /** 本次从 A 拉到的事件数。 */
  fetched: number
  /** 当前水位：已拉到的最晚远端 seq；什么都没拉到时为 -1。 */
  watermark: number
  /** 官方镜像会话里现有的远端事件总数，交给登记表保存。 */
  materialized: number
  /** 是否已追平 A。受 `maxPages` 限制没拉完时为 false。 */
  caughtUp: boolean
  /** 官方镜像是否写进了持久化存储；没有持久化服务时只有内存镜像，重启后会消失。 */
  durable: boolean
  /** 是否把镜像的完整日志折进了官方投影缓存（侧栏的标题、列表元数据从那里读）。 */
  folded: boolean
  /** 远端已经没有这条会话。 */
  missing?: true
}

/** 单次同步最多拉的页数。 */
const DEFAULT_MAX_PAGES = 20

/** 官方活体会话里同步用到的字段。 */
interface LiveSessionLike {
  /** 下一条事件的本机 seq（即日志长度）。 */
  seq?: unknown
  /** 追加一条事件。 */
  append?: (type: string, data: unknown, options?: { surfaceOp?: unknown }) => unknown
  /** 当前日志快照。 */
  snapshotEvents?: () => readonly { type?: string, data?: unknown, time?: unknown }[]
}

/** 活体会话的下一条 seq；取不到时为 undefined。 */
function nextSeqOf(live: LiveSessionLike): number | undefined {
  return typeof live.seq === 'number' ? live.seq : undefined
}

/** 把一批已重编号的事件追加给活体会话。 */
function appendToLive(live: LiveSessionLike, events: readonly RemoteSessionEvent[]): void {
  if (typeof live.append !== 'function') throw new Error('mirror: 本地会话没有 append 入口')
  for (const event of events) {
    live.append(event.type, event.data, event.surfaceOp === undefined ? undefined : { surfaceOp: event.surfaceOp })
  }
}

/**
 * 打开一条会话日志的句柄。官方持久化服务对不存在的会话是**抛错**（`SessionPersistenceNotFoundError`），
 * 这里统一成「返回 undefined」；其它错误原样抛出。
 */
async function openHandle(persistence: MirrorPersistenceLike, localId: string, access: 'read' | 'write'): Promise<MirrorHandleLike | undefined> {
  try {
    return await persistence.open?.(localId, access)
  } catch (error) {
    const notFound = (error as { name?: unknown } | null)?.name === 'SessionPersistenceNotFoundError'
      || /not found/i.test(String((error as Error)?.message ?? error))
    if (notFound) return undefined
    throw error
  }
}

/** 读磁盘日志里已有的事件；没有日志时返回 undefined。 */
async function diskEventsOf(persistence: MirrorPersistenceLike, localId: string): Promise<RemoteSessionEvent[] | undefined> {
  const handle = await openHandle(persistence, localId, 'read')
  if (handle === undefined) return undefined
  try {
    const stored = await handle.read?.()
    return Array.isArray(stored?.events) ? stored.events as RemoteSessionEvent[] : []
  } finally {
    await handle.close?.()
  }
}

/** 打开写句柄执行一批写入，过一次耐久屏障，再关闭。 */
async function withWrite(persistence: MirrorPersistenceLike, localId: string, write: (handle: MirrorHandleLike) => Promise<void>): Promise<void> {
  const handle = await openHandle(persistence, localId, 'write')
  if (handle === undefined || typeof handle.append !== 'function') throw new Error(`mirror: 存储里没有可写的镜像日志（${localId}）`)
  try {
    await write(handle)
    await handle.flush?.()
  } finally {
    await handle.close?.()
  }
}

/** 写句柄被别的写者占着时官方抛的错（官方为这条会话恢复了 agent 的活体会话持有它）。 */
function writeHandleBusy(error: unknown): boolean {
  return /already owned by an active write handle/i.test(String((error as Error)?.message ?? error))
}

/** 本机镜像会话的落盘头：A 的会话身份不带来，只有镜像 id、工作目录与创建时间。 */
export function mirrorHeader(localId: string, cwd: string, createdAt: number): PersistedSessionHeader {
  return { version: SESSION_LOG_VERSION, id: localId, createdAt, cwd, isSeeded: false, delegationDepth: 0 }
}

/** 建磁盘日志并写入第一批事件。 */
async function createDiskLog(
  persistence: MirrorPersistenceLike,
  localId: string,
  cwd: string,
  createdAt: number,
  events: readonly RemoteSessionEvent[],
): Promise<void> {
  const handle = await persistence.create(
    mirrorHeader(localId, cwd, createdAt),
    { inheritedEventCount: 0 },
  )
  try {
    if (events.length > 0) await handle.append?.(translateSessionEvents(events, 0, localId))
    await handle.flush?.()
  } finally {
    await handle.close?.()
  }
}

/**
 * 把一批新的远端事件写进官方镜像会话。
 *
 * 落点看这条会话此刻在不在内存里：
 * 落点看这条会话此刻在不在内存里，但磁盘始终是唯一的写入路径：
 * - 界面开着、活体与磁盘对得上：先写盘，再把同一批事件补给活体，只为显示。界面里的活体多半只是观察流以
 *   只读句柄载入的（镜像会话上没有本机 agent），它不会替我们落盘——只写给活体，事件就只存在于内存，水位却
 *   前进了，重启后日志就缺一块（实测丢过一条 tool/result，整条镜像被判损坏）。
 * - 写句柄被别的写者占着（官方为这条会话恢复了 agent 的活体，由它落盘）：只写给活体，不去和它抢句柄、错序号。
 * - 没开着：直接追加到磁盘日志，接着已有条数排号；首次写入建日志。
 *
 * 活体落后于磁盘、序号对不上时不硬追加：磁盘是真相，界面重新打开后自然一致。
 */
async function appendToMirror(options: {
  persistence: MirrorPersistenceLike | undefined
  store: MirrorStoreLike
  localId: string
  cwd: string
  createdAt: number
  events: readonly RemoteSessionEvent[]
  /** 已经读过的磁盘日志；缺省时在这里读。 */
  disk?: readonly RemoteSessionEvent[] | undefined
}): Promise<void> {
  const { persistence, store, localId, cwd, createdAt, events } = options
  const live = store.get(localId) as LiveSessionLike | undefined
  if (persistence === undefined) {
    // 没有持久化服务：退化成纯内存镜像。
    if (live === undefined) {
      store.create(localId, { seed: translateSessionEvents(events, 0, localId), meta: { cwd, createdAt } })
      return
    }
    appendToLive(live, translateSessionEvents(events, nextSeqOf(live), localId))
    return
  }
  const disk = options.disk === undefined ? await diskEventsOf(persistence, localId) : options.disk
  if (disk === undefined) {
    await createDiskLog(persistence, localId, cwd, createdAt, events)
    // 内存里已经先有一条空的活体会话时，同一批事件也写给它，两边从第一条起就一致。
    if (live !== undefined && nextSeqOf(live) === 0) appendToLive(live, translateSessionEvents(events, 0, localId))
    return
  }
  if (live !== undefined && liveAlignedWithDisk(live, disk.length)) {
    // 写句柄被别的写者占着时才跳过写盘（由它落盘）；否则磁盘是唯一写入路径。
    try {
      await withWrite(persistence, localId, async (handle) => { await handle.append!(translateSessionEvents(events, disk.length, localId)) })
    } catch (error) {
      if (!writeHandleBusy(error)) throw error
      /* 别的写者持有句柄：它负责落盘 */
    }
    // 界面里的活体接在它自己的末尾之后，序号连续。我们写了盘时，这份只是显示用的副本：活体没有写句柄，不会再落一遍。
    appendToLive(live, translateSessionEvents(events, nextSeqOf(live), localId))
    return
  }
  await withWrite(persistence, localId, async (handle) => { await handle.append!(translateSessionEvents(events, disk.length, localId)) })
}

/**
 * 活体与磁盘是否对得上：活体的下一条正好接在磁盘末尾，或者只多出官方载入时补的那条结束标记。
 * @param live 内存里的镜像会话。
 * @param diskCount 磁盘日志的事件数。
 * @returns 对得上为 true。
 */
function liveAlignedWithDisk(live: LiveSessionLike, diskCount: number): boolean {
  const next = nextSeqOf(live)
  if (next === diskCount) return true
  if (next !== diskCount + 1) return false
  const events = live.snapshotEvents?.() ?? []
  const last = events[events.length - 1]
  return last?.type === 'session/end-seed' && (last.data as { inherited?: unknown } | undefined)?.inherited !== true
}

/**
 * 把 A 上一条会话同步到水位：按 seq 游标分页拉取，先进缓存，再进官方镜像会话。
 *
 * 先做不联网的补齐（缓存领先磁盘），再联网拉水位之后的事件。远端不可达、读取失败或游标回退时抛错，
 * 已写入的部分不回退——缓存与磁盘只会向前，不会出现重复。
 * @param request 同步输入。
 * @returns 本次同步的结果。
 * @throws Error 远端读取失败、网络不通，或远端日志的游标回退。
 */
export async function syncRemoteMirror(request: MirrorSyncRequest): Promise<MirrorSyncResult> {
  const { host, remoteSessionId, cwd, store, persistence, projectionCache, cache } = request
  const pageSize = clampPageLimit(request.pageSize)
  const maxPages = Math.max(1, request.maxPages ?? DEFAULT_MAX_PAGES)
  const localId = mirrorIdOf(host.hostId, remoteSessionId)
  const cached = cache.read(host.hostId, remoteSessionId)
  const cachedCount = cached?.events.length ?? 0
  let materialized = request.materialized
  if (materialized === undefined) {
    // 登记表里没有进度（首次同步，或登记丢失）：按磁盘现状推断。
    const disk = persistence === undefined ? undefined : await diskEventsOf(persistence, localId)
    materialized = disk?.length ?? 0
  }
  let appended = 0
  let fetched = 0
  let meta: MirrorCacheMeta | undefined = cached?.meta

  // 一、磁盘落后于缓存（缓存先落盘后进程崩溃）：不联网，把缓存里缺的尾巴补进磁盘。
  if (persistence !== undefined && cached !== undefined && cachedCount > materialized) {
    const disk = await diskEventsOf(persistence, localId)
    // 进度落后不等于磁盘落后：上一轮同步可能刚写完盘、还没来得及记进度。磁盘事件不少于缓存事件
    // 就说明并不缺，再写一遍只会造出重复事件。
    const behind = disk === undefined ? cachedCount > 0 : disk.length < cachedCount
    if (behind) {
      const missing = cached.events.slice(materialized)
      await appendToMirror({ persistence, store, localId, cwd, createdAt: normalizeCreatedAt(cached.meta.createdAt), events: missing, disk })
      appended += missing.length
    }
    materialized = cachedCount
  }

  // 二、按游标分页拉水位之后的事件。
  let cursor = cached?.watermark ?? -1
  let caughtUp = false
  let missing = false
  // 磁盘领先缓存（缓存文件丢失）：已经落盘的那部分不再写第二遍。
  let skip = Math.max(0, materialized - cachedCount)
  for (let pages = 0; pages < maxPages; pages += 1) {
    const page = await fetchRemoteEventPage(host, remoteSessionId, cursor, pageSize)
    if (page === undefined) {
      missing = true
      caughtUp = true
      break
    }
    if (page.events.length === 0) {
      caughtUp = true
      break
    }
    const firstSeq = page.events[0]?.seq
    if (firstSeq === undefined || firstSeq <= cursor) {
      throw new Error(`mirror: 远端日志游标回退（水位 ${String(cursor)}，远端却返回 seq ${String(firstSeq)}），已停止同步 ${localId}`)
    }
    const skipped = Math.min(skip, page.events.length)
    skip -= skipped
    const fresh = page.events.slice(skipped)
    // 缓存先落盘：之后任何一步失败，下一次同步都能从这里把磁盘补齐。
    meta ??= { hostId: host.hostId, sessionId: remoteSessionId, cwd, createdAt: normalizeCreatedAt(page.header.createdAt) }
    cache.append(meta, page.events)
    if (fresh.length > 0) {
      await appendToMirror({ persistence, store, localId, cwd, createdAt: normalizeCreatedAt(page.header.createdAt), events: fresh })
    }
    appended += fresh.length
    materialized += fresh.length
    fetched += page.events.length
    cursor = page.events.at(-1)?.seq ?? cursor
    if (!page.hasMore) {
      caughtUp = true
      break
    }
  }

  // 三、侧栏的标题、列表元数据只从官方投影缓存读，而官方只给活体会话自动写投影。
  // 镜像不在内存里时，有新增就把它折一遍（官方按已折前缀增量，重复调用很便宜）；
  // 正开着时官方沿 session/event 自己写，不重复折。
  const folded = appended > 0 && projectionCache !== undefined && persistence !== undefined && meta !== undefined && store.get(localId) === undefined
  if (folded && meta !== undefined) {
    const events = await diskEventsOf(persistence, localId)
    if (events !== undefined) projectionCache.coldSnapshot(mirrorHeader(localId, cwd, normalizeCreatedAt(meta.createdAt)), 0, events)
  }
  const result: MirrorSyncResult = { localId, appended, fetched, watermark: cursor, materialized, caughtUp, durable: persistence !== undefined, folded }
  if (missing) result.missing = true
  return result
}
