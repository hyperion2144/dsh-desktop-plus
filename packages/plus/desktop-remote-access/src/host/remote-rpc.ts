//! 远端 Typert Remote 一元调用：把「另一台已配对主机上的 dsh 服务」当成一个可调用的 API。
//!
//! 官方 Web 客户端对 Host 的一元调用是 HTTP POST：路由 `/api/<namespace>/<method>`，
//! 请求体 `{ type: 'client-request', rpcId, method, payload: { args } }`，响应体
//! `{ type: 'server-response', rpcId, result: { ok: true, value } | { ok: false, error } }`。
//! 参数按 descriptor 命名，所以业务参数要包在 `args.request` 里（无参方法用 `args` 空对象）。
//!
//! 这里只实现一元调用：流式端点（`/api/remote.mux`）走 WebSocket，本插件不在这里实现 mux 协议。
//! 会话事件的分页拉取不走官方 RPC，走 lane 自己的数据面路由（见 remote-sessions.ts 的 fetchRemoteEventPage）。
import { randomUUID } from 'node:crypto'
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'
import { REMOTE_WRITES_ENABLED, decideRemoteInvoke, remoteReadonlyRefusal } from './remote-policy.js'
import { LANE_PREFIX } from './lane-routes.js'
import type { InteractionAnswer } from './interaction-relay.js'

/** 远端返回的业务错误。 */
export class RemoteRpcError extends Error {
  /** 远端错误码（`gateway/*`、`session/*` 等）。 */
  readonly code: string
  /** 远端附带的细节。 */
  readonly details: unknown

  /**
   * @param code 远端错误码。
   * @param message 远端错误消息。
   * @param details 远端细节。
   */
  constructor(code: string, message: string, details: unknown) {
    super(message)
    this.name = 'RemoteRpcError'
    this.code = code
    this.details = details
  }
}

/** 一次一元调用的响应信封。 */
interface ServerResponse {
  type?: unknown
  rpcId?: unknown
  result?: {
    ok?: unknown
    value?: unknown
    error?: { code?: unknown, message?: unknown, details?: unknown }
  }
}

/**
 * 调一次远端一元方法。
 * @param host 已配对主机记录（带设备会话 cookie）。
 * @param endpoint `<namespace>/<method>`，例如 `session/create`。
 * @param args descriptor 命名的参数对象；业务参数放 `request` 键。
 * @param writesEnabled 是否放行写类调用；缺省取 `REMOTE_WRITES_ENABLED`（交互代理 #151 落地后已打开）。
 * @returns 远端返回的 `value`。
 * @throws RemoteRpcError 远端拒绝、响应不合形，或写类调用被只读镜像模式的闸门拦下。
 */
