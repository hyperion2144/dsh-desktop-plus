import { appendFileSync } from 'node:fs'
//!
//! 方向固定为 B 发起：A 是服务端，B 在 NAT 后面只有 B 能连过去。连上后 A 先发
//! `ready`（当前分享给我的会话），之后只推增量；断线由 B 立刻重连（指数退避），
//! 重连时 A 从游标之后补齐。心跳 15 秒一次，45 秒收不到任何数据就判定假活、主动重连。
import type { RemoteHostRecord } from './remote-hosts.js'

/** 连接状态（B 端徽标用）。 */
export type RemoteStreamState = 'connecting' | 'connected' | 'disconnected'

/** 一条分享登记（A 下发）。 */
export interface RemoteShareNotice {
  /** 被分享的会话。 */
  sessionId: string
  /** 会话在 A 上的工作目录。 */
  path: string
  /** 分享建立时间。 */
  sharedAt: number
}

/** 订阅回调。 */
export interface RemoteStreamHandlers {
  /** 连上并收到 ready：当前分享给我的会话清单。 */
  onReady: (shares: RemoteShareNotice[]) => void
  /** 某个会话的新事件。 */
  onSessionEvents: (sessionId: string, events: unknown[]) => void
  /** 分享新增/撤销。 */
  onShareChange: (kind: 'added' | 'removed', sessionId: string) => void
  /** 连接状态变化。 */
  onState: (state: RemoteStreamState) => void
}

/** 订阅器。 */
export interface RemoteStreamClient {
  /** 当前状态。 */
  readonly state: RemoteStreamState
  /** 开始订阅（幂等）。 */
  start: () => void
  /** 停止订阅并断开。 */
  stop: () => void
  /** 立刻重连一次（发消息前发现断线时用）。 */
  reconnectNow: () => void
}

/** 心跳超时：超过这个时间没收到任何数据就判定假活。 */
const IDLE_TIMEOUT_MS = 45000
/** 重连退避上限。 */
const MAX_BACKOFF_MS = 30000

/**
 * 创建一条到 A 的 SSE 订阅。
 * @param host 已配对主机（带 cookie）。
 * @param handlers 回调。
 * @returns 订阅器。
 */
export function createRemoteStreamClient(host: RemoteHostRecord, handlers: RemoteStreamHandlers): RemoteStreamClient {
  let state: RemoteStreamState = 'disconnected'
  let stopped = true
  let controller: AbortController | null = null
  let backoff = 1000
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const setState = (next: RemoteStreamState): void => {
    if (state === next) return
    state = next
    handlers.onState(next)
  }

  const clearTimers = (): void => {
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null }
  }

  const scheduleReconnect = (): void => {
    if (stopped) return
    setState('disconnected')
    if (retryTimer !== null) return
    const delay = backoff
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    retryTimer = setTimeout(() => { retryTimer = null; void connect() }, delay)
    if (typeof retryTimer.unref === 'function') retryTimer.unref()
  }

  const touchIdle = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      // 假活：连接看着还在但收不到任何东西，主动断开重连。
      try { controller?.abort() } catch { /* 已断开 */ }
    }, IDLE_TIMEOUT_MS)
    if (typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  const handleEvent = (event: string, data: string): void => {
    let parsed: unknown
    try { parsed = JSON.parse(data) } catch { return }
    if (event === 'ready') {
      const shares = (parsed as { shares?: RemoteShareNotice[] }).shares
      handlers.onReady(Array.isArray(shares) ? shares : [])
      return
    }
    if (event === 'session/events') {
      const payload = parsed as { sessionId?: unknown, events?: unknown }
      if (typeof payload.sessionId !== 'string' || !Array.isArray(payload.events)) return
      handlers.onSessionEvents(payload.sessionId, payload.events)
      return
    }
    if (event === 'share/added' || event === 'share/removed') {
      const payload = parsed as { sessionId?: unknown }
      if (typeof payload.sessionId !== 'string') return
      handlers.onShareChange(event === 'share/added' ? 'added' : 'removed', payload.sessionId)
    }
  }

  const connect = async (): Promise<void> => {
    if (stopped) return
    clearTimers()
    setState('connecting')
    controller = new AbortController()
    try {
      const response = await fetch(`${host.origin}/__dsh-mobile/api/remote/stream`, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          cookie: `dsh_mobile_session=${host.cookie}`,
        },
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) throw new Error(`stream HTTP ${String(response.status)}`)
      try { appendFileSync('/tmp/sse-debug.log', `connected ${host.origin}\n`) } catch { /* 调试用 */ }
      setState('connected')
      backoff = 1000
      touchIdle()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        touchIdle()
        buffer += decoder.decode(value, { stream: true })
        // SSE 以空行分隔事件；注释行（: ping）只用来刷新空闲计时。
        let index = buffer.indexOf('\n\n')
        while (index >= 0) {
          const chunk = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          let event = 'message'
          const dataLines: string[] = []
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (dataLines.length > 0) handleEvent(event, dataLines.join('\n'))
          index = buffer.indexOf('\n\n')
        }
      }
      // 服务端正常关闭：当作断线，重连。
      scheduleReconnect()
    } catch (error) {
      try { appendFileSync('/tmp/sse-debug.log', `connect-error ${String((error as Error)?.message ?? error)}\n`) } catch { /* 调试用 */ }
      scheduleReconnect()
    }
  }

  return {
    get state() { return state },
    start() {
      if (!stopped) return
      stopped = false
      void connect()
    },
    stop() {
      stopped = true
      clearTimers()
      try { controller?.abort() } catch { /* 已断开 */ }
      controller = null
      setState('disconnected')
    },
    reconnectNow() {
      if (stopped) return
      clearTimers()
      try { controller?.abort() } catch { /* 已断开 */ }
      backoff = 1000
      void connect()
    },
  }
}
