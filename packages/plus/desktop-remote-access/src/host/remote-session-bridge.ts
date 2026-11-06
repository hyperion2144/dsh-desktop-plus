//! 远端会话桥：让「远程工作区里的会话」在 B 机上只做渲染，真正的 agent 跑在 A 机。
//!
//! 官方会话生命周期有三个入口——建会话、投消息、取消——都挂在 `ctx.sessionController`
//! 这个服务实例上。本模块不改上游代码，也不替换服务（Cordis 的 `reflect.set` 拒绝跨
//! fiber 覆盖），而是在实例上包一层：命中远程工作区的请求转发给 A 机，其余原样放行。
//!
//! 判定「是不是远程会话」不靠额外状态：会话头的 cwd 就是 A 机上的绝对路径，而远程工作区
//! 登记表里存着同一串路径。两边对得上，这个会话就是远程的。重启后照样成立。
//!
//! 事件回流走 `remote-session-mirror.ts`：轮询 A 机的 `session/page`，把新增事件 append
//! 进本机官方会话日志，官方 push 流随即把它们推给客户端。
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'
import type { RemoteSessionEntry } from './remote-session-registry.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { callRemote, createRemoteSession, createRemoteWorkspace, promptRemoteSession, cancelRemoteSession } from './remote-rpc.js'
import { mirrorRemoteSession, type MirrorPersistenceLike } from './remote-session-mirror.js'
import { createRemoteStreamClient, type RemoteStreamClient, type RemoteStreamState } from './remote-stream-client.js'
import { installRemoteStreamRoute, type UpgradeRegistrar } from './remote-stream-route.js'
import { openRemoteStream } from './remote-stream.js'

/** 一条远程工作区登记（只取桥接用到的两个字段）。 */
export interface RemoteWorkspaceRef {
  /** 已配对主机 id。 */
  hostId: string
  /** A 机上的绝对路径。 */
  path: string
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
  /** 轮询间隔（毫秒）。 */
  pollIntervalMs?: number
  /** 启动时恢复上次落盘的远程会话登记（会话 id → 主机 / 目录 / 镜像游标）。 */
  restore?: () => RemoteSessionEntry[]
  /** 登记表变化时落盘，重启后据此继续镜像、继续对话。 */
  persist?: (entries: RemoteSessionEntry[]) => void
}

/** 桥接对外表面。 */
export interface RemoteSessionBridge {
  /** 会话 id → 它所在的远程工作区。 */
  readonly sessions: Map<string, RemoteWorkspaceRef>
  /** 把一个会话登记成远程会话（同步路径也会调）。 */
  register: (sessionId: string, ref: RemoteWorkspaceRef) => void
  /** 启动时按已落盘会话重建远程会话表。 */
  hydrate: () => Promise<void>
  /** 立即拉一次所有远程会话的新事件。 */
  pullAll: () => Promise<void>
  /** 立刻拉一次某个远程会话的最新事件。 */
  pullOne: (sessionId: string, ref: RemoteWorkspaceRef) => Promise<void>
  /** 每台主机的 SSE 连接状态（B 端徽标用）。 */
  streamState: (hostId: string) => RemoteStreamState
  /** 立刻重连某台主机（发消息前发现断线时用）。 */
  reconnect: (hostId: string) => void
  invokeRemote: (namespace: string, method: string, args: Record<string, unknown>) => Promise<unknown>
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
  const { ctx, hosts, workspaces, cursors } = options
  const pollIntervalMs = options.pollIntervalMs ?? 800
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



  /** 把当前登记表与游标写回磁盘。 */
  const flush = (): void => {
    if (options.persist === undefined) return
    try {
      options.persist([...sessions].map(([sessionId, ref]) => ({ sessionId, hostId: ref.hostId, path: ref.path, seq: cursors.get(sessionId)?.seq ?? 0 })))
    } catch { /* 落盘失败不影响会话本身 */ }
  }