export async function callRemote(host: RemoteHostRecord, endpoint: string, args: Record<string, unknown>, writesEnabled: boolean = REMOTE_WRITES_ENABLED): Promise<unknown> {
  // 只读镜像模式的闸门：所有「以官方 RPC 形式调用 A」的调用都从这里出去，在这一处拦下写类调用，
  // 上层各调用方就不必各自判断——漏一处就会把写操作打到 A 上。
  const slash = endpoint.indexOf('/')
  if (decideRemoteInvoke(endpoint.slice(0, slash), endpoint.slice(slash + 1), writesEnabled) === 'refuse') {
    throw new RemoteRpcError('remote-readonly', remoteReadonlyRefusal(endpoint), { endpoint })
  }
  const rpcId = randomUUID()
  const response = await fetchFromHost(host, `/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
  })
  if (!response.ok) throw new RemoteRpcError('transport', `${endpoint} 失败：HTTP ${response.status}`, { status: response.status })
  const envelope = (await response.json()) as ServerResponse
  if (envelope.rpcId !== rpcId) throw new RemoteRpcError('transport', `${endpoint} 的 rpcId 不匹配`, {})
  const result = envelope.result
  if (result === undefined) throw new RemoteRpcError('transport', `${endpoint} 的响应缺少 result`, {})
  if (result.ok !== true) {
    const code = typeof result.error?.code === 'string' ? result.error.code : 'remote-error'
    const message = typeof result.error?.message === 'string' ? result.error.message : `${endpoint} 被远端拒绝`
    throw new RemoteRpcError(code, message, result.error?.details)
  }
  return result.value
}

/** 远端 Workspace 投影里本插件用到的字段。 */
export interface RemoteWorkspaceValue {
  /** 远端 Workspace 身份。 */
  workspaceId: string
  /** 远端绝对路径。 */
  path: string
  /** 远端标题。 */
  title: string
}

/**
 * 在远端登记一个工作区（已存在则复用）。
 * @param host 已配对主机记录。
 * @param path 远端绝对路径。
 * @returns 远端 Workspace 投影。
 */
export async function createRemoteWorkspace(host: RemoteHostRecord, path: string): Promise<RemoteWorkspaceValue> {
  const value = await callRemote(host, 'workspace/create', { request: { path } }) as { workspace?: Partial<RemoteWorkspaceValue> }
  const workspace = value?.workspace
  if (workspace === undefined || typeof workspace.workspaceId !== 'string') {
    throw new RemoteRpcError('bad-response', 'workspace/create 没有返回 workspace', {})
  }
  return {
    workspaceId: workspace.workspaceId,
    path: typeof workspace.path === 'string' ? workspace.path : path,
    title: typeof workspace.title === 'string' ? workspace.title : path,
  }
}

/**
 * 在远端建一个会话。
 * @param host 已配对主机记录。
 * @param request 远端 Workspace 身份或目录。
 * @returns 远端会话 id。
 */
export async function createRemoteSession(
  host: RemoteHostRecord,
  request: { workspaceId?: string, cwd?: string },
): Promise<string> {
  const value = await callRemote(host, 'session/create', { request }) as { sessionId?: unknown }
  if (typeof value?.sessionId !== 'string' || value.sessionId === '') {
    throw new RemoteRpcError('bad-response', 'session/create 没有返回 sessionId', {})
  }
  return value.sessionId
}

/**
 * 把一条用户消息投给远端会话。
 * @param host 已配对主机记录。
 * @param sessionId 远端会话 id。
 * @param text 用户输入。
 * @param requestId 客户端铸造的消息身份。
 * @returns 远端是否接受。
 */
export async function promptRemoteSession(
  host: RemoteHostRecord,
  sessionId: string,
  text: string,
  requestId: string,
): Promise<boolean> {
  const value = await callRemote(host, 'session/prompt', {
    request: {
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  }) as { accepted?: unknown }
  return value?.accepted === true
}

/**
 * 取消远端会话当前这一轮。
 * @param host 已配对主机记录。
 * @param sessionId 远端会话 id。
 * @returns 远端是否接受。
 */
export async function cancelRemoteSession(host: RemoteHostRecord, sessionId: string): Promise<boolean> {
  const value = await callRemote(host, 'session/cancel', { request: { sessionId } }) as { accepted?: unknown }
  return value?.accepted === true
}

/**
 * 调一次 A 侧数据面（lane 自有路由）。
 * @param host 已配对主机记录（带设备会话 cookie）。
 * @param path lane 相对路径，如 `/api/remote/session.watch`。
 * @param body 请求体。
 * @returns 响应 JSON。
 * @throws RemoteRpcError A 拒绝或网络不通。
 */
async function postLane(host: RemoteHostRecord, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetchFromHost(host, `${LANE_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new RemoteRpcError('transport', `${path} 失败：HTTP ${String(response.status)}`, { status: response.status })
  return await response.json() as Record<string, unknown>
}

/**
 * 向 A 登记本机镜像了它的哪条会话（#151 / #152 的按会话订阅）。
 * 登记后这条会话的事件增量、提问、审批都会沿长连接推给本机；重复登记幂等。
 * @param host 已配对主机记录。
 * @param remoteSessionId A 上的会话 id。
 * @param path 会话在 A 上的工作目录（登记表顺带记下）。
 */
export async function watchRemoteSession(host: RemoteHostRecord, remoteSessionId: string, path = ''): Promise<void> {
  await postLane(host, '/api/remote/session.watch', { sessionId: remoteSessionId, path })
}

/**
 * 退出对某条远端会话的订阅（本机移除镜像时用）。
 * @param host 已配对主机记录。
 * @param remoteSessionId A 上的会话 id。
 */
export async function unwatchRemoteSession(host: RemoteHostRecord, remoteSessionId: string): Promise<void> {
  await postLane(host, '/api/remote/session.unwatch', { sessionId: remoteSessionId })
}

/**
 * 把本机用户给出的提问 / 审批答案交回 A（#151）。
 * @param host 已配对主机记录。
 * @param answer 已校验的回答（带请求号）。
 * @returns A 是否收下：请求号对不上，或 A 那边已经落定（本地界面先答了、超时、取消）时为 false。
 */
export async function answerRemoteInteraction(host: RemoteHostRecord, answer: InteractionAnswer): Promise<boolean> {
  const reply = await postLane(host, '/api/remote/interaction.answer', { ...answer })
  return reply['accepted'] === true
}

/**
 * 向 A 要一个「在浏览器打开它的 DSH」的地址（#150）：A 签一张一次性、短时有效的票据，
 * 兑换页在 A 的 lane 上。本机绝不自己铸造地址——那只会打开本机的界面。
 * @param host 已配对主机记录。
 * @returns 可直接交给系统浏览器打开的地址。
 */
export async function requestRemoteWebuiUrl(host: RemoteHostRecord): Promise<string> {
  const reply = await postLane(host, '/api/remote/webui-ticket', {})
  const url = reply['url']
  if (typeof url !== 'string' || url === '') throw new RemoteRpcError('bad-response', '对方没有返回可打开的地址', {})
  return url
}

/** 设备对一次回推的答复：收下了，或带着原因与出口的拒绝。 */
export interface PushbackReply {
  ok: boolean
  appended?: number
  reason?: string
  message?: string
  exits?: string[]
  partial?: boolean
}

/**
 * 把本地分支的尾部回推到设备上的原会话（#155）。四个前提由设备侧一次查完，结果原样带回。
 * @param host 已配对主机记录。
 * @param request 原会话 id、分叉点、要追加的事件。
 * @returns 设备的答复。
 */
export async function pushRemoteBranch(host: RemoteHostRecord, request: { sessionId: string, afterSeq: number, events: unknown[] }): Promise<PushbackReply> {
  return await postLane(host, '/api/remote/session.push', request) as unknown as PushbackReply
}

/**
 * 用本地分支的全部内容在设备上另起一条新会话（#155 被拒后的出口之一）。
 * @param host 已配对主机记录。
 * @param request 工作目录、事件、标题。
 * @returns 设备上新会话的 id。
 */
export async function forkRemoteBranch(host: RemoteHostRecord, request: { cwd: string, events: unknown[], title?: string }): Promise<string> {
  const reply = await postLane(host, '/api/remote/session.fork', request)
  const sessionId = reply['sessionId']
  if (reply['ok'] !== true || typeof sessionId !== 'string' || sessionId === '') throw new RemoteRpcError('bad-response', '设备没有返回新会话', {})
  return sessionId
}
