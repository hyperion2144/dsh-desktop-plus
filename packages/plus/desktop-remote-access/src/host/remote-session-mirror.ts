//! 远端会话镜像：把 A 机上真实跑着的会话，按事件流同步进 B 机的官方会话日志。
//!
//! 与 remote-sessions.ts 的「一次性搬运」不同，这里处理的是**活着的**会话：A 上
//! agent 还在跑，事件持续追加。镜像只做两件事——首次用 `sessions.create(id, { seed })`
//! 建出本地副本，之后把新增事件 `append` 进同一个会话。会话 id 与 A 保持一致，
//! 所以两边指向的是同一个会话身份，而不是两份互不相干的记录。
//!
//! 事件翻译复用 remote-sessions.ts 的 `translateSessionEvents`：远端 seq 与本地
//! 日志位置不是一回事，翻译负责把引用改写成可重放的形式。
import type { RemoteHostRecord } from './remote-hosts.js'
import { pageRemoteSession, type RemoteSessionRecord } from './remote-rpc.js'
import { translateSessionEvents, type RemoteSessionEvent } from './remote-sessions.js'

/** 官方会话存储里镜像用到的最小结构契约。 */
export interface MirrorStoreLike {
  /** 取活体会话；不存在返回 undefined。 */
  get: (id: string) => unknown
  /** 建会话并把事件作为初始日志。 */
  create: (id: string, options: { seed: RemoteSessionEvent[], meta: { cwd: string, createdAt?: number } }) => { readonly id: string }
}

/** 官方持久化服务里镜像用到的最小结构契约。 */
export interface MirrorPersistenceLike {
  /** 新建存储会话并取得写句柄；已存在时抛错。 */
  create: (header: Record<string, unknown>, options?: { inheritedEventCount?: number }) => Promise<{
    append?: (events: unknown[]) => Promise<void>
    flush?: () => Promise<void>
    close?: () => Promise<void>
  }>
  /** 查询会话是否已在存储里。 */
  stat?: (id: string) => Promise<unknown>
  /** 只读打开已落盘的会话（拿磁盘上的真实事件，避免活体与磁盘条数分叉）。 */
  open?: (id: string, access: 'read' | 'write') => Promise<{
    read?: () => Promise<{ events: readonly unknown[] }>
    close?: () => Promise<void>
  }>
}

/** 一个活体会话的追加入口。 */
interface AppendableSession {
  /** 追加一条事件。 */
  append: (type: string, data: unknown, options?: { surfaceOp?: unknown }) => unknown
}

/** 单个会话的镜像进度。 */
interface MirrorCursor {
  /** 已经镜像到的远端 seq（包含式）。 */
  seq: number
}

/** 把一页远端记录里的普通事件挑出来。 */
function eventsOf(records: RemoteSessionRecord[]): RemoteSessionEvent[] {
  const events: RemoteSessionEvent[] = []
  for (const record of records) {
    if (record.type !== 'event') continue
    const event = record.event
    if (event === undefined) continue
    if (typeof event.type !== 'string' || typeof event.seq !== 'number' || typeof event.time !== 'number') continue
    events.push({ type: event.type, seq: event.seq, time: event.time, data: event.data })
  }
  return events
}

/**
 * 把一台主机上的一个会话同步进本机官方会话日志。
 *
 * 首次调用建出本地副本（seed = 当前全部事件），之后每次只追加新事件。
 * 远端不可达时抛错，由调用方决定是否降级——镜像失败不该影响本机其它会话。
 * @param host 已配对主机记录。
 * @param sessionId 远端会话 id（同时作为本地会话 id）。
 * @param cwd 会话工作目录（远端路径，用于工作区归属）。
 * @param store 官方会话存储（`ctx.sessions`）。
 * @param cursors 进程内的镜像进度表。
 * @returns 本次追加的事件数与当前远端游标。
 */