  // 先恢复上次的登记与游标：否则重启后游标从 0 重来，会把整段历史再追加一遍。
  for (const entry of options.restore?.() ?? []) {
    sessions.set(entry.sessionId, { hostId: entry.hostId, path: entry.path })
    cursors.set(entry.sessionId, { seq: entry.seq })
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
      const ref = path === undefined ? undefined : refForPath(path)
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
        const sessionId = await createRemoteSession(host, remoteWorkspaceId === undefined ? { cwd: path } : { workspaceId: remoteWorkspaceId })
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
            await mirrorRemoteSession(host, sessionId, path, mirrorStore as never, cursors, persistenceOf())
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
      const ref = sessions.get(request.sessionId) ?? (() => {
        const cwd = cwdOf(request.sessionId)
        return cwd === undefined ? undefined : refForPath(cwd)
      })()
      if (ref === undefined) return await original.prompt!(request, signal)
      const host = hosts.get(ref.hostId)
      if (host === undefined) return await original.prompt!(request, signal)
      sessions.set(request.sessionId, ref)
      flush()
      try {
        const accepted = await promptRemoteSession(host, request.sessionId, textOf(request.content), request.requestId)
        // 第一条消息把 A 机的 agent 拉起来后，补发之前排队的命令（权限模式等）。
        const queued = pendingCommands.get(request.sessionId)
        if (queued !== undefined && queued.length > 0) {
          pendingCommands.delete(request.sessionId)
          for (const line of queued) {
            try {
              await callRemote(host, 'commands/execute', { agentId: request.sessionId, line, submittedAttachments: [] })
            } catch (error) {
              warn(`dsh-remote-access: 补发排队命令失败 ${line}：${String((error as Error)?.message ?? error)}`)
            }
          }
        }
        return { accepted }
      } catch (error) {
        warn(`dsh-remote-access: 转发消息到 ${ref.hostId} 失败，退回本机：${String((error as Error)?.message ?? error)}`)
        return await original.prompt!(request, signal)
      }
    }
  }

  // 取消：同样转发，否则 A 机的 agent 会一直跑下去。
  if (original.cancel !== undefined) {
    controller.cancel = (request: SessionCancelRequestLike): SessionCancelValueLike => {
      const ref = sessions.get(request.sessionId)
      const host = ref === undefined ? undefined : hosts.get(ref.hostId)
      if (ref === undefined || host === undefined) return original.cancel!(request)
      void cancelRemoteSession(host, request.sessionId).catch((error: unknown) => {
        warn(`dsh-remote-access: 转发取消失败 ${String((error as Error)?.message ?? error)}`)
      })
      return { accepted: true }
    }
  }

  // 运行态：远程会话在本机没有 agent，官方状态恒为 running=false，
  // 界面就不会显示「深度求索中」和暂停按钮。这里按本地镜像日志里最后一个
  // turn/start 是否还没配到 turn/end 来覆盖 running。
  const isRemoteSession = (sessionId: string): boolean => {
    const cwd = cwdOf(sessionId)
    return sessions.has(sessionId) || (cwd !== undefined && refForPath(cwd) !== undefined)
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
      const cwd = id === undefined ? undefined : cwdOf(id)
      const ref = id === undefined ? undefined : (sessions.get(id) ?? (cwd === undefined ? undefined : refForPath(cwd)))
      const host = ref === undefined ? undefined : hosts.get(ref.hostId)
      if (id === undefined || ref === undefined || host === undefined) return await originalExecute(agent, line, attachments, signal)
      sessions.set(id, ref)
      lastRemoteHostId = ref.hostId
      flush()
      return await callRemote(host, 'commands/execute', { agentId: id, line, submittedAttachments: attachments })
    }
  }

  // 流式接口（任务列表、文件变更、终端输出）走 typert 的 WebSocket 流载体，
  // 本机没有远端数据，所以整条流代理到 A 机。
  const streamTarget = (sessionId: string): { host: RemoteHostRecord } | undefined => {
    const cwd = cwdOf(sessionId)
    const ref = sessions.get(sessionId) ?? (cwd === undefined ? undefined : refForPath(cwd))
    const host = ref === undefined ? undefined : hosts.get(ref.hostId)
    return host === undefined ? undefined : { host }
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
      return openRemoteStream(target.host, 'job/list', { request }, signal)
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
      return openRemoteStream(target.host, 'workspaceFiles/changes', { workspaceFileScopeId: sessionId, path }, signal)
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
      installRemoteStreamRoute(webServer, (sessionId) => streamTarget(sessionId)?.host)
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
    const cwd = cwdOf(request.sessionId)
    const ref = sessions.get(request.sessionId) ?? (cwd === undefined ? undefined : refForPath(cwd))
    const host = ref === undefined ? undefined : hosts.get(ref.hostId)
    if (host === undefined) return undefined
    const chunks: Uint8Array[] = []
    for await (const chunk of request.data) chunks.push(chunk)
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    const params = new URLSearchParams({ sessionId: request.sessionId })
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
      const ref = sessions.get(request.sessionId) ?? (() => {
        const cwd = cwdOf(request.sessionId)
        return cwd === undefined ? undefined : refForPath(cwd)
      })()
      if (ref === undefined) return await original.selectModel!(request)
      const host = hosts.get(ref.hostId)
      lastRemoteHostId = ref.hostId
      if (host === undefined) return await original.selectModel!(request)
      sessions.set(request.sessionId, ref)
      flush()
      // 失败就如实抛回界面：本地没有 agent，退回本地只会再撞一次 already exists。
      return await callRemote(host, 'session/selectModel', { request })
    }
  }

  /** 拉一次单个会话的新事件。 */
  const pullOne = async (sessionId: string, ref: RemoteWorkspaceRef): Promise<void> => {
    const host = hosts.get(ref.hostId)
    if (host === undefined) return
    const store = (typeof ctx.get === 'function' ? ctx.get('sessions') : undefined) as SessionStoreLike | undefined
    if (store === undefined) return
    const result = await mirrorRemoteSession(host, sessionId, ref.path, store as never, cursors, persistenceOf())
    // 镜像会话不落盘（真相在远端），所以这里只记日志、不回退游标。
    if (result.appendedEvents.length > 0) {
      warn(`dsh-remote-access: 镜像 ${sessionId} 追加 ${result.appended} 条，游标 ${result.cursor}`)
    }
    flush()
    const open = turnOpen(sessionId)
    if (runningState.get(sessionId) !== open) {
      runningState.set(sessionId, open)
      try { (ctx as { emit?: (name: string, id: string, running: boolean) => void }).emit?.('api-session/status', sessionId, open) } catch { /* 事件发不出去不影响镜像 */ }
    }
  }

  const pullAll = async (): Promise<void> => {
    for (const [sessionId, ref] of sessions) {
      try {
        await pullOne(sessionId, ref)
      } catch (error) {
        const message = String((error as Error)?.message ?? error)
        // 远端已经没有这个会话（被删/换机）：从登记表摘掉，否则每 800ms 重试一次，日志刷屏。
        if (message.includes('not found')) {
          sessions.delete(sessionId)
          cursors.delete(sessionId)
          flush()
          continue
        }
        // 单台主机掉线不该拖垮其它会话的镜像。
        warn(`dsh-remote-access: 镜像 ${sessionId} 失败：${message}`)
      }
    }
  }

  const timer = setInterval(() => { void pullAll() }, pollIntervalMs)
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) (timer as { unref: () => void }).unref()

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
          sessions.set(share.sessionId, ref)
          void pullOne(share.sessionId, ref).catch(() => undefined)
        }
        flush()
      },
      onSessionEvents(sessionId) {
        const ref = sessions.get(sessionId)
        if (ref === undefined) return
        void pullOne(sessionId, ref).catch(() => undefined)
      },
      onShareChange(kind, sessionId) {
        if (kind === 'removed') { sessions.delete(sessionId); flush(); return }
        const ref = sessions.get(sessionId)
        if (ref !== undefined) void pullOne(sessionId, ref).catch(() => undefined)
      },
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
          const cwd = cwdOf(sessionId)
          ref = sessions.get(sessionId) ?? (cwd === undefined ? undefined : refForPath(cwd))
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
        const host = ref !== undefined
          ? hosts.get(ref.hostId)
          : (lastRemoteHostId === undefined ? undefined : hosts.get(lastRemoteHostId))
        if (host === undefined) return undefined
        if (sessionId !== undefined && ref !== undefined) {
          sessions.set(sessionId, ref)
          flush()
        }
        lastRemoteHostId = host.hostId
        return await callRemote(host, `${namespace}/${method}`, forwardedArgs)
      },
    pullAll,
    /** 每台主机的 SSE 连接状态（B 端徽标用）。 */
    streamState: (hostId: string) => streamStates.get(hostId) ?? 'disconnected',
    /** 立刻重连某台主机（发消息前发现断线时用）。 */
    reconnect: (hostId: string) => { streamClients.get(hostId)?.reconnectNow() },
    pullOne,
    async executeCommand(sessionId, line) {
      const cwd = cwdOf(sessionId)
      const ref = sessions.get(sessionId) ?? (cwd === undefined ? undefined : refForPath(cwd))
      const host = ref === undefined ? undefined : hosts.get(ref.hostId)
      if (ref === undefined || host === undefined) return undefined
      sessions.set(sessionId, ref)
      lastRemoteHostId = ref.hostId
      flush()
      try {
        return await callRemote(host, 'commands/execute', { agentId: sessionId, line, submittedAttachments: [] })
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
