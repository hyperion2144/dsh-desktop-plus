//! 远端会话：把 A 机上的会话搬到 B 机的官方会话存储里渲染。
//!
//! 方向与凭据见 remote-hosts.ts。数据面只两条 lane 路由（A 侧提供、B 侧消费），都要求
//! 已配对设备 cookie：
//!   POST /__dsh-mobile/api/remote/sessions      { path } → 该目录下的会话头列表
//!   POST /__dsh-mobile/api/remote/session.read  { sessionId } → 该会话的全部事件
//!
//! B 侧物化走官方 `ctx.sessions.create(id, { seed, meta: { cwd } })`：seed 直接把重放事件作为
//! 初始日志，会话随即进入 session-query 的活体语料（被 `live: true` 标记），官方 push 流
//! 会把它推给客户端并渲染。**不新增平行实体，也不改官方代码。**
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'

/** 事件在 wire 上的最小形状：只带会话日志的四个必需字段。 */
export interface RemoteSessionEvent {
  /** 事件类型（官方 SessionEventMap 的键）。 */
  type: string
  /** 远端原始 seq（仅用于排序与引用翻译）。 */
  seq: number
  /** 远端原始时间戳（毫秒）。 */
  time: number
  /** 事件负载。 */
  data: unknown
  /** surface 事件的操作类型（可选）。 */
  surfaceOp?: string
  /** surface 事件引用到的更早事件 seq 列表（可选）。 */
  sourceEventSeqs?: number[]
}

/** 一条远端会话的头（列表项）。 */
export interface RemoteSessionHeader {
  /** 会话 id。 */
  id: string
  /** 会话工作目录（A 机上的绝对路径）。 */
  cwd: string
  /** 创建时间（ISO-8601 或毫秒）。 */
  createdAt?: string | number
  /** 会话标题（可选）。 */
  title?: string
}

/** 一次会话读取的结果。 */
export interface RemoteSessionLog {
  /** 会话头。 */
  header: RemoteSessionHeader
  /** 全部事件（按 seq 升序）。 */
  events: RemoteSessionEvent[]
}

/** A 侧：按目录筛出会话头。 */
export interface SessionHeaderSource {
  /** 列出本机全部会话头（含 cwd）。 */
  listHeaders: () => Promise<RemoteSessionHeader[]>
}


/** A 侧：按 id 读一个会话的日志。 */
export interface SessionLogSource {
  /** 读取会话日志；不存在返回 undefined。 */
  readLog: (sessionId: string) => Promise<RemoteSessionLog | undefined>
  /** 写入一份会话日志（推送落地用）；返回写入的事件条数。 */
  writeLog?: (log: RemoteSessionLog, cwd: string) => Promise<number>
}

/** B 侧：官方会话存储的最小结构契约（只声明物化用到的方法）。 */
export interface SessionStoreLike {
  /** 官方创建入口：可带 seed 与 meta，把远端事件作为初始内存日志。 */
  create: (id: string, options: { seed: RemoteSessionEvent[]; meta: { cwd: string, createdAt?: number } }) => { readonly id: string }
  /** 取已存在的活体会话。 */
  get: (id: string) => unknown
}

/**
 * B 侧：官方会话持久化的最小结构契约（`ctx.sessionPersistence`）。
 *
 * 耐久路径只能走这里。`ctx.sessions.create()` 只把事件放进内存日志，真正持有
 * 磁盘写句柄的是 agent-loop 起跑时才向持久化后端申请的那个；`session/flush`
 * 对一个从未开跑过的会话会返回「有监听者参与」，可监听者按 id 找不到写入句柄
 * 就直接跳过——既不报错，也一个字节不写。所以物化必须显式经过本服务。
 */
export interface SessionPersistenceLike {
  /** 新建一个存储会话并取得写句柄；已存在时抛错。 */
  create: (header: PersistedSessionHeader, options?: { inheritedEventCount?: number }) => Promise<PersistedSessionHandleLike>
  /** 查询会话是否已在存储里；缺省表示宿主不支持查询（无法判定，按未落盘处理）。 */
  stat?: (id: string) => Promise<{ header?: { cwd?: unknown, createdAt?: unknown } } | undefined>
}

