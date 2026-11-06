//! 远端会话桥：让「远程工作区里的会话」在 B 机上只做渲染，真正的 agent 跑在 A 机。
//!
//! 官方会话生命周期有三个入口——建会话、投消息、取消——都挂在 `ctx.sessionController`
//! 这个服务实例上。本模块不改上游代码，也不替换服务（Cordis 的 `reflect.set` 拒绝跨
//! fiber 覆盖），而是在实例上包一层：命中远程工作区的请求转发给 A 机，其余原样放行。
//!
//! 判定「是不是远程会话」不靠额外状态：会话头的 cwd 就是 A 机上的绝对路径，而远程工作区
//! 登记表里存着同一串路径。两边对得上，这个会话就是远程的。重启后照样成立。
//!
//! 事件回流走 `remote-session-sync.ts`：按 seq 游标分页拉取 A 机的 `session.page`，先进镜像缓存，
//! 再写进本机官方会话日志里的镜像会话（id 带 `remote-` 前缀），官方 push 流随即把它们推给客户端。
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'
import type { RemoteSessionEntry } from './remote-session-registry.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { answerRemoteInteraction, callRemote, cancelRemoteSession, createRemoteSession, createRemoteWorkspace, promptRemoteSession, unwatchRemoteSession, watchRemoteSession } from './remote-rpc.js'
import { isMirrorId, mirrorIdOf, remoteIdOfMirror, replaceSessionIds } from './mirror-id.js'
import type { MirrorCache } from './remote-mirror-cache.js'
import { syncRemoteMirror, type MirrorPersistenceLike, type MirrorProjectionCacheLike, type MirrorSyncResult } from './remote-session-sync.js'
import { createFailureThrottle } from './log-throttle.js'
import { parseInteractionAnswer, type InteractionFrame, type InteractionQuestion } from './interaction-relay.js'
import { fetchRemoteSessions } from './remote-sessions.js'
import { REMOTE_WATCH_RENEW_MS } from './remote-lease.js'
import { createGoneConfirm } from './mirror-gone.js'

/** 一条等着本机用户回答的交互：宿主记下，客户端插件渲染成卡片。 */
export interface PendingInteractionView {
  requestId: string
  /** 本机镜像会话 id。 */
  sessionId: string
  type: 'question' | 'approval'
  /** 提问：问题列表（与官方同形）。 */
  questions?: InteractionQuestion[]
  /** 审批：工具名、调用标识与原因。 */
  toolName?: string
  callId?: string
  reason?: string
  /** A 那边已经落定而本机没答（超时、取消、别处先答）：卡片变为「已交回设备本机」。 */
  handedBack: boolean
}
import { createRemoteStreamClient, type RemoteStreamClient, type RemoteStreamState } from './remote-stream-client.js'
import { installRemoteStreamRoute, type UpgradeRegistrar } from './remote-stream-route.js'
import { openRemoteStream } from './remote-stream.js'

/** 一条远程工作区登记（只取桥接用到的两个字段）。 */
export interface RemoteWorkspaceRef {
  /** 已配对主机 id。 */
  hostId: string
  /** A 机上的绝对路径。 */
  path: string
  /** 本机官方工作区 id（登记表里带的话）：新发现的镜像据此挂进侧栏分组。 */
  workspaceId?: string
}

/** 主机查询面。 */
export interface RemoteHostLookup {
  /** 按 id 取主机记录；不存在返回 undefined。 */
  get: (hostId: string) => RemoteHostRecord | undefined
  /** 全部已配对主机（启动时给每台建一条 SSE 订阅）。 */
  list: () => RemoteHostRecord[]
}

/** 桥接用到的 cordis 上下文能力面。 */
export interface BridgeContext {
  /** 取服务（可选服务一律走它）。 */
  get?: (name: string) => unknown
  /** 日志。 */
  logger?: { warn?: (message: string) => void, info?: (message: string) => void }
}

/** 官方会话存储的最小结构契约。 */
interface SessionStoreLike {
  /** 取活体会话。 */
  get: (id: string) => unknown
}

/** 官方会话头里桥接用到的字段。 */
interface SessionHeaderLike {
  /** 会话工作目录。 */
  cwd?: unknown
}

/** 官方会话实例里桥接用到的字段。 */
interface SessionLike {
  /** 会话头。 */
  header?: SessionHeaderLike
}

/** 官方 sessionController 里桥接包装的三个方法。 */
interface SessionControllerLike {
  /** 建会话。 */
  create?: (request: SessionCreateRequestLike) => Promise<SessionCreateValueLike>
  /** 投消息。 */
  prompt?: (request: SessionPromptRequestLike, signal?: AbortSignal) => Promise<SessionPromptValueLike>
  /** 取消当前轮。 */
  cancel?: (request: SessionCancelRequestLike) => SessionCancelValueLike
  /** 模型目录（全局接口，不带会话 id）。 */
  modelCatalog?: () => Promise<unknown>
  /** 选模型（远程会话必须转发，本地没有 agent 可 resume）。 */
  selectModel?: (request: SessionSelectModelRequestLike) => Promise<unknown>
  /** 会话状态（远程会话的 running 要按远端是否在跑覆盖）。 */
  state?: (request: { sessionId: string }, signal?: AbortSignal) => Promise<Record<string, unknown>>
  /** 会话状态流。 */
  observeState?: (request: { sessionId: string }, signal?: AbortSignal) => AsyncIterable<Record<string, unknown>>
}

/** 建会话请求里桥接用到的字段。 */
interface SessionCreateRequestLike {
  /** 目标工作区。 */
  workspaceId?: string
  /** 目标目录。 */
  cwd?: string
  /** 复用的空会话。 */
  sessionId?: string
  /** Agent 预设。 */
  agentPreset?: string
}

/** 建会话返回值。 */
interface SessionCreateValueLike {
  /** 会话 id。 */
  sessionId: string
  /** 预设。 */
  agentPreset?: string
}

/** 投消息请求里桥接用到的字段。 */
interface SessionPromptRequestLike {
  /** 消息身份。 */
  requestId: string
  /** 会话 id。 */
  sessionId: string
  /** 投递模式。 */
  mode?: string
  /** 内容块。 */
  content?: readonly { type?: string, text?: string }[]
  /** 客户端时区。 */
  clientTimeZone?: string
}

/** 投消息返回值。 */
interface SessionPromptValueLike {
  /** 是否接受。 */
  accepted: boolean
}

/** 取消请求。 */
interface SessionCancelRequestLike {
  /** 会话 id。 */
  sessionId: string
}


/** 选模型请求（只取桥接用到的字段）。 */
interface SessionSelectModelRequestLike {
  /** 会话 id。 */
  sessionId: string
}
/** 取消返回值。 */
interface SessionCancelValueLike {
  /** 是否接受。 */
  accepted: boolean
}

/** 工作区注册表里桥接用到的字段。 */
interface WorkspaceRegistryLike {
  /** 按 id 取工作区。 */
  get?: (workspaceId: string) => { path?: unknown, attachSession?: (sessionId: string) => Promise<void> } | undefined
  /** 列出全部工作区：用来分辨「本机同路径的本地工作区」。 */
  list?: () => readonly { id?: unknown, path?: unknown }[]
}

/** 会话持久化里桥接用到的字段（启动时重建远程会话表）。 */
interface SessionPersistenceLike {
  /** 列出全部已落盘会话。 */
  list?: () => Promise<Array<{ header: { id?: unknown, cwd?: unknown } }>>
}

