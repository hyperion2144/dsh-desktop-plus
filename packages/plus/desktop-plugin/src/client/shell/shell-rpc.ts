// 壳 RPC 客户端统一传输层（plus 适配版）。
//
// plus 壳是官方 Electron 壳的 fork：没有 Electrobun 原生桥。唯一通道是官方插件通道：
// 页面半区经 connection.rpc.call('/api', …) 调 shell.invoke（captureShellChannelCaller 捕获），
// 宿主半区注册 exact 路由 /api/shell.invoke（connection.fetch.register），经宿主 IPC 转 Electron 壳。
// 认证与 wire 格式全走官方 connection 层；命令名与形状由 contracts/ 裁决。
//
// 壳在场判据：官方桌面载体标记 `globalThis.dshDesktop`（protocolVersion 1，官方壳 preload
// 经 contextBridge 注入，plus fork 原样继承）；兜底是「任意一次 RPC 成功」——官方通道可用
// 即证明有壳。纯浏览器直访 dsh 两者皆无 → 桌面 chrome 不激活。
//
// 语义：成功 resolve value；业务失败 reject(new Error(error))；
// 壳不在场（fetch 网络层失败）reject('shell rpc unavailable')。
// 请求级失败不重试（命令可能已在壳侧生效，toggle 类命令二次执行会翻转两次）。
// timeoutMs：客户端超时，超时只放弃回包、不取消壳侧任务（AbortSignal 仅中断本地等待）；
// noTimeout：不挂客户端超时，长任务（运行时下载）靠轮询快照收尾。

/** 壳注入到页面的全局面（可选：纯浏览器里一个都没有）。 */
export interface ShellRpcGlobals {
  /** 官方桌面载体标记：壳 preload 注入，声明「本页面背后有桌面壳」。 */
  dshDesktop?: { readonly protocolVersion?: number }
}

/** 传输依赖（测试注入假 fetch）。 */
export interface ShellRpcDeps {
  fetchImpl: typeof fetch
  setTimeoutImpl: (fn: () => void, ms: number) => unknown
  clearTimeoutImpl: (handle: unknown) => void
  readGlobals: () => ShellRpcGlobals
}

export interface ShellRpcInvokeOptions {
  /** 单请求超时（默认 15s，文件选择/重启类调用可放宽）。 */
  timeoutMs?: number
  /** 不挂客户端超时：长任务靠轮询快照收尾。 */
  noTimeout?: boolean
}

export interface ShellRpcClient {
  invoke<T = unknown>(method: string, params?: Record<string, unknown>, options?: ShellRpcInvokeOptions): Promise<T>
  /** 壳是否在场（面板据此决定激活桌面 chrome 与否）。 */
  available(): boolean
}

const DEFAULT_TIMEOUT_MS = 15_000

export function createShellRpc(deps?: Partial<ShellRpcDeps>): ShellRpcClient {
  const fetchImpl = deps?.fetchImpl ?? ((input, init) => fetch(input, init))
  const setTimeoutImpl = deps?.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimeoutImpl = deps?.clearTimeoutImpl ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  const readGlobals = deps?.readGlobals ?? (() => globalThis as unknown as ShellRpcGlobals)
  /** 一次成功的 RPC 即证明官方通道存在（壳未注入载体标记时的兜底判据）。 */
  let shellProven = false

  return {
    async invoke<T = unknown>(method: string, params?: Record<string, unknown>, options?: ShellRpcInvokeOptions): Promise<T> {
      // 官方插件通道优先：client 半区注入的 connection.rpc.call 包装（captureShellChannelCaller，
      // client 入口 apply 时捕获）——请求走官方 /api 路由到本插件 host 半区的 /api/shell.invoke，
      // 再经宿主 IPC 驱动 Electron 壳；通道未捕获（纯浏览器/复用外部实例）直接不可用。
      const official = (readGlobals() as { shellChannelRpc?: (endpoint: string, payload: unknown) => Promise<unknown> }).shellChannelRpc
      if (typeof official !== 'function') throw new Error('shell rpc unavailable')
      const result = await official('shell.invoke', { method, params: params ?? {} }) as { ok?: unknown, value?: unknown, error?: unknown }
      if (typeof result === 'object' && result !== null && result.ok === false) {
        const error = result.error
        throw new Error(typeof error === 'string' ? error : (error !== null && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : JSON.stringify(error)))
      }
      shellProven = true
      return ((typeof result === 'object' && result !== null && 'value' in result
        ? (result as { value: unknown }).value
        : result) as T)
    },
    available(): boolean {
      if (shellProven) return true
      return readGlobals().dshDesktop !== undefined
    },
  }
}

/** 页面级单例（官方插件通道；测试可 createShellRpc 注入假环境）。 */
export const shellRpc = createShellRpc()

/**
 * client 入口在 apply 时把 connection.rpc.call 捕获进来：invoke 的官方插件通道
 * （/api/shell.invoke → host 半区 → 宿主 IPC → 壳）由此驱动。幂等；纯浏览器
 * （无 connection）不注入，invoke 直接报 shell rpc unavailable。
 * @param ctx - browser Cordis context（inject 已声明 connection）。
 */
export function captureShellChannelCaller(ctx: { readonly connection?: { readonly rpc?: { readonly call?: (channel: string, endpoint: string, payload: unknown) => Promise<unknown> } } }): void {
  const rpc = ctx?.connection?.rpc
  const call = rpc?.call
  if (rpc === undefined || typeof call !== 'function') return
  const globals = globalThis as unknown as { shellChannelRpc?: unknown }
  if (typeof globals.shellChannelRpc === 'function') return
  globals.shellChannelRpc = (endpoint: string, payload: unknown): Promise<unknown> =>
    call.call(rpc, '/api', endpoint, payload)
}