/** 写入盘用的会话头（官方 SessionHeader 的最小子集）。 */
export interface PersistedSessionHeader {
  /** Session 格式版本，与 `session.v4.jsonl.zstd` 对齐。 */
  version: number
  /** 会话 id。 */
  id: string
  /** 创建时间（毫秒）。 */
  createdAt: number
  /** 会话工作目录（绝对路径）。 */
  cwd: string
  /** 是否带继承前缀；远端物化恒为 false。 */
  isSeeded: boolean
  /** 委派深度；顶层会话为 0。 */
  delegationDepth: number
}

/** 存储写句柄（只声明物化用到的三个动作）。 */
export interface PersistedSessionHandleLike {
  /** 追加一批连续事件。 */
  append: (events: readonly RemoteSessionEvent[]) => Promise<void>
  /** 耐久屏障：返回即已落盘。 */
  flush: () => Promise<void>
  /** 关闭句柄并释放写所有权。 */
  close: () => Promise<void>
}

/** 当前官方 Session 日志格式版本（`session.v4.jsonl.zstd`）。 */
export const SESSION_LOG_VERSION = 4

/** 官方要求带 surfaceOp 的事件类型（`core/session` 的 SURFACE_EVENT_TYPES）。 */
const SURFACE_EVENT_TYPES = new Set<string>(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result'])

/** 规范化 cwd 比较：远程路径不做 realpath，只比较字符串。 */
export function sameCwd(a: string, b: string): boolean {
  const strip = (value: string): string => (value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value)
  return strip(a) === strip(b)
}

/**
 * A 侧：列出某个目录下的会话头。
 * @param source 会话头来源。
 * @param path A 机上的目录绝对路径。
 * @returns 该目录下的会话头（保持来源顺序）。
 */
export async function listSessionsUnderPath(source: SessionHeaderSource, path: string): Promise<RemoteSessionHeader[]> {
  const headers = await source.listHeaders()
  return headers.filter(header => typeof header.cwd === 'string' && sameCwd(header.cwd, path))
}

/**
 * B 侧：把远端会话重映射成本地可 append 的事件序列。
 *
 * 官方要求 `sourceEventSeqs` 指向**本地日志里更早的** seq（`core/session` 的 validateNext），
 * 因此这里按原顺序重编号，并把引用从远端 seq 翻成本地 seq；无法解析的引用被丢弃（保守：
 * 宁可让该事件不参与 surface，也不要让 append 被校验拒绝）。
 * @param events 远端事件（按 seq 升序）。
 * @returns 重编号后的事件序列，下标即本地 seq。
 */
export function translateSessionEvents(events: readonly RemoteSessionEvent[], startSeq = 0): RemoteSessionEvent[] {
  const ordered = [...events].sort((left, right) => left.seq - right.seq)
  const localOf = new Map<number, number>()
  const translated: RemoteSessionEvent[] = []
  for (const event of ordered) {
    const localSeq = startSeq + translated.length
    localOf.set(event.seq, localSeq)
    const sources = Array.isArray(event.sourceEventSeqs)
      ? event.sourceEventSeqs
        .map(seq => localOf.get(seq))
        .filter((seq): seq is number => typeof seq === 'number' && seq < localSeq)
      : undefined
    translated.push({
      type: event.type,
      seq: localSeq,
      time: event.time,
      data: event.data,
      // 远端 page 不返回 surfaceOp，但官方校验要求这几类事件必须带标记；
      // 缺了就按「追加」补上，否则整段 seed 会被拒绝（invalid seed event）。
      ...(event.surfaceOp !== undefined
        ? { surfaceOp: event.surfaceOp }
        : SURFACE_EVENT_TYPES.has(event.type) ? { surfaceOp: 'append' as const } : {}),
      ...(sources === undefined || sources.length === 0 ? {} : { sourceEventSeqs: sources }),
    })
  }
  return translated
}

/** 物化结果。 */
/** 物化结果。 */
export interface MaterializedSession {
  /** 本机会话 id（等于远端 id）。 */
  id: string
  /** 本次真正写进去的事件条数（已落盘时为 0）。 */
  eventCount: number
  /** 是否已落盘：`false` 表示只在内存里，重启后会消失。 */
  durable: boolean
}

/**
 * 把远端时间戳规范成官方要求的非负整型毫秒。
 * @param value 远端给的 ISO-8601 字符串或毫秒数。
 * @returns 合法的毫秒时间戳（无法解析时取当前时间）。
 */
export function normalizeCreatedAt(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  }
  return Date.now()
}