export async function mirrorRemoteSession(
  host: RemoteHostRecord,
  sessionId: string,
  cwd: string,
  store: MirrorStoreLike,
  cursors: Map<string, MirrorCursor>,
  persistence?: MirrorPersistenceLike,
): Promise<{ appended: number, cursor: number, appendedEvents: RemoteSessionEvent[] }> {
  const known = cursors.get(sessionId)
  const page = await pageRemoteSession(host, sessionId)
  const events = eventsOf(page.records)
  const existing = store.get(sessionId)
  // 游标必须是「已镜像到的最大事件 seq」，不能拿 page.cursor：那是远端日志位置，
  // 与事件 seq 不是同一套编号，用它当水位会让后续事件永远被判定为「已镜像」。
  const maxSeq = events.reduce((max, event) => (event.seq > max ? event.seq : max), 0)

  if (existing === undefined) {
    // 磁盘上已有这份会话时，活体只能按磁盘内容建：磁盘 3 条、远端 25 条时若用全量 seed，
    // 活体 25 条而磁盘 3 条，之后每次 append 都会被持久化层以 seq 不连续拒绝。
    let seedEvents = events
    let cursorSeq = maxSeq
    let seed = translateSessionEvents(seedEvents)
    // 先落盘、再进内存：官方会话列表读的是存储，只建内存会话的话本机 UI 看不到它，
    // 界面会另开一个本机会话，模型/权限/失败事件就全都对不上了。
    // createdAt 只算一次：活体头与磁盘头必须逐字段一致，否则官方判「会话来源冲突」。
    const first = events[0]
    let createdAt = first === undefined ? Date.now() : first.time
    if (persistence !== undefined) {
      const stored = persistence.stat === undefined ? false : (await persistence.stat(sessionId)) !== undefined && (await persistence.stat(sessionId)) !== null
      if (stored) {
        try {
          const dbg = await persistence.stat?.(sessionId) as { eventCount?: unknown } | undefined
          const opened = typeof persistence.open === 'function' ? await persistence.open(sessionId, 'read') : undefined
          let readCount = -1
          try { const rd = await opened?.read?.(); readCount = Array.isArray(rd?.events) ? rd.events.length : -2 } catch { readCount = -3 }
          await opened?.close?.()
          const { appendFileSync } = await import('node:fs')
          appendFileSync('/tmp/mirror-debug.log', `create ${sessionId} remote=${events.length} eventCount=${String(dbg?.eventCount)} read=${readCount}\n`)
        } catch { /* 调试用 */ }
        let storedCountKnown = false
        // 已落盘：活体头必须沿用磁盘头，否则官方判「会话来源冲突」。
        const snapshot = await persistence.stat?.(sessionId) as {
          header?: { createdAt?: unknown }
          eventCount?: unknown
        } | undefined
        const storedCreatedAt = snapshot?.header?.createdAt
        if (typeof storedCreatedAt === 'number') createdAt = storedCreatedAt
        const storedCount = snapshot?.eventCount
        if (typeof storedCount === 'number' && storedCount >= 0 && storedCount < events.length) {
          seedEvents = events.slice(0, storedCount)
          cursorSeq = storedCount - 1
          storedCountKnown = true
        }
        // 后端不一定给 eventCount：直接读磁盘，活体按磁盘内容建，剩下的交给增量追加。
        if (typeof persistence.open === 'function') {
          try {
            const handle = await persistence.open(sessionId, 'read')
            try {
              const stored = await handle.read?.()
              const storedEvents = stored?.events
              if (Array.isArray(storedEvents) && storedEvents.length > 0 && storedEvents.length < events.length) {
                seedEvents = events.slice(0, storedEvents.length)
                cursorSeq = storedEvents.length - 1
              }
              if (Array.isArray(storedEvents)) storedCountKnown = true
            } finally {
              await handle.close?.()
            }
          } catch { /* 读不到就退回全量 seed */ }
        }
        if (!storedCountKnown) {
          // 磁盘内容读不出来：不建活体会话。活体条数与磁盘分叉后，写盘会永远被 seq 校验拒绝。
          cursors.set(sessionId, { seq: maxSeq })
          return { appended: 0, cursor: maxSeq, appendedEvents: [] }
        }
      }
      // 镜像会话不落盘：它的真相在远端，本机只是视图。落盘会与远端条数分叉，
      // 之后每次 append 都被持久化层以 seq 不连续拒绝（实测刷屏且拖垮轮询）。
    }
    seed = translateSessionEvents(seedEvents)
    try {
      store.create(sessionId, { seed, meta: { cwd, createdAt } })
    } catch (error) {
      // 重启后会话只在磁盘、不在活体 store：这里会撞 already exists。
      // 不当作失败——等界面打开该会话把它载入活体 store 后，下一轮自然走 append。
      if (!String((error as Error)?.message ?? error).includes('already exists')) throw error
      cursors.set(sessionId, { seq: cursorSeq })
      return { appended: 0, cursor: cursorSeq, appendedEvents: [] }
    }
    cursors.set(sessionId, { seq: cursorSeq })
    return { appended: seed.length, cursor: cursorSeq, appendedEvents: [] }
  }

  const from = known?.seq ?? 0
  const fresh = events.filter((event) => event.seq > from)
  if (fresh.length === 0) {
    cursors.set(sessionId, { seq: maxSeq })
    return { appended: 0, cursor: maxSeq, appendedEvents: [] }
  }
  // 追加时本地 seq 必须接着已落盘的那条往下排（持久化句柄会校验连续性），
  // 从 0 重排会被拒绝：append seq mismatch。
  // 本地 seq 必须接着活体会话当前的日志位置往下排：游标是远端水位，
  // 与本地已落盘条数不一定相等（落盘失败回退过就会差一条）。
  const localSeq = (existing as { seq?: unknown }).seq
  const translated = translateSessionEvents(fresh, typeof localSeq === 'number' ? localSeq : from + 1)
  const target = existing as Partial<AppendableSession>
  if (typeof target.append !== 'function') {
    // 拿不到追加入口时不假装成功：游标不前进，下次还会重试。
    throw new Error('mirror: 本地会话没有 append 入口')
  }
  for (const event of translated) {
    target.append(event.type, event.data, event.surfaceOp === undefined ? undefined : { surfaceOp: event.surfaceOp })
  }
  cursors.set(sessionId, { seq: maxSeq })
  return { appended: translated.length, cursor: maxSeq, appendedEvents: translated }
}