/** 桥接装配参数。 */
export interface RemoteSessionBridgeOptions {
  /** cordis 上下文。 */
  ctx: BridgeContext
  /** 主机查询面。 */
  hosts: RemoteHostLookup
  /** 当前登记的远程工作区。 */
  workspaces: () => readonly RemoteWorkspaceRef[]
  /** 镜像进度表（与 host 入口共用同一份）。 */
  cursors: Map<string, { seq: number }>
  /** 已写进官方镜像会话的远端事件数；与 cursors 一起由登记表恢复、一起落盘。 */
  materialized: Map<string, number>
  /** 镜像缓存（#107）：远端事件按 profile 落盘，带 seq 水位；重启后从这里续传。 */
  cache: MirrorCache
  /** 轮询间隔（毫秒）。 */
  pollIntervalMs?: number
  /** 启动时恢复上次落盘的远程会话登记（会话 id → 主机 / 目录 / 镜像游标）。 */
  restore?: () => RemoteSessionEntry[]
  /** 登记表变化时落盘，重启后据此继续镜像、继续对话。 */
  persist?: (entries: RemoteSessionEntry[]) => void
  /**
   * 这条镜像是否已退役（#154）：被接管成本地分支后，回推成功前不再登记、不再订阅设备。
   * 对账与就绪帧发现它在设备上仍然存在时，据此跳过。
   */
  isRetired?: (sessionId: string) => boolean
  /**
   * 某个目录在本机是否存在（新建会话的归属判定：本机有这个目录，就在本机新建）。缺省查文件系统。
   */
  localDirectoryExists?: (path: string) => boolean
}

/** 桥接对外表面。 */
export interface RemoteSessionBridge {
  /** 本机镜像会话 id → 它所在的远程工作区。 */
  readonly sessions: Map<string, RemoteWorkspaceRef>
  /** 把一个会话登记成远程会话（同步路径也会调）。 */
  register: (sessionId: string, ref: RemoteWorkspaceRef) => void
  /** 启动时按已落盘会话重建远程会话表。 */
  hydrate: () => Promise<void>
  /** 立即拉一次所有远程会话的新事件。 */
  pullAll: () => Promise<void>
  /** 立刻拉一次某个远程会话的最新事件。 */
  pullOne: (sessionId: string, ref: RemoteWorkspaceRef) => Promise<MirrorSyncResult | undefined>
  /** 列出等本机用户回答的交互（提问 / 审批）；给了会话 id 就只列它的。 */
  pendingInteractions: (sessionId?: string) => PendingInteractionView[]
  /** 把本机用户对一条交互的回答交回 A；A 收下为 true。 */
  answerInteraction: (answer: unknown) => Promise<boolean>
  /**
   * 解除配对时清掉某台主机的全部派生物（#157）：镜像登记、进度、订阅、待答交互、镜像缓存。
   * 不动已落盘的镜像会话日志本身——归档还是保留由调用方决定。
   * @param hostId 主机 id。
   * @returns 被清掉的镜像会话 id。
   */
  forgetHost: (hostId: string) => string[]
  /**
   * 清掉一条镜像会话的派生物（#154 接管后原镜像不再订阅设备本机；#157 解除配对）：登记、进度、订阅、镜像缓存。
   * 不动已落盘的镜像会话日志本身——归档还是保留由调用方决定。
   * @param sessionId 镜像会话 id。
   * @returns 是否真的清掉了。
   */
  forgetSession: (sessionId: string) => boolean
  /**
   * 把一条会话登记成远程会话并挂进它的远程工作区（#155 回推后回到远程时用：镜像可能已被归档或注销）。
   * @param sessionId 镜像会话 id。
   * @param ref 它所在的远程工作区。
   */
  registerMirror: (sessionId: string, ref: RemoteWorkspaceRef) => void
  /** 每台主机的 SSE 连接状态（B 端徽标用）。 */
  streamState: (hostId: string) => RemoteStreamState
  /** 立刻重连某台主机（发消息前发现断线时用）。 */
  reconnect: (hostId: string) => void
  /** 转发一次会话级调用；返回 undefined 表示这个会话不属于任何远程主机。 */
  invokeRemote: (namespace: string, method: string, args: Record<string, unknown>) => Promise<{ value: unknown } | undefined>
  /** 在远端执行一条命令（/permission 等）；不是远程会话时返回 undefined。 */
  executeCommand: (sessionId: string, line: string) => Promise<unknown>
  /** 停止轮询并还原被包装的方法。 */
  dispose: () => void
}

/** 路径比较：去掉尾部分隔符后逐字比较（远程路径不做 realpath）。 */
function samePath(left: string, right: string): boolean {
  const strip = (value: string): string => (value.length > 1 && /[\\/]$/.test(value) ? value.slice(0, -1) : value)
  return strip(left) === strip(right)
}


/** 工作区注册表可能的服务名（官方不同版本用过不同名字）。 */
const WORKSPACE_REGISTRY_SERVICES = ['workspaceRegistry', 'workspaces', 'workspace'] as const

/**
 * 取工作区注册表。
 * @param ctx cordis 上下文。
 * @returns 注册表面；都取不到时返回 undefined。
 */