/**
 * 会话是否已经在官方存储里（只有支持 `stat` 的后端才判定得了）。
 * @param persistence 持久化服务。
 * @param id 会话 id。
 * @returns 存储里已有该会话时为 true。
 */
async function storedSessionExists(persistence: SessionPersistenceLike, id: string): Promise<boolean> {
  if (persistence.stat === undefined) return false
  const snapshot = await persistence.stat(id)
  return snapshot !== undefined && snapshot !== null
}

/**
 * 把远端日志写进官方存储：create 取写句柄 → append 事件 → flush 耐久屏障 → close。
 * @param persistence 持久化服务。
 * @param log 远端会话日志。
 * @param cwd 写入会话头的 cwd。
 * @param events 已重编号的事件。
 */
async function persistRemoteLog(
  persistence: SessionPersistenceLike,
  log: RemoteSessionLog,
  cwd: string,
  events: readonly RemoteSessionEvent[],
): Promise<void> {
  const handle = await persistence.create({
    version: SESSION_LOG_VERSION,
    id: log.header.id,
    createdAt: normalizeCreatedAt(log.header.createdAt),
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  }, { inheritedEventCount: 0 })
  try {
    if (events.length > 0) await handle.append(events)
    await handle.flush()
  } finally {
    await handle.close()
  }
}

/**
 * B 侧：把一个远端会话物化成本机官方会话。
 *
 * 两道关卡：先落盘（存储里有记录就不再写，重复登记幂等），再在本进程登记活体
 * 镜像（官方列表与推送走活体会话；重启后由下一次 sync 依存储重建）。没有持久化
 * 后端时退化成纯内存镜像，并如实标记 `durable: false`。
 * @param store 官方会话存储（`ctx.sessions`）。
 * @param log 远端会话日志。
 * @param cwd 写入会话头的 cwd（保持远端路径，供工作区归属匹配）。
 * @param persistence 官方持久化服务（`ctx.sessionPersistence`）；缺省时无法落盘。
 * @returns 物化结果。
 */
export async function materializeSession(
  store: SessionStoreLike,
  log: RemoteSessionLog,
  cwd: string,
  persistence?: SessionPersistenceLike,
): Promise<MaterializedSession> {
  const id = log.header.id
  if (store.get(id) !== undefined) return { id, eventCount: 0, durable: true }
  const seed = translateSessionEvents(log.events)
  // 内存重建沿用远端那份会话头：createdAt 决定会话在列表里的先后，cwd 决定工作区归属。
  // 只写 { cwd } 会让本机副本的创建时间变成本机当下，列表顺序与来源都对不上。
  // createdAt 只算一次：远端头缺这个字段时 normalizeCreatedAt 会取当下，
  // 算两次会让活体头与磁盘头差几毫秒，官方随即判「会话来源冲突」。
  const createdAt = normalizeCreatedAt(log.header.createdAt)
  let meta: { cwd: string, createdAt: number } = { cwd, createdAt }
  if (persistence !== undefined) {
    const stored = await storedSessionExists(persistence, id)
    if (stored) {
      // 已落盘：活体会话头必须和磁盘头逐字段一致，否则官方判「会话来源冲突」
      // （0.2.2-rc.1 起 session-query 会比对 createdAt / cwd / isSeeded / delegationDepth）。
      const snapshot = await persistence.stat?.(id)
      const header = snapshot?.header
      if (header !== undefined) {
        meta = {
          cwd: typeof header.cwd === 'string' ? header.cwd : cwd,
          createdAt: normalizeCreatedAt(typeof header.createdAt === 'string' || typeof header.createdAt === 'number' ? header.createdAt : undefined),
        }
      }
    }
    if (!stored) await persistRemoteLog(persistence, { ...log, header: { ...log.header, createdAt } }, cwd, seed)
    if (store.get(id) === undefined) store.create(id, { seed, meta })
    return { id, eventCount: stored ? 0 : seed.length, durable: true }
  }
  store.create(id, { seed, meta })
  return { id, eventCount: seed.length, durable: false }
}

