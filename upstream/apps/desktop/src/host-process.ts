/** Electron Node-mode child lifecycle for the shared Web application. */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { z } from 'zod'
import type { PlatformSession } from '@deepseek-ai/dsh-deepseek-account'
import { desktopNodeEnvironment } from './node-environment.ts'
import { parsePluginOperationRecord, type PluginOperationRecord, type PluginOperationRunId } from '@deepseek-ai/dsh-plugin-manager/diagnostic'

interface ReadyEvent {
  readonly type: 'ready'
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

interface FatalEvent {
  readonly type: 'fatal'
  readonly message: string
  /** The Host's complete inspected error: stack, enumerable properties, cause chain. */
  readonly diagnostic?: string
}

interface PlatformSessionEvent {
  readonly type: 'platform-session'
  readonly session: PlatformSession | null
}

type DesktopHostEvent = ReadyEvent | FatalEvent | PlatformSessionEvent | {
  readonly type: 'starting'
  readonly runId: PluginOperationRunId
} | { readonly type: 'shutdown-complete' } | {
  readonly type: 'file-drag-resource'
  readonly requestId: number
  readonly resource: { readonly path: string; readonly sha256: string; readonly size: number } | null
  readonly error?: string
} | {
  readonly type: 'update-tasks'
  readonly requestId: number
  readonly active: boolean
  readonly error?: string
} | {
  readonly type: 'quit-inspection'
  readonly requestId: number
  readonly activeTasks: boolean
  readonly scheduledTasks: boolean
  readonly error?: string
}
| {
  readonly type: 'plus-shell-rpc'
  readonly requestId: number
  readonly method: string
  readonly params?: Record<string, unknown>
}
| PlusShellNotifyEvent
| PlusReloadResultEvent

/** One-way host-plugin → shell notice: notification payload or busy heartbeat. */

/**
 * Reply to the shell's `plus-reload` request: the Host re-collected its boot
 * facts (fresh plugin roster and revisions) after a plugin-manager change or an
 * artifact update. Carries an `error` instead when the collection failed, so the
 * shell can warn instead of reloading into a broken boot.
 */
export interface PlusReloadResultEvent {
  readonly type: 'plus-reload-result'
  readonly url?: string
  readonly injections?: readonly unknown[]
  readonly error?: string
}
export interface PlusShellNotifyEvent {
  readonly type: 'plus-shell-notify'
  readonly notice: {
    readonly type: string
    readonly body?: string
    readonly profile?: string
    readonly busy?: boolean
  }
}

/** Correlated answer to one shell control request. */
type DesktopHostControlResponse = Exclude<Extract<DesktopHostEvent, { readonly requestId: number }>, { readonly type: 'plus-shell-rpc' }>

/** 宿主插件发起、壳注册表派发的 RPC（main 在注册表就绪后设置）。 */
let plusShellRpcHandler: ((method: string, params: unknown) => Promise<{ value?: unknown, error?: unknown }>) | undefined

/** 设置宿主→壳的 RPC 处理函数（main 只有一次注册表）。 */
export function setPlusShellRpcHandler(handler: typeof plusShellRpcHandler): void {
  plusShellRpcHandler = handler
}

/** 宿主插件单向通知/忙心跳的接收端（main 只设一次，对所有宿主子进程生效）。 */
let plusShellNotifyHandler: ((notice: PlusShellNotifyEvent['notice']) => void) | undefined

/** 设置宿主→壳的单向通知处理函数；处理异常不得反压宿主。 */
export function setPlusShellNotifyHandler(handler: typeof plusShellNotifyHandler): void {
  plusShellNotifyHandler = handler
}

/** What quitting now would affect, as reported by the Host. */
export interface DesktopQuitInspection {
  readonly activeTasks: boolean
  readonly scheduledTasks: boolean
}

/** Quit inspection deadline; a slower Host counts as unknown work and the shell asks before quitting. */
export const QUIT_INSPECTION_DEADLINE_MS = 2_000

const MAX_HOST_DIAGNOSTIC_CHARS = 64 * 1024
const runIdSchema = z.uuid()

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  switch (candidate.type) {
    case 'starting':
      return runIdSchema.safeParse(candidate.runId).success
    case 'shutdown-complete':
      return true
    case 'plus-shell-rpc':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.method === 'string'
    case 'ready':
      return typeof candidate.url === 'string'
    case 'plus-reload-result':
      return typeof candidate.error === 'string' || typeof candidate.url === 'string'
    case 'platform-session': {
      const session = candidate.session
      if (session === null) return true
      if (typeof session !== 'object' || !('origin' in session) || !('token' in session)
        || typeof session.origin !== 'string' || typeof session.token !== 'string' || session.token.length === 0) return false
      if (!('userId' in session) || (session.userId !== null
        && (typeof session.userId !== 'string' || session.userId.length === 0))) return false
      if ('embeddedPageDist' in session && typeof session.embeddedPageDist !== 'string') return false
      if ('requestHeaders' in session && (typeof session.requestHeaders !== 'object' || session.requestHeaders === null
        || Array.isArray(session.requestHeaders)
        || Object.entries(session.requestHeaders).some(([name, value]) => typeof value !== 'string'
          || name !== name.toLowerCase() || /[\r\n]/.test(value)
          || ['authorization', 'x-dsh-auth-token', 'host', 'content-length', 'transfer-encoding', 'connection', 'content-type'].includes(name)))) return false
      try {
        const url = new URL(session.origin)
        return url.origin === session.origin && !url.username && !url.password
          && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      } catch { return false }
    }
    case 'fatal':
      return typeof candidate.message === 'string' && (candidate.diagnostic === undefined || typeof candidate.diagnostic === 'string')
    case 'update-tasks':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.active === 'boolean'
        && (candidate.error === undefined || typeof candidate.error === 'string')
    case 'file-drag-resource': {
      const resource = candidate.resource
      return Number.isSafeInteger(candidate.requestId) && (candidate.error === undefined || typeof candidate.error === 'string')
        && (resource === null || (typeof resource === 'object' && 'path' in resource && typeof resource.path === 'string'
          && 'sha256' in resource && typeof resource.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(resource.sha256)
          && 'size' in resource && typeof resource.size === 'number' && Number.isSafeInteger(resource.size) && resource.size >= 0))
    }
    case 'quit-inspection':
      return Number.isSafeInteger(candidate.requestId) && typeof candidate.activeTasks === 'boolean'
        && typeof candidate.scheduledTasks === 'boolean' && (candidate.error === undefined || typeof candidate.error === 'string')
    case 'plus-shell-rpc':
    case 'plus-shell-notify': {
      const notice = candidate.notice
      if (typeof notice !== 'object' || notice === null) return false
      const n = notice as Record<string, unknown>
      return typeof n.type === 'string' && n.type !== ''
        && (n.body === undefined || typeof n.body === 'string')
        && (n.profile === undefined || typeof n.profile === 'string')
        && (n.busy === undefined || typeof n.busy === 'boolean')
    }
    default:
      return false
  }
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([exit.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Browser authentication URL reported by the running Web application. */
export interface DesktopHostReady {
  readonly url: string
  readonly injections?: readonly unknown[] | undefined
}

/** The child has exited, but task teardown did not finish successfully. */
export class DesktopHostUncleanExitError extends Error {}

/**
 * A Host failure reported over IPC before the process exited. `message` is what
 * the Host chose to show; `diagnostic` is its complete inspected error, kept
 * separately so a crash report can print it verbatim instead of a string escaped
 * inside another error's properties.
 */
export class DesktopHostFatalError extends Error {
  readonly #diagnostic: string | undefined

  /**
   * @param message - The Host's failure message.
   * @param diagnostic - The Host's inspected error, when the Host supplied one.
   */
  constructor(message: string, diagnostic: string | undefined) {
    super(message)
    this.#diagnostic = diagnostic
  }

  /** The Host's inspected error; a getter so `util.inspect` of this error does not repeat it as an escaped property. */
  get diagnostic(): string | undefined { return this.#diagnostic }
}

/** One Web backend running under the Electron executable in Node mode. */
export class DesktopHostProcess {
  private runId: PluginOperationRunId | undefined
  private child: ChildProcess | undefined
  private readyResolve!: (ready: DesktopHostReady) => void
  private readyReject!: (error: Error) => void
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private failureReported = false
  private stopping = false
  private shutdownCompleted = false
  // plus：右键「重载插件」的等待者；同一时刻只有一个入口，先到先得。
  private readonly plusReloadWaiters: Array<{ resolve: (ready: DesktopHostReady) => void; reject: (error: Error) => void }> = []
  private nextControlId = 1
  private readonly controlRequests = new Map<number, {
    resolve: (response: DesktopHostControlResponse) => void
    reject: (error: Error) => void
  }>()

  /**
   * @param node - Absolute Electron executable in Node mode.
   * @param runtimeDir - Immutable packages carried by the current application.
   * @param projectDir - Desktop plugin profile and child working directory.
   * @param inspectPort - Optional loopback inspector port for workspace development.
   * @param environment - Environment inherited by the Host and its plugin subprocesses.
   * @param onFailure - Receives the first unexpected child failure, including after readiness.
   * @param primaryRuntime - Optional bundled dependency payload; when supplied, missing sibling
   *   `office-skills` resources fail Host startup.
   * @param packageManager - Bundled pnpm entry and Node launcher directory, scoped to package operations.
   * @param onPlatformSession - Private credential updates for embedded Platform views.
   * @param onPluginOperation - Optional diagnostic sink; malformed records are ignored without failing the Host.
   */
  constructor(
    private readonly node: string,
    private readonly runtimeDir: string,
    private readonly projectDir: string,
    private readonly inspectPort?: number,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly onFailure?: (error: Error) => void,
    private readonly primaryRuntime?: string,
    private readonly packageManager?: { readonly pnpm: string; readonly nodeBin: string },

    private readonly onPlatformSession?: (session: PlatformSession | null) => void,
    private readonly onPluginOperation?: (record: PluginOperationRecord) => void,
    private readonly onHostOutput?: (line: string) => void,
  ) {}

  /**
   * Ask the running Host to re-collect its boot facts and await the fresh set.
   * The plus reload entry calls this before reloading a page, so the document
   * boots from the current plugin roster instead of the frozen startup one.
   * @returns The fresh URL and boot injections.
   */
  async refreshReady(): Promise<DesktopHostReady> {
    const child = this.child
    if (child === undefined || !child.connected || this.failureReported || this.stopping) {
      throw new Error('plus reload: Host is unavailable')
    }
    const request = new Promise<DesktopHostReady>((resolve, reject) => {
      this.plusReloadWaiters.push({ resolve, reject })
      child.send({ type: 'plus-reload' }, (error) => {
        if (error === null) return
        const index = this.plusReloadWaiters.findIndex(waiter => waiter.reject === reject)
        if (index >= 0) this.plusReloadWaiters.splice(index, 1)
        reject(error)
      })
    })
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => { reject(new Error('plus reload: Host did not answer in time')) }, 8_000)
    })
    return Promise.race([request, timeout]).finally(() => {
      // 超时或成功后都把等待者清掉：resolve 过的 reject 是 no-op，重复应答不会误配。
      const index = this.plusReloadWaiters.findIndex(waiter => waiter.reject !== undefined && waiter.resolve === undefined)
      if (index >= 0) this.plusReloadWaiters.splice(index, 1)
    })
  }
  /**
   * Start this child once and await its Web application URL.
   * @returns Ready facts supplied by the child after application startup.
   */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const entry = join(this.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
    const child = spawn(this.node, [
      '--expose-internals',
      ...(this.inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      entry,
      this.runtimeDir,
      this.projectDir,
      this.primaryRuntime ?? join(this.runtimeDir, '..', 'runtime', 'primary-runtime'),
      ...this.packageManager === undefined ? [] : [this.packageManager.pnpm, this.packageManager.nodeBin],
    ], {
      cwd: this.projectDir,
      env: desktopNodeEnvironment(this.node, undefined, this.environment),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr = (this.stderr + chunk).slice(-MAX_HOST_DIAGNOSTIC_CHARS) })
    child.stdout?.pipe(process.stdout)
    child.stdout?.setEncoding('utf8')
    let carry = ''
    child.stdout?.on('data', (chunk: string) => {
      carry += chunk
      let index: number
      while ((index = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, index).trimEnd()
        carry = carry.slice(index + 1)
        if (line.trim() !== '') this.onHostOutput?.(line)
      }
    })
    child.on('message', (message: unknown) => {
      if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'plugin-operation') {
        const record = 'record' in message ? parsePluginOperationRecord(message.record) : undefined
        if (record !== undefined && record.runId === this.runId) {
          try { this.onPluginOperation?.(record) }
          catch (_error) {
            // Diagnostic persistence cannot invalidate the Host's business IPC channel.
            console.error('desktop plugin operation diagnostic sink failed')
          }
        }
        return
      }
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('dsh desktop host sent an invalid IPC event'))
        child.kill('SIGTERM')
        return
      }
      if (message.type === 'starting') this.runId = message.runId
      else if (message.type === 'ready') this.readyResolve({ url: message.url, injections: message.injections })
      else if (message.type === 'platform-session') this.onPlatformSession?.(message.session)
      else if (message.type === 'shutdown-complete') {
        if (this.stopping) this.shutdownCompleted = true
        else this.fail(new Error('dsh desktop host acknowledged an unrequested shutdown'))
      }
      else if (message.type === 'fatal') this.fail(new DesktopHostFatalError(message.message, message.diagnostic))
      else if (message.type === 'plus-shell-rpc') {
        // 宿主里的插件（client 的 host 半区）发起：壳侧按注册表派发后原样回包。
        void (async () => {
          const result = plusShellRpcHandler === undefined
            ? { error: 'shell rpc handler unavailable' }
            : await plusShellRpcHandler(message.method, message.params)
          if (child.connected) child.send({ type: 'plus-shell-rpc-result', requestId: message.requestId, ...result })
        })()
      }
      else if (message.type === 'plus-shell-notify') {
        // 宿主插件单向事件（通知/忙心跳）：尽力而为，处理失败不反压宿主。
        try { plusShellNotifyHandler?.(message.notice) } catch { /* 通知不是关键路径 */ }
      }
      else if (message.type === 'plus-reload-result') {
        // plus：右键「重载插件」的编排回执；resolve/reject 由 refreshReady 的等待者消费。
        const pending = this.plusReloadWaiters.pop()
        if (pending === undefined) return
        if (message.error !== undefined) pending.reject(new Error(message.error))
        else if (message.url !== undefined) pending.resolve({ url: message.url, injections: message.injections })
        else pending.reject(new Error('plus reload: Host returned no boot facts'))
      }
      else {
        const request = this.controlRequests.get(message.requestId)
        if (message.error === undefined) request?.resolve(message)
        else request?.reject(new Error(message.error))
      }
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('close', (code) => {
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`dsh desktop host exited with ${String(code)}${suffix}`))
        else this.fail(new Error(`dsh desktop host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /**
   * Inspect active work or lock request admission for update handoff.
   * @param action - Read-only inspection, admission lock, or recovery unlock.
   * @returns Whether live tasks would be affected. Locking drains admitted API requests before inspecting tasks;
   * an unanswered drain fails at the control-request deadline without authorizing installation.
   */
  async updateTasks(action: 'inspect' | 'lock' | 'unlock'): Promise<boolean> {
    const response = await this.control({ type: 'update-tasks', action }, 10_000, 'desktop update: task inspection timed out', 'desktop update')
    if (response.type !== 'update-tasks') throw new Error('desktop update: Host answered with a different control response')
    return response.active
  }

  /**
   * Ask the Host what quitting now would interrupt.
   * @returns Active tasks and armed scheduled reminders; rejects when the Host is unavailable or misses
   * {@link QUIT_INSPECTION_DEADLINE_MS}, and the shell then asks before quitting.
   */
  async inspectQuit(): Promise<DesktopQuitInspection> {
    const response = await this.control({ type: 'quit-inspection' }, QUIT_INSPECTION_DEADLINE_MS, 'desktop quit: inspection timed out', 'desktop quit')
    if (response.type !== 'quit-inspection') throw new Error('desktop quit: Host answered with a different control response')
    return { activeTasks: response.activeTasks, scheduledTasks: response.scheduledTasks }
  }

  /**
   * @param address - Session-scoped file reference.
   * @param signal - preparation cancellation.
   * @returns privately authorized local resource, or null when nonlocal.
   */
  async resolveDragResource(address: string, signal?: AbortSignal): Promise<
    { readonly path: string; readonly sha256: string; readonly size: number } | null
  > {
    const response = await this.control({ type: 'file-drag-resource', address }, 12_000, 'File drag authorization timed out', 'file drag', signal)
    if (response.type !== 'file-drag-resource') throw new Error('Host returned a different control response')
    return response.resource
  }

  private async control(
    request: { readonly type: 'update-tasks'; readonly action: 'inspect' | 'lock' | 'unlock' } | { readonly type: 'quit-inspection' }
      | { readonly type: 'file-drag-resource'; readonly address: string },
    deadlineMs: number, deadlineMessage: string, operation: string, signal?: AbortSignal,
  ): Promise<DesktopHostControlResponse> {
    const child = this.child
    if (child === undefined || !child.connected || this.failureReported || this.stopping) {
      throw new Error(`${operation}: Host is unavailable`)
    }
    signal?.throwIfAborted()
    const requestId = this.nextControlId++
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = (): void => {
      if (request.type === 'file-drag-resource' && child.connected) child.send({ type: 'file-drag-cancel', requestId }, (_error) => {
        // The request still rejects locally if the Host has disconnected.
      })
      const reason: unknown = signal?.reason
      this.controlRequests.get(requestId)?.reject(reason instanceof Error ? reason : new Error(deadlineMessage))
    }
    try {
      return await new Promise<DesktopHostControlResponse>((resolve, reject) => {
        this.controlRequests.set(requestId, { resolve, reject })
        timer = setTimeout(abort, deadlineMs)
        signal?.addEventListener('abort', abort, { once: true })
        child.send({ ...request, requestId }, (error) => { if (error !== null) reject(error) })
      })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      this.controlRequests.delete(requestId)
    }
  }

  /**
   * Request teardown and await child exit, escalating termination when needed.
   * @param requireGraceful - Reject update handoff after forced termination or unsuccessful child exit.
   * @returns Completion of owned process teardown. DesktopHostUncleanExitError confirms exit but refuses installation;
   * other failures do not confirm exit.
   */
  async stop(requireGraceful = false): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.stopping = true
    this.onPlatformSession?.(null)
    if (child.connected) child.send({ type: 'shutdown' }, (error) => { if (error !== null) this.fail(error) })
    const exited = this.exitPromise ?? Promise.resolve()
    const graceful = await exitsWithin(exited, 10_000)
    if (!graceful) child.kill('SIGTERM')
    if (!await exitsWithin(exited, 5_000)) {
      child.kill('SIGKILL')
      if (!await exitsWithin(exited, 5_000)) {
        throw new Error('dsh desktop host did not exit after SIGKILL')
      }
    }
    this.child = undefined
    if (requireGraceful && (!graceful || child.exitCode !== 0 || !this.shutdownCompleted)) {
      // This diagnostic reaches expandable UI; arbitrary plugin stderr can contain credentials.
      throw new DesktopHostUncleanExitError(`desktop update: Host did not complete graceful task teardown (exit ${String(child.exitCode)}, signal ${String(child.signalCode)}, shutdown acknowledged ${String(this.shutdownCompleted)}, graceful deadline exceeded ${String(!graceful)})`)
    }
  }

  private fail(error: Error): void {
    if (this.runId !== undefined) Object.assign(error, { hostRunId: this.runId })
    this.onPlatformSession?.(null)
    this.readyReject(error)
    for (const request of this.controlRequests.values()) request.reject(error)
    this.controlRequests.clear()
    if (!this.failureReported && !this.stopping) {
      this.failureReported = true
      try { this.onFailure?.(error) } catch (listenerError) {
        console.error('desktop host failure listener failed', listenerError)
      }
    }
  }
}