function workspaceRegistryOf(ctx: BridgeContext): WorkspaceRegistryLike | undefined {
  if (typeof ctx.get !== 'function') return undefined
  for (const name of WORKSPACE_REGISTRY_SERVICES) {
    const candidate = ctx.get(name) as WorkspaceRegistryLike | undefined
    if (candidate !== undefined && candidate !== null && typeof candidate.get === 'function') return candidate
  }
  return undefined
}
/** 从内容块里取出纯文本。 */
function textOf(content: readonly { type?: string, text?: string }[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
}

/**
 * 装配远端会话桥。
 * @param options 装配参数。
 * @returns 桥接表面；sessionController 不可用时返回 null（插件其余部分照常工作）。
 */
export function installRemoteSessionBridge(options: RemoteSessionBridgeOptions): RemoteSessionBridge | null {
  const { ctx, hosts, workspaces, cursors, materialized, cache } = options
  const pollIntervalMs = options.pollIntervalMs ?? 800
  const localDirectoryExists = options.localDirectoryExists ?? ((target: string): boolean => fs.existsSync(target))
  const sessions = new Map<string, RemoteWorkspaceRef>()
  // 远程会话的运行态：官方靠 agent 生命周期发 api-session/status，镜像会话没有 agent，
  // 这里按镜像日志里 turn 的开合自己发，界面才会显示「深度求索中」和暂停按钮。
  const runningState = new Map<string, boolean>()
  // 新建但还没发过消息的会话在 A 机上没有活体 agent，命令会被网关拒绝；
  // 先记下来，等第一条消息把 agent 拉起来再补发。
  const pendingCommands = new Map<string, string[]>()
  /** 桥接日志：宿主 stdout 抓不到，直接落盘，排障时只看这一个文件。 */
  const bridgeLogPath = (): string => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'logs', 'remote-access-bridge.log')
  // 最近一次用到的远程主机：模型目录是全局接口（不带会话 id），只能按「当前在用的远程会话」取。
  let lastRemoteHostId: string | undefined
  const warn = (message: string): void => { try { ctx.logger?.warn?.(message) } catch { /* 日志失败不影响桥接 */ } console.warn(message); try { fs.appendFileSync(bridgeLogPath(), `[${new Date().toISOString()}] ${message}\\n`) } catch { /* 落盘失败不影响桥接 */ } }

  /** 官方持久化服务；镜像建会话时先落盘，否则本机列表看不到它。 */
  const persistenceOf = (): MirrorPersistenceLike | undefined =>
    (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as MirrorPersistenceLike | undefined

  /** 官方投影缓存：镜像不在内存里时由同步把日志折一遍，侧栏才读得到标题与列表元数据。 */
  const projectionCacheOf = (): MirrorProjectionCacheLike | undefined =>
    (typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : undefined) as MirrorProjectionCacheLike | undefined

  /** 把当前登记表与游标写回磁盘。 */
  const flush = (): void => {
    if (options.persist === undefined) return
    try {
      options.persist([...sessions].map(([sessionId, ref]) => ({ sessionId, hostId: ref.hostId, path: ref.path, seq: cursors.get(sessionId)?.seq ?? 0, materialized: materialized.get(sessionId) ?? 0 })))
    } catch { /* 落盘失败不影响会话本身 */ }
  }

  // 先恢复上次的登记与游标：否则重启后游标从 0 重来，会把整段历史再追加一遍。
  for (const entry of options.restore?.() ?? []) {
    // 镜像 id 必须能还原出这条登记的主机：旧格式（id 不带前缀，或主机段没编码、带斜杠）对不上，直接跳过。
    // 那些格式没有发布过，没有需要续用的旧数据。
    if (!isMirrorId(entry.sessionId) || remoteIdOfMirror(entry.sessionId, entry.hostId) === undefined) continue
    sessions.set(entry.sessionId, { hostId: entry.hostId, path: entry.path })
    cursors.set(entry.sessionId, { seq: entry.seq })
    // 旧登记可能没有进度：不臆造，留给同步按磁盘现状推断。
    if (entry.materialized !== undefined) materialized.set(entry.sessionId, entry.materialized)
  }

  const controller = (typeof ctx.get === 'function' ? ctx.get('sessionController') : undefined) as SessionControllerLike | undefined
  if (controller === undefined || controller === null) {
    warn('dsh-remote-access: sessionController 不可用，远程会话桥未装配')
    return null
  }

  /** 按 cwd 找它属于哪个远程工作区。 */
  const refForPath = (path: string): RemoteWorkspaceRef | undefined =>
    workspaces().find((workspace) => samePath(workspace.path, path))

  /** 取一个会话的 cwd（活体会话优先，其次已落盘会话头）。 */
  const cwdOf = (sessionId: string): string | undefined => {
    const store = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined) as SessionStoreLike | undefined
    const live = store?.get(sessionId) as SessionLike | undefined
    const cwd = live?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }

  /** 解析建会话请求的目标目录。 */
  const targetPathOf = (request: SessionCreateRequestLike): string | undefined => {
    if (typeof request.cwd === 'string' && request.cwd !== '') return request.cwd
    if (typeof request.workspaceId !== 'string' || request.workspaceId === '') return undefined
    const registry = workspaceRegistryOf(ctx)
    const workspace = registry?.get?.(request.workspaceId)
    return typeof workspace?.path === 'string' ? workspace.path : undefined
  }

  /**
   * 一个会话请求该不该转给对端：只有镜像会话（`remote-` 前缀）才是远端会话。
   * 本机会话的目录可能和某台设备登记来的远程工作区同路径（两台机器上同一个仓库的检出路径一样很常见），
   * 不能只凭目录就把它转给对端——实测本机会话被发到了对端，回了一句「远端设备未连接」。
   * @param sessionId 本机会话 id。
   * @returns 它所在的远程工作区；不是远端会话时返回 undefined。
   */
  const refOfSession = (sessionId: string): RemoteWorkspaceRef | undefined => {
    const known = sessions.get(sessionId)
    if (known !== undefined) return known
    if (!isMirrorId(sessionId)) return undefined
    const cwd = cwdOf(sessionId)
    return cwd === undefined ? undefined : refForPath(cwd)
  }

  /**
   * 「在这个工作区里新建会话」是不是要建在远端：只有「远端专属」的工作区才建在远端——本机没有这个目录。
   * 同路径的本地与远程工作区在官方里并成同一个工作区，页面启动时「恢复当前会话」的新建也带着它的 id；
   * 把这种新建发到对端，对端离线时整个侧栏都起不来（实测）。本机有这个目录，就一律在本机新建。
   * @param request 新建会话请求。
   * @param path 目标目录。
   * @returns 该建在远端时返回 true。
   */
  const wantsRemoteWorkspace = (_request: SessionCreateRequestLike, path: string): boolean => !localDirectoryExists(path)

  /**
   * 把远端建出来的会话挂到本机工作区上。
   *
   * 官方侧栏按 `workspace.sessionIds` 分组，不挂上去这个会话就落进「未分组」——
   * 界面看起来像「新建会话没反应」，实际是会话建出来了但没归到工作区。
   * @param workspaceId 建会话请求里的目标工作区。
   * @param sessionId 远端返回的会话 id。
   */
  const attachToWorkspace = async (workspaceId: string | undefined, sessionId: string): Promise<void> => {
    if (workspaceId === undefined || workspaceId === '') return
    const workspace = workspaceRegistryOf(ctx)?.get?.(workspaceId)
    if (workspace === undefined || typeof workspace.attachSession !== 'function') return
    try {
      await workspace.attachSession(sessionId)
    } catch (error) {
      warn(`dsh-remote-access: 远程会话 ${sessionId} 未能挂到工作区 ${workspaceId}：${String((error as Error)?.message ?? error)}`)
    }
  }


  /**
   * 登记一条新发现的镜像：记进会话表、挂进本机的远程工作区、立刻同步。
   * 对账与 SSE 就绪帧发现的会话都走这里——只登记不挂载的话，官方侧栏不会显示它。
   */
  const registerMirror = (localId: string, ref: RemoteWorkspaceRef): void => {
    // 退役的镜像（已被接管）不回来：回推成功后由回推流程显式重新登记。
    if (options.isRetired?.(localId) === true) return
    sessions.set(localId, ref)
    void attachToWorkspace(ref.workspaceId, localId)
    void pullOne(localId, ref).catch(() => undefined)
  }
  // 会话/工作区记录里可能带着重新配对前的主机 id：同一台机器 origin 不变，按它兜底。
  const hostForRef = (ref: RemoteWorkspaceRef | undefined): RemoteHostRecord | undefined => {
    if (ref === undefined) return undefined
    const direct = hosts.get(ref.hostId)
    if (direct !== undefined) return direct
    const at = ref.hostId.lastIndexOf('@')
    const origin = at < 0 ? '' : ref.hostId.slice(at + 1)
    const byOrigin = origin === '' ? undefined : hosts.list().find((entry) => entry.origin === origin)
    if (byOrigin !== undefined) return byOrigin
    const paired = hosts.list()
    return paired.length === 1 ? paired[0] : undefined
  }

  /**
   * 一条本机镜像会话对应的远端会话 id。
   * @param sessionId 本机镜像会话 id。
   * @param ref 它所在的远程工作区。
   * @returns 远端会话 id；镜像带着别的主机的前缀、对不上时返回 undefined。
   */
  const remoteSessionIdOf = (sessionId: string, ref: RemoteWorkspaceRef): string | undefined =>
    remoteIdOfMirror(sessionId, ref.hostId)

  /**
   * 把发往 A 的参数里的本机镜像 id 换成远端会话 id。
   * 各命名空间的会话标识字段名不同（sessionId / agentId / workspaceFileScopeId …），所以按值替换，不依赖字段名。
   * @param args 官方调用的参数。
   * @param sessionId 本机镜像会话 id。
   * @param ref 它所在的远程工作区。
   * @returns 换好 id 的参数。
   * @throws Error 镜像带着别的主机的前缀：宁可拒绝，也不把一个错的 id 发给别的设备。
   */
  const toRemoteArgs = <T>(args: T, sessionId: string, ref: RemoteWorkspaceRef): T => {
    const remoteSessionId = remoteSessionIdOf(sessionId, ref)
    if (remoteSessionId === undefined) throw new Error(`mirror: 镜像会话 ${sessionId} 不属于主机 ${ref.hostId}`)
    return replaceSessionIds(args, { [sessionId]: remoteSessionId })
  }
  const original = {
    create: controller.create?.bind(controller),
    prompt: controller.prompt?.bind(controller),
    state: controller.state?.bind(controller),
    observeState: controller.observeState?.bind(controller),
    modelCatalog: controller.modelCatalog?.bind(controller),
    selectModel: controller.selectModel?.bind(controller),
    cancel: controller.cancel?.bind(controller),
  }

  if (original.create !== undefined) {
    controller.create = async (request: SessionCreateRequestLike): Promise<SessionCreateValueLike> => {
      const path = targetPathOf(request)
      let ref = path === undefined ? undefined : refForPath(path)
      // 本机和远端有同路径的工作区时按本机新建：宁可少转发，也不把本机的操作发到对端。
      if (ref !== undefined && path !== undefined && !wantsRemoteWorkspace(request, path)) {
        warn(`dsh-remote-access: ${path} 本机和远端都有工作区，按本机会话新建`)
        ref = undefined
      }
      if (ref === undefined || path === undefined) {
        // 目录没对上远程工作区：记一条，便于区分「不是远程工作区」与「远程工作区表没同步」。
        if (path !== undefined) warn(`dsh-remote-access: 建会话的目录不在远程工作区表里，按本机会话处理：${path}`)
        return await original.create!(request)
      }
      const host = hosts.get(ref.hostId)
      if (host === undefined) {
        warn(`dsh-remote-access: 远程工作区的主机已不在配对表里（${ref.hostId}），本次按本机会话处理`)
        return await original.create!(request)
      }
      try {
        // 会话必须建在 A 机自己的那个工作区里：只给 cwd 的话 A 侧栏会把它归到「未分组」。
        // workspace/create 按路径幂等，重复调用返回同一个工作区。
        let remoteWorkspaceId: string | undefined
        try {
          remoteWorkspaceId = (await createRemoteWorkspace(host, path)).workspaceId
        } catch (error) {
          warn(`dsh-remote-access: 在 ${ref.hostId} 上准备远程工作区失败，改按目录建会话：${String((error as Error)?.message ?? error)}`)
        }
        const remoteSessionId = await createRemoteSession(host, remoteWorkspaceId === undefined ? { cwd: path } : { workspaceId: remoteWorkspaceId })
        // 本机看到的是镜像会话：id 带 remote- 前缀，界面上的后续操作都落在它上面，再由桥接转回 A。
        const sessionId = mirrorIdOf(ref.hostId, remoteSessionId)
        sessions.set(sessionId, ref)
        flush()
        lastRemoteHostId = ref.hostId
        // 镜像只是「本机也能看到」，失败绝不能把会话身份改回本机：
        // 一旦这里抛错走到下面的 catch，本机会另建一个 id 不同的会话，
        // 之后消息发到 A 就找不到会话，界面表现为「发了没回复」。
        // 会话存储此刻可能还没就绪（ctx.get 返回 undefined），那就交给轮询补。
        const mirrorStore = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined) as SessionStoreLike | undefined
        if (mirrorStore === undefined) {
          warn(`dsh-remote-access: 会话存储尚未就绪，${sessionId} 的镜像交给轮询`)
        } else {
          try {
            await pullOne(sessionId, ref)
          } catch (error) {
            warn(`dsh-remote-access: 首次镜像 ${sessionId} 失败（会话仍建在 ${ref.hostId} 上，稍后轮询重试）：${String((error as Error)?.message ?? error)}`)
          }
        }
        await attachToWorkspace(request.workspaceId, sessionId)
        return { sessionId, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
      } catch (error) {
        // 远端建不出来时不能让界面静默失败：退回本机会话，并把原因写进日志。
        warn(`dsh-remote-access: 在 ${ref.hostId} 上建远程会话失败，退回本机会话：${String((error as Error)?.message ?? error)}`)
        return await original.create!(request)
      }
    }
  }

  // 投消息：远程会话一律转发给 A 机，本机不跑 agent。
  if (original.prompt !== undefined) {
    controller.prompt = async (request: SessionPromptRequestLike, signal?: AbortSignal): Promise<SessionPromptValueLike> => {
      const known = refOfSession(request.sessionId)
      // 本机会话照常执行；远程会话只转发，任何情况都不退回本地执行。
      // 退回本地会让人在界面上看到「正常回答」，而那份上下文根本不在本机。
      if (known === undefined && !sessions.has(request.sessionId)) {
        return await original.prompt!(request, signal)
      }
      const host = hostForRef(known)
      if (host === undefined) {
        throw new Error('远端设备未连接，请确认对端 DSH 正在运行后再试')
      }
      if (known !== undefined) {
        sessions.set(request.sessionId, known)
        flush()
      }
      if (known === undefined) return await original.prompt!(request, signal)
      try {
        const remoteSessionId = toRemoteArgs({ sessionId: request.sessionId }, request.sessionId, known).sessionId
        const accepted = await promptRemoteSession(host, remoteSessionId, textOf(request.content), request.requestId)
        // 第一条消息把对端的 agent 拉起来后，补发之前排队的命令（权限模式等）。
        const queued = pendingCommands.get(request.sessionId)
        if (queued !== undefined && queued.length > 0) {
          pendingCommands.delete(request.sessionId)
          for (const line of queued) {
            try {
              await callRemote(host, 'commands/execute', { agentId: remoteSessionId, line, submittedAttachments: [] })
            } catch (error) {
              warn(`dsh-remote-access: 补发排队命令失败 ${line}：${String((error as Error)?.message ?? error)}`)
            }
          }
        }
        return { accepted }
      } catch (error) {
        throw new Error(`发送到远端失败：${String((error as Error)?.message ?? error)}`)
      }
    }
  }

  // 取消：同样转发，否则 A 机的 agent 会一直跑下去。
  if (original.cancel !== undefined) {
    controller.cancel = (request: SessionCancelRequestLike): SessionCancelValueLike => {
      const ref = sessions.get(request.sessionId)
      const host = ref === undefined ? undefined : hosts.get(ref.hostId)
      if (ref === undefined || host === undefined) return original.cancel!(request)
      const remoteSessionId = remoteSessionIdOf(request.sessionId, ref)
      if (remoteSessionId === undefined) return original.cancel!(request)
      void cancelRemoteSession(host, remoteSessionId).catch((error: unknown) => {
        warn(`dsh-remote-access: 转发取消失败 ${String((error as Error)?.message ?? error)}`)
      })
      return { accepted: true }
    }
  }

  // 运行态：远程会话在本机没有 agent，官方状态恒为 running=false，
  // 界面就不会显示「深度求索中」和暂停按钮。这里按本地镜像日志里最后一个
  // turn/start 是否还没配到 turn/end 来覆盖 running。
  const isRemoteSession = (sessionId: string): boolean => {
    return refOfSession(sessionId) !== undefined
  }
  const turnOpen = (sessionId: string): boolean => {
    const store = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined) as
      { get?: (id: string) => { snapshotEvents?: () => readonly { type?: string }[] } | undefined } | undefined
    const live = store?.get?.(sessionId)
    const events = live?.snapshotEvents?.() ?? []
    let open = false
    for (const event of events) {
      if (event.type === 'turn/start') open = true
      else if (event.type === 'turn/end') open = false
    }
    return open
  }
  const withRunning = (value: Record<string, unknown>, sessionId: string): Record<string, unknown> => {
    if (!isRemoteSession(sessionId)) return value
    const running = turnOpen(sessionId)
    return value.running === running ? value : { ...value, running }
  }
  if (original.state !== undefined) {
    controller.state = async (request, signal) => withRunning(await original.state!(request, signal), request.sessionId)
  }
  if (original.observeState !== undefined) {
    controller.observeState = (request, signal) => {
      const source = original.observeState!(request, signal)
      return (async function* patched() {
        for await (const frame of source) yield withRunning(frame, request.sessionId)
      })()
    }
  }

  // 模型目录：远程会话的模型属于 A 机，本地目录会显示本机才有的模型（A 没配模型时尤其误导）。
  // 命令（/permission、/model 等）：远程会话的命令必须在 A 机上执行，
  // 本地执行只会往镜像会话里写本地事件，权限模式改完又被远端状态覆盖回去。
  const commandsService = (typeof ctx.get === 'function' ? ctx.get('commands') : undefined) as {
    execute?: (agent: { session?: { id?: string } }, line: string, attachments: readonly unknown[], signal?: AbortSignal) => Promise<unknown>
  } | undefined
  if (commandsService !== undefined && typeof commandsService.execute === 'function') {
    const originalExecute = commandsService.execute.bind(commandsService)
    commandsService.execute = async (agent, line, attachments, signal) => {
      const id = agent?.session?.id
      const ref = id === undefined ? undefined : refOfSession(id)
      const host = ref === undefined ? undefined : hosts.get(ref.hostId)
      if (id === undefined || ref === undefined || host === undefined) return await originalExecute(agent, line, attachments, signal)
      sessions.set(id, ref)
      lastRemoteHostId = ref.hostId
      flush()
      const remoteSessionId = remoteSessionIdOf(id, ref)
      if (remoteSessionId === undefined) return await originalExecute(agent, line, attachments, signal)
      return await callRemote(host, 'commands/execute', { agentId: remoteSessionId, line, submittedAttachments: attachments })
    }
  }

  // 流式接口（任务列表、文件变更、终端输出）走 typert 的 WebSocket 流载体，
  // 本机没有远端数据，所以整条流代理到 A 机。
  const streamTarget = (sessionId: string): { host: RemoteHostRecord, remoteSessionId: string } | undefined => {
    const ref = refOfSession(sessionId)
    const host = ref === undefined ? undefined : hostForRef(ref)
    const remoteSessionId = ref === undefined ? undefined : remoteSessionIdOf(sessionId, ref)
    return host === undefined || remoteSessionId === undefined ? undefined : { host, remoteSessionId }
  }
  // 服务可能比桥接晚就绪：用 inject 等它出现再包，别在安装时抓一次。
  const installStreamProxies = (): void => {
    const jobController = (typeof ctx.get === 'function' ? ctx.get('jobController') : undefined) as {
    list?: (request: { sessionId: string }, signal?: AbortSignal) => AsyncIterable<unknown>
  } | undefined
  if (jobController !== undefined && typeof jobController.list === 'function') {
    const originalList = jobController.list.bind(jobController)
    jobController.list = (request, signal) => {
      const target = streamTarget(request.sessionId)
      if (target === undefined) return originalList(request, signal)
      return openRemoteStream(target.host, 'job/list', { request: { ...request, sessionId: target.remoteSessionId } }, signal)
    }
  }
  const workspaceFilesService = (typeof ctx.get === 'function' ? ctx.get('workspaceFiles') : undefined) as {
    changes?: (scope: { sessionId?: string } | string, path: string, signal?: AbortSignal) => AsyncIterable<unknown>
  } | undefined
  if (workspaceFilesService !== undefined && typeof workspaceFilesService.changes === 'function') {
    const originalChanges = workspaceFilesService.changes.bind(workspaceFilesService)
    workspaceFilesService.changes = (scope, path, signal) => {
      const sessionId = typeof scope === 'string' ? scope : scope?.sessionId
      const target = sessionId === undefined ? undefined : streamTarget(sessionId)
      if (target === undefined) return originalChanges(scope, path, signal)
      return openRemoteStream(target.host, 'workspaceFiles/changes', { workspaceFileScopeId: target.remoteSessionId, path }, signal)
    }
  }
    warn(`dsh-remote-access: 流代理已安装（job=${jobController === undefined ? 'no' : 'yes'} files=${workspaceFilesService === undefined ? 'no' : 'yes'}）`)
  }
  try {
    const injectable = ctx as unknown as { inject?: (deps: string[], fn: () => void) => void }
    if (typeof injectable.inject === 'function') injectable.inject(['jobController'], installStreamProxies)
    else installStreamProxies()
  } catch { /* 服务不可用时流代理不装，其余功能照常 */ }

  // 双向流代理：终端的输入走流载体 uplink，单向代理拿不到，所以再开一条
  // WebSocket 路由，把浏览器和 A 机的 mux 直接对接。
  try {
    const injectable = ctx as unknown as { inject?: (deps: string[], fn: (scope: unknown) => void) => void }
    const installRoute = (scope: unknown): void => {
      const webServer = (scope as { webServer?: UpgradeRegistrar } | undefined)?.webServer
      if (webServer === undefined || typeof webServer.registerUpgrade !== 'function') return
      installRemoteStreamRoute(webServer, (sessionId) => streamTarget(sessionId))
    }
    if (typeof injectable.inject === 'function') injectable.inject(['webServer'], installRoute)
  } catch { /* webServer 不可用时只保留单向代理 */ }

  // 附件上传：浏览器走的是原始字节路由 /api/session/uploadFileBinary（不是 typert 调用），
  // 本地存下来的文件 A 机看不到，所以远程会话的字节要原样转给 A 机存。
  const uploadsService = (typeof ctx.get === 'function' ? ctx.get('fileUploads') : undefined) as {
    uploadStream?: (request: { sessionId: string, data: AsyncIterable<Uint8Array>, signal?: AbortSignal, name?: string }) => Promise<unknown>
    uploadImageStream?: (request: { sessionId: string, data: AsyncIterable<Uint8Array>, mediaType: string, signal?: AbortSignal, name?: string }) => Promise<unknown>
  } | undefined
  const originalUploads = {
    uploadStream: uploadsService?.uploadStream?.bind(uploadsService),
    uploadImageStream: uploadsService?.uploadImageStream?.bind(uploadsService),
  }
  const forwardUpload = async (
    request: { sessionId: string, data: AsyncIterable<Uint8Array>, signal?: AbortSignal, name?: string, mediaType?: string },
  ): Promise<unknown> => {
    const ref = refOfSession(request.sessionId)
    const host = ref === undefined ? undefined : hosts.get(ref.hostId)
    const remoteSessionId = ref === undefined ? undefined : remoteSessionIdOf(request.sessionId, ref)
    if (host === undefined || remoteSessionId === undefined) return undefined
    const chunks: Uint8Array[] = []
    for await (const chunk of request.data) chunks.push(chunk)
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    const params = new URLSearchParams({ sessionId: remoteSessionId })
    if (request.name !== undefined) params.set('name', request.name)
    if (request.mediaType !== undefined) params.set('mediaType', request.mediaType)
    const response = await fetchFromHost(host, `/api/session/uploadFileBinary?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    })
    const text = await response.text()
    const parsed = JSON.parse(text) as { ok?: boolean, value?: unknown, error?: { message?: string } }
    if (parsed.ok !== true) throw new Error(parsed.error?.message ?? '远端上传失败')
    return parsed.value
  }
  if (uploadsService !== undefined) {
    if (originalUploads.uploadStream !== undefined) {
      uploadsService.uploadStream = async (request) => (await forwardUpload(request)) ?? await originalUploads.uploadStream!(request)
    }
    if (originalUploads.uploadImageStream !== undefined) {
      uploadsService.uploadImageStream = async (request) => (await forwardUpload(request)) ?? await originalUploads.uploadImageStream!(request)
    }
  }

  // 接口不带会话 id，所以按「最近用到的远程主机」取；取不到再退回本地。
  if (original.modelCatalog !== undefined) {
    controller.modelCatalog = async (): Promise<unknown> => {
      const host = lastRemoteHostId === undefined ? undefined : hosts.get(lastRemoteHostId)
      if (host === undefined) return await original.modelCatalog!()
      try {
        return await callRemote(host, 'session/modelCatalog', {})
      } catch (error) {
        warn(`dsh-remote-access: 取 ${host.hostId} 的模型目录失败，退回本机目录：${String((error as Error)?.message ?? error)}`)
        return await original.modelCatalog!()
      }
    }
  }

  // 选模型：远程会话的模型属于 A 机，本地没有 agent 可 resume，必须转发。
  // 不转发的话官方会去 resume 一个不存在的本地 agent，报「already exists」。
  if (original.selectModel !== undefined) {
    controller.selectModel = async (request: SessionSelectModelRequestLike): Promise<unknown> => {
      const ref = refOfSession(request.sessionId)
      if (ref === undefined) return await original.selectModel!(request)
      const host = hosts.get(ref.hostId)
      lastRemoteHostId = ref.hostId
      if (host === undefined) return await original.selectModel!(request)
      sessions.set(request.sessionId, ref)
      flush()
      // 失败就如实抛回界面：本地没有 agent，退回本地只会再撞一次 already exists。
      return await callRemote(host, 'session/selectModel', { request: toRemoteArgs(request, request.sessionId, ref) })
    }
  }

  /**
   * 把一条镜像会话同步到水位：按 seq 游标分页拉取，先进镜像缓存，再进官方镜像会话。
   * @param sessionId 本机镜像会话 id。
   * @param ref 它所在的远程工作区。
   * @returns 同步结果；主机已不在配对表里时返回 undefined。
   */
  const inflight = new Map<string, Promise<MirrorSyncResult | undefined>>()
  // 轮询每 800ms 一轮：对端掉线时同一条失败会连续出现，日志一分钟只报一次，不跟着刷屏。
  const failures = createFailureThrottle(60_000)
  // 同一条镜像会话同一时刻只跑一次同步：轮询、推送、手动同步会同时到来，
  // 并发的两次会拿着过期的进度去读刚更新的缓存，把同一批事件往镜像里写两遍。
  const pullOne = (sessionId: string, ref: RemoteWorkspaceRef): Promise<MirrorSyncResult | undefined> => {
    const running = inflight.get(sessionId)
    if (running !== undefined) return running
    const task = syncOne(sessionId, ref).finally(() => { inflight.delete(sessionId) })
    inflight.set(sessionId, task)
    return task
  }
  const syncOne = async (sessionId: string, ref: RemoteWorkspaceRef): Promise<MirrorSyncResult | undefined> => {
    const host = hostForRef(ref)
    if (host === undefined) return undefined
    const store = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined) as SessionStoreLike | undefined
    if (store === undefined) return undefined
    const remoteSessionId = remoteSessionIdOf(sessionId, ref)
    if (remoteSessionId === undefined) throw new Error(`mirror: 镜像会话 ${sessionId} 不属于主机 ${ref.hostId}`)
    const result = await syncRemoteMirror({
      host,
      remoteSessionId,
      cwd: ref.path,
      store: store as never,
      persistence: persistenceOf(),
      cache,
      projectionCache: projectionCacheOf(),
      materialized: materialized.get(sessionId),
    })
    cursors.set(sessionId, { seq: result.watermark })
    failures.clear(sessionId)
    materialized.set(sessionId, result.materialized)
    if (result.appended > 0) {
      warn(`dsh-remote-access: 镜像 ${sessionId} 追加 ${String(result.appended)} 条，水位 ${String(result.watermark)}，投影${result.folded ? '已更新' : '未更新'}`)
    }
    flush()
    const open = turnOpen(sessionId)
    if (runningState.get(sessionId) !== open) {
      runningState.set(sessionId, open)
      try { (ctx as { emit?: (name: string, id: string, running: boolean) => void }).emit?.('api-session/status', sessionId, open) } catch { /* 事件发不出去不影响镜像 */ }
    }
    // 同步成功就向 A 登记订阅。必须在返回之前：这一行曾写在 return 后面，成了一行永远执行不到的代码。
    ensureWatched(sessionId, ref)
    return result
  }

  /**
   * 核实远端是否真的没有这条会话。
   * 远端说「找不到」不一定是真没了——它刚重启时会话库短暂不可用，读到的也是「找不到」；就算远端的会话清单里
   * 没有它，也未必是删了——远端正在停机的那十几秒，会话库已经拆了、lane 却还在应答，给出的是一份空清单。
   * 把它当成删除会让本机注销镜像并退订，之后再也回不来，正要被接管的镜像也会在瞬间消失（实测）。所以以远端的
   * 会话清单为准，并且要连续两次、间隔至少 30 秒都不在清单里才算；清单为空、拿不到或在清单里就重新计。
   */
  const GONE_CONFIRM_GAP_MS = 30_000
  const confirmGone = createGoneConfirm({ gapMs: GONE_CONFIRM_GAP_MS })
  const remoteSessionGone = async (sessionId: string, ref: RemoteWorkspaceRef): Promise<boolean> => {
    const host = hostForRef(ref)
    const remoteSessionId = remoteIdOfMirror(sessionId, ref.hostId)
    if (host === undefined || remoteSessionId === undefined) return true
    try {
      const headers = await fetchRemoteSessions(host, ref.path)
      // 空清单分不清是「全删了」还是「正在停机」：按问不到处理，不当成删除。
      return confirmGone(sessionId, headers.length === 0 ? 'unknown' : headers.some((header) => header.id === remoteSessionId) ? 'present' : 'absent')
    } catch {
      return confirmGone(sessionId, 'unknown')
    }
  }


  // 定期对账（#152）：按远端的会话清单补上本机还没登记的镜像——A 上新建的会话在这里出现在本机，
  // 曾被注销的镜像也从这里回来。每 30 秒一轮；清单拿不到（对端离线或在重启）就等下一轮。
  const RECONCILE_INTERVAL_MS = 30_000
  let reconcileAt = 0
  const reconcileRemoteSessions = async (): Promise<void> => {
    const now = Date.now()
    if (now < reconcileAt) return
    reconcileAt = now + RECONCILE_INTERVAL_MS
    const seen = new Set<string>()
    for (const ref of workspaces()) {
      const key = `${ref.hostId}\n${ref.path}`
      if (seen.has(key)) continue
      seen.add(key)
      const host = hostForRef(ref)
      if (host === undefined) continue
      try {
        for (const header of await fetchRemoteSessions(host, ref.path)) {
          const localId = mirrorIdOf(host.hostId, header.id)
          if (sessions.has(localId)) continue
          registerMirror(localId, ref)
        }
      } catch { /* 对端暂时不可达：下一轮再看 */ }
    }
    flush()
  }
  const pullAll = async (): Promise<void> => {
    for (const [sessionId, ref] of sessions) {
      try {
        const result = await pullOne(sessionId, ref)
        // 远端已经没有这个会话（被删/换机，经清单核实）：从登记表摘掉，否则每轮同步都白发一次请求。
        if (result?.missing === true && await remoteSessionGone(sessionId, ref)) {
          sessions.delete(sessionId)
          cursors.delete(sessionId)
          materialized.delete(sessionId)
          flush()
          // 远端已经没有这条会话：连同订阅一起退掉。
          const host = hostForRef(ref)
          const remoteSessionId = remoteIdOfMirror(sessionId, ref.hostId)
          if (host !== undefined && remoteSessionId !== undefined) void unwatchRemoteSession(host, remoteSessionId).catch(() => undefined)
          watched.delete(sessionId)
        }
      } catch (error) {
        // 单台主机掉线不该拖垮其它会话的镜像；同一条失败一分钟只报一次。
        const text = failures.report(sessionId, String((error as Error)?.message ?? error))
        if (text !== undefined) warn(`dsh-remote-access: 镜像 ${sessionId} 失败：${text}`)
      }
    }
    await reconcileRemoteSessions()
  }

  // —— 按会话订阅（#151 / #152）——
  // 向 A 登记本机镜像了它的哪条会话：之后事件增量、提问、审批都沿长连接推过来，不再只靠轮询。
  const watched = new Set<string>()
  const ensureWatched = (sessionId: string, ref: RemoteWorkspaceRef): void => {
    if (watched.has(sessionId)) return
    const host = hostForRef(ref)
    const remoteSessionId = remoteIdOfMirror(sessionId, ref.hostId)
    if (host === undefined || remoteSessionId === undefined) return
    watched.add(sessionId)
    // 长连接只在启动时按当时的主机表建过一次；先启动、后配对的主机到这里才第一次有会话要同步，补建一条。
    ensureStream(host)
    void watchRemoteSession(host, remoteSessionId, ref.path).catch((error: unknown) => {
      watched.delete(sessionId)
      warn(`dsh-remote-access: 订阅 ${sessionId} 失败，退回轮询：${String((error as Error)?.message ?? error)}`)
    })
  }

  // —— 交互中继（#151）——
  // A 上的提问 / 审批推过来时记在这里，由本机客户端插件取走并渲染成卡片；用户给出回答后经这里交回 A。
  // 镜像会话上不留本机 agent（否则官方会在恢复它时往镜像里补写中断收尾，见客户端闸门的说明），
  // 所以不走官方提问界面。
  // A 那边落定时会推来「已落定」：本机已经答过的就此结束；还没答的（超时、取消、别处先答）标记为
  // 「已交回设备本机」，在客户端停留一会儿让人看到结果，然后撤掉。
  interface PendingInteraction {
    host: RemoteHostRecord
    /** 本机镜像会话 id。 */
    sessionId: string
    frame: Exclude<InteractionFrame, { type: 'settled' }>
    handedBack: boolean
    handedBackAt: number
  }
  const pendingInteractions = new Map<string, PendingInteraction>()
  const HAND_BACK_LINGER_MS = 60_000
  const presentInteraction = (host: RemoteHostRecord, frame: InteractionFrame): void => {
    if (frame.type === 'settled') {
      const pending = pendingInteractions.get(frame.requestId)
      if (pending === undefined) return
      if (frame.reason === 'closed') {
        pending.handedBack = true
        pending.handedBackAt = Date.now()
      } else {
        pendingInteractions.delete(frame.requestId)
      }
      return
    }
    // 找到这条远端会话在本机的镜像；本机没有它的镜像时无人能答，交给 A 本地界面。
    const hit = [...sessions].find(([mirrorId, ref]) => remoteIdOfMirror(mirrorId, ref.hostId) === frame.sessionId && hostForRef(ref)?.hostId === host.hostId)
    if (hit === undefined || pendingInteractions.has(frame.requestId)) return
    pendingInteractions.set(frame.requestId, { host, sessionId: hit[0], frame, handedBack: false, handedBackAt: 0 })
    warn(`dsh-remote-access: 来自 ${host.hostId} 的${frame.type === 'question' ? '提问' : '审批'} ${frame.requestId} 等待本机用户回答`)
  }
  /** 列出等本机用户回答的交互；过了停留期的「已交回」项顺手清掉。 */
  const listPendingInteractions = (sessionId?: string): PendingInteractionView[] => {
    const now = Date.now()
    for (const [requestId, pending] of pendingInteractions) {
      if (pending.handedBack && now - pending.handedBackAt >= HAND_BACK_LINGER_MS) pendingInteractions.delete(requestId)
    }
    const views: PendingInteractionView[] = []
    for (const pending of pendingInteractions.values()) {
      if (sessionId !== undefined && pending.sessionId !== sessionId) continue
      const { frame } = pending
      views.push(frame.type === 'question'
        ? { requestId: frame.requestId, sessionId: pending.sessionId, type: 'question', questions: frame.questions, handedBack: pending.handedBack }
        : {
          requestId: frame.requestId, sessionId: pending.sessionId, type: 'approval', toolName: frame.toolName,
          ...(frame.callId === undefined ? {} : { callId: frame.callId }), ...(frame.reason === undefined ? {} : { reason: frame.reason }),
          handedBack: pending.handedBack,
        })
    }
    return views
  }
  /**
   * 把本机用户给出的回答交回 A。
   * @returns A 收下为 true；回答不合法、这条交互本机没有或已交回、A 那边已经落定时为 false。
   */
  const answerInteraction = async (raw: unknown): Promise<boolean> => {
    const answer = parseInteractionAnswer(raw)
    if (answer === undefined) return false
    const pending = pendingInteractions.get(answer.requestId)
    if (pending === undefined || pending.handedBack) return false
    const accepted = await answerRemoteInteraction(pending.host, answer)
    if (accepted) pendingInteractions.delete(answer.requestId)
    return accepted
  }

  const forgetSession = (sessionId: string): boolean => {
    const ref = sessions.get(sessionId)
    if (ref === undefined) return false
    sessions.delete(sessionId)
    cursors.delete(sessionId)
    materialized.delete(sessionId)
    watched.delete(sessionId)
    const remoteSessionId = remoteIdOfMirror(sessionId, ref.hostId)
    if (remoteSessionId !== undefined) {
      try { cache.remove(ref.hostId, remoteSessionId) } catch { /* 缓存删不掉不影响其余清理 */ }
    }
    return true
  }

  const forgetHost = (hostId: string): string[] => {
    const forgotten: string[] = []
    for (const sessionId of [...sessions.keys()]) {
      if (sessions.get(sessionId)?.hostId === hostId && forgetSession(sessionId)) forgotten.push(sessionId)
    }
    for (const [requestId, pending] of [...pendingInteractions]) {
      if (pending.host.hostId === hostId) pendingInteractions.delete(requestId)
    }
    flush()
    return forgotten
  }

  const timer = setInterval(() => { void pullAll() }, pollIntervalMs)
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) (timer as { unref: () => void }).unref()

  // 续租（#152）：A 侧的订阅有租约，本机断线或关掉应用后到期清除。在线时每个续租间隔把已登记的会话
  // 重登记一遍（登记幂等）；长连接没连上的主机不续——它的租约自然到期，A 侧观众数随之回落。
  const renewTimer = setInterval(() => {
    for (const sessionId of watched) {
      const ref = sessions.get(sessionId)
      if (ref === undefined) continue
      const host = hostForRef(ref)
      const remoteSessionId = remoteIdOfMirror(sessionId, ref.hostId)
      if (host === undefined || remoteSessionId === undefined || streamStates.get(host.hostId) !== 'connected') continue
      void watchRemoteSession(host, remoteSessionId, ref.path).catch(() => undefined)
    }
  }, REMOTE_WATCH_RENEW_MS)
  if (typeof renewTimer === 'object' && renewTimer !== null && 'unref' in renewTimer) (renewTimer as { unref: () => void }).unref()

  // SSE 订阅：B 启动就连，A 有新事件主动推过来。推送只当「有变化」的信号，
  // 真正的增量仍走 pullOne（复用已测过的镜像/落盘逻辑），所以断线补齐天然成立。
  const streamClients = new Map<string, RemoteStreamClient>()
  const streamStates = new Map<string, RemoteStreamState>()
  const ensureStream = (host: RemoteHostRecord): void => {
    if (streamClients.has(host.hostId)) return
    const client = createRemoteStreamClient(host, {
      onReady(shares) {
        warn(`dsh-remote-access: SSE ready，分享 ${shares.length} 个`)
        for (const share of shares) {
          const ref = refForPath(share.path)
          if (ref === undefined) continue
          // SSE 带的是远端会话 id；本机的镜像会话 id 由主机与它确定。
          const localId = mirrorIdOf(host.hostId, share.sessionId)
          registerMirror(localId, ref)
        }
        flush()
        // 重连后重新登记订阅：A 可能重启过（登记表在 A 上落盘，重复登记幂等）。
        watched.clear()
        for (const [sessionId, ref] of sessions) ensureWatched(sessionId, ref)
      },
      onSessionEvents(sessionId) {
        const localId = mirrorIdOf(host.hostId, sessionId)
        const ref = sessions.get(localId)
        if (ref === undefined) return
        void pullOne(localId, ref).catch(() => undefined)
      },
      onShareChange(kind, sessionId) {
        const localId = mirrorIdOf(host.hostId, sessionId)
        if (kind === 'removed') { sessions.delete(localId); flush(); return }
        const ref = sessions.get(localId)
        if (ref !== undefined) void pullOne(localId, ref).catch(() => undefined)
      },
      onInteraction(frame) { presentInteraction(host, frame) },
      onState(next) { streamStates.set(host.hostId, next) },
    })
    streamClients.set(host.hostId, client)
    client.start()
  }
  try {
    const known = hosts.list()
    warn(`dsh-remote-access: SSE 订阅启动，主机 ${known.length} 台`)
    for (const host of known) ensureStream(host)
  } catch (error) {
    warn(`dsh-remote-access: SSE 订阅未建立：${String((error as Error)?.message ?? error)}`)
  }

  return {
    sessions,
    register(sessionId, ref) { sessions.set(sessionId, ref) },
    async hydrate() {
      const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as SessionPersistenceLike | undefined
      const snapshots = (await persistence?.list?.()) ?? []
      for (const snapshot of snapshots) {
        const id = typeof snapshot.header.id === 'string' ? snapshot.header.id : ''
        const cwd = typeof snapshot.header.cwd === 'string' ? snapshot.header.cwd : ''
        if (id === '' || cwd === '') continue
        // 只有镜像会话才是远端会话：本机会话的目录可能和远程工作区同路径，不能在启动时被登记成镜像。
        if (!isMirrorId(id)) continue
        const ref = refForPath(cwd)
        if (ref !== undefined) sessions.set(id, ref)
      }
    },
    async invokeRemote(namespace, method, args) {
      const request = (args?.request ?? {}) as {
        sessionId?: unknown
        parentSessionId?: unknown
        workspaceId?: unknown
        address?: { sessionId?: unknown }
      }
      const pick = (...values: unknown[]): string | undefined => {
        for (const value of values) if (typeof value === 'string' && value !== '') return value
        return undefined
      }
      // 各命名空间的会话标识字段名不同：agentId / sessionId / workspaceFileScopeId / parentSessionId。
      const sessionId = pick(
        args?.agentId,
        args?.sessionId,
        args?.workspaceFileScopeId,
        args?.parentSessionId,
        args?.childSessionId,
        request.sessionId,
        request.parentSessionId,
        request.address?.sessionId,
      )
      let ref: RemoteWorkspaceRef | undefined
      if (sessionId !== undefined) {
        ref = refOfSession(sessionId)
      }
      // 工作区级操作（改名/删除）带的是本机 workspaceId：先按路径找到远程工作区，
      // 再把请求里的 id 换成 A 机自己的 workspaceId。
      const localWorkspaceId = typeof request.workspaceId === 'string' ? request.workspaceId : undefined
      let forwardedArgs = args
      if (localWorkspaceId !== undefined) {
        const localPath = workspaceRegistryOf(ctx)?.get?.(localWorkspaceId)?.path
        if (typeof localPath !== 'string') return undefined
        const remoteWorkspace = workspaces().find((workspace) => samePath(workspace.path, localPath))
        if (remoteWorkspace === undefined) return undefined
        ref = remoteWorkspace
        const hostForWorkspace = hosts.get(remoteWorkspace.hostId)
        if (hostForWorkspace === undefined) return undefined
        try {
          const remote = await createRemoteWorkspace(hostForWorkspace, remoteWorkspace.path)
          forwardedArgs = { ...args, request: { ...request, workspaceId: remote.workspaceId } }
        } catch (error) {
          warn(`dsh-remote-access: 解析 ${remoteWorkspace.hostId} 的工作区失败：${String((error as Error)?.message ?? error)}`)
          return undefined
        }
      }
      // 不带会话 id 的调用（如 permissionPresets/catalog）按「最近用到的远程主机」取。
      // 会话表会落盘；重新配对后主机 id 会变，旧记录里的 hostId 就找不到主机了。
      // 这时按工作区路径重新解析一次，避免静默退回「在本机执行」。
      let host = ref !== undefined ? hosts.get(ref.hostId) : undefined
      // 会话表会落盘：重新配对后 deviceId 变了，记录里还是旧的。同一台机器 origin 不变，
      // 所以先按 origin 兜底；只配对了一台主机时直接用它。
      if (host === undefined && ref !== undefined) {
        const at = ref.hostId.lastIndexOf('@')
        const origin = at < 0 ? '' : ref.hostId.slice(at + 1)
        if (origin !== '') host = hosts.list().find((entry) => entry.origin === origin)
      }
      if (host === undefined && sessionId !== undefined && (ref !== undefined || isMirrorId(sessionId))) {
        const cwdForRef = cwdOf(sessionId)
        const byPath = cwdForRef === undefined ? undefined : refForPath(cwdForRef)
        if (byPath !== undefined) {
          ref = byPath
          host = hosts.get(byPath.hostId)
        }
      }
      if (host === undefined) {
        host = lastRemoteHostId === undefined ? undefined : hosts.get(lastRemoteHostId)
      }
      if (host === undefined) {
        const paired = hosts.list()
        if (paired.length === 1) host = paired[0]
      }
      if (host === undefined) {
        // 这个会话确实是远程会话，但它挂的主机已经不在了：必须报错，不能返回 undefined
        // ——上层会当成 not-found，客户端就会把请求落到本机执行。
        if (sessionId !== undefined && sessions.has(sessionId)) {
          throw new Error('远端设备未连接，请确认对端 DSH 正在运行后再试')
        }
        return undefined
      }
      if (sessionId !== undefined && ref !== undefined) {
        sessions.set(sessionId, ref)
        flush()
      }
      lastRemoteHostId = host.hostId
      if (sessionId !== undefined && ref !== undefined) {
        // 镜像 id 换回远端会话 id；镜像带着别的主机的前缀时拒绝，不把错的 id 发出去。
        forwardedArgs = toRemoteArgs(forwardedArgs, sessionId, ref)
      }
      // 用包装对象区分「没有远端」与「远端成功但没有返回值」：
      // 后者若是 undefined，会被上层当成 not-found，客户端就会静默改在本机执行。
      return { value: await callRemote(host, `${namespace}/${method}`, forwardedArgs) }
      },
    pullAll,
    /** 每台主机的 SSE 连接状态（B 端徽标用）。 */
    streamState: (hostId: string) => streamStates.get(hostId) ?? 'disconnected',
    /** 立刻重连某台主机（发消息前发现断线时用）。 */
    reconnect: (hostId: string) => { streamClients.get(hostId)?.reconnectNow() },
    pullOne,
    pendingInteractions: listPendingInteractions,
    answerInteraction,
    forgetHost,
    forgetSession,
    registerMirror,
    async executeCommand(sessionId, line) {
      const cwd = isMirrorId(sessionId) ? cwdOf(sessionId) : undefined
      let ref = refOfSession(sessionId)
      let host = ref === undefined ? undefined : hosts.get(ref.hostId)
      // 同 invokeRemote：落盘的会话表可能带着重新配对前的主机 id。
      if (host === undefined && cwd !== undefined) {
        const byPath = refForPath(cwd)
        if (byPath !== undefined) { ref = byPath; host = hosts.get(byPath.hostId) }
      }
      if (ref === undefined || host === undefined) return undefined
      sessions.set(sessionId, ref)
      lastRemoteHostId = ref.hostId
      flush()
      try {
        const remoteSessionId = remoteSessionIdOf(sessionId, ref)
        if (remoteSessionId === undefined) return undefined
        return await callRemote(host, 'commands/execute', { agentId: remoteSessionId, line, submittedAttachments: [] })
      } catch (error) {
        const message = String((error as Error)?.message ?? error)
        if (!message.includes('already exists') && !message.includes('resume failed')) throw error
        pendingCommands.set(sessionId, [...(pendingCommands.get(sessionId) ?? []), line])
        warn(`dsh-remote-access: ${sessionId} 在 ${ref.hostId} 上还没有活体 agent，命令先排队：${line}`)
        return { queued: true }
      }
    },
    dispose() {
      clearInterval(timer)
      if (original.create !== undefined) controller.create = original.create
      if (original.prompt !== undefined) controller.prompt = original.prompt
      if (original.cancel !== undefined) controller.cancel = original.cancel
      if (uploadsService !== undefined) {
        if (originalUploads.uploadStream !== undefined) uploadsService.uploadStream = originalUploads.uploadStream
        if (originalUploads.uploadImageStream !== undefined) uploadsService.uploadImageStream = originalUploads.uploadImageStream
      }
      if (original.state !== undefined) controller.state = original.state
      if (original.observeState !== undefined) controller.observeState = original.observeState
      if (original.modelCatalog !== undefined) controller.modelCatalog = original.modelCatalog
      if (original.selectModel !== undefined) controller.selectModel = original.selectModel
    },
  }
}