/**
 * A 侧：把一份会话日志写进本机官方存储（「推送到远程」的落地写入口）。
 * @param persistence 持久化服务。
 * @param log 会话日志。
 * @param cwd 写入会话头的 cwd。
 * @returns 写入的事件条数。
 */
export async function writeRemoteLog(
  persistence: SessionPersistenceLike,
  log: RemoteSessionLog,
  cwd: string,
): Promise<number> {
  const events = translateSessionEvents(log.events)
  await persistRemoteLog(persistence, log, cwd, events)
  return events.length
}
/**
 * B 侧：向一台已配对主机拉取某目录下的会话头。
 * @param host 主机记录（带 cookie）。
 * @param path A 机上的目录。
 * @returns 会话头列表。
 */
export async function fetchRemoteSessions(host: RemoteHostRecord, path: string): Promise<RemoteSessionHeader[]> {
  const response = await fetchFromHost(host, '/__dsh-mobile/api/remote/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!response.ok) throw new Error(`远端会话列表失败（HTTP ${String(response.status)}）`)
  const body = await response.json() as { sessions?: RemoteSessionHeader[] }
  return Array.isArray(body.sessions) ? body.sessions : []
}

/**
 * B 侧：向一台已配对主机拉取一个会话的完整日志。
 * @param host 主机记录（带 cookie）。
 * @param sessionId 远端会话 id。
 * @returns 会话日志。
 */
export async function fetchRemoteSessionLog(host: RemoteHostRecord, sessionId: string): Promise<RemoteSessionLog> {
  const response = await fetchFromHost(host, '/__dsh-mobile/api/remote/session.read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  if (!response.ok) throw new Error(`远端会话读取失败（HTTP ${String(response.status)}）`)
  return await response.json() as RemoteSessionLog
}

/** 服务查找器（生产传 `ctx.get`，测试传假表）。 */
export type ServiceLookup = (name: string) => unknown

/**
 * A 侧：用官方服务拼出会话来源（`sessionPersistence` 列头 + `sessionQuery` 读日志）。
 * 服务缺失时返回空来源，而不是抛错——远端只应拿到「没有会话」，不该让 lane 挂掉。
 * @param lookup 服务查找器。
 * @returns 会话头来源与日志来源的合并对象。
 */
export function buildRemoteSessionSource(lookup: ServiceLookup): SessionHeaderSource & SessionLogSource {
  return {
    async listHeaders() {
      const persistence = lookup('sessionPersistence') as
        | { list?: () => Promise<Array<{ header: { id?: unknown, cwd?: unknown, createdAt?: unknown } }>> }
        | undefined
      const snapshots = (await persistence?.list?.()) ?? []
      return snapshots
        .map((snapshot) => ({
          id: String(snapshot.header.id ?? ''),
          cwd: typeof snapshot.header.cwd === 'string' ? snapshot.header.cwd : '',
          ...(snapshot.header.createdAt === undefined
            ? {}
            : { createdAt: snapshot.header.createdAt as string | number }),
        }))
        .filter((header) => header.id !== '')
    },
    async readLog(sessionId) {
      const query = lookup('sessionQuery') as
        | {
            readSession?: (id: string) => Promise<{
              session: { id?: unknown, cwd?: unknown, createdAt?: unknown }
              events: RemoteSessionEvent[]
            }>
          }
        | undefined
      const snapshot = await query?.readSession?.(sessionId)
      if (snapshot === undefined) return undefined
      return {
        header: {
          id: String(snapshot.session.id ?? sessionId),
          cwd: typeof snapshot.session.cwd === 'string' ? snapshot.session.cwd : '',
          ...(snapshot.session.createdAt === undefined
            ? {}
            : { createdAt: snapshot.session.createdAt as string | number }),
        },
        events: snapshot.events,
      }
    },
    async writeLog(log, cwd) {
      const persistence = lookup('sessionPersistence') as SessionPersistenceLike | undefined
      if (persistence === undefined) throw new Error('sessionPersistence 不可用')
      return await writeRemoteLog(persistence, log, cwd)
    },
  }
}

