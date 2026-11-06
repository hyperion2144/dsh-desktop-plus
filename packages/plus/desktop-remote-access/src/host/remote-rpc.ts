//! 远端 Typert Remote 一元调用：把「另一台已配对主机上的 dsh 服务」当成一个可调用的 API。
//!
//! 官方 Web 客户端对 Host 的一元调用是 HTTP POST：路由 `/api/<namespace>/<method>`，
//! 请求体 `{ type: 'client-request', rpcId, method, payload: { args } }`，响应体
//! `{ type: 'server-response', rpcId, result: { ok: true, value } | { ok: false, error } }`。
//! 参数按 descriptor 命名，所以业务参数要包在 `args.request` 里（无参方法用 `args` 空对象）。
//!
//! 这里只实现一元调用：流式端点（`/api/remote.mux`）走 WebSocket，本插件用轮询
//! `session/page` 代替，避免在宿主里再实现一套 mux 协议。
import { randomUUID } from 'node:crypto'
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'

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
 * @returns 远端返回的 `value`。
 * @throws RemoteRpcError 远端拒绝或响应不合形。
 */
export async function callRemote(host: RemoteHostRecord, endpoint: string, args: Record<string, unknown>): Promise<unknown> {
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
/** 远端会话日志里的一条记录。 */
export interface RemoteSessionRecord {
  /** `event` 或 `chunkrow`。 */
  type: string
  /** 事件本体（`type === 'event'` 时）。 */
  event?: { type?: string, seq?: number, time?: number, data?: unknown }
}

/** 一页远端会话日志。 */
export interface RemoteSessionPage {
  /** 这一页的包含式游标。 */
  cursor: number
  /** 记录。 */
  records: RemoteSessionRecord[]
}

/**
 * 读远端会话的一页日志。
 * @param host 已配对主机记录。
 * @param sessionId 远端会话 id。
 * @param throughSeq 包含式截止 seq；省略表示读到当前日志末尾。
 * @returns 一页记录与游标。
 */
export async function pageRemoteSession(
  host: RemoteHostRecord,
  sessionId: string,
  throughSeq?: number,
): Promise<RemoteSessionPage> {
  const request: Record<string, unknown> = { address: { kind: 'session', sessionId } }
  if (throughSeq !== undefined) request.throughSeq = throughSeq
  const value = await callRemote(host, 'session/page', { request }) as Partial<RemoteSessionPage>
  return {
    cursor: typeof value?.cursor === 'number' ? value.cursor : 0,
    records: Array.isArray(value?.records) ? value.records : [],
  }
}
