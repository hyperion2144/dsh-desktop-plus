// 壳 RPC 客户端统一传输层（plus 适配版）。
//
// plus 壳是官方 Electron 壳的 fork：没有 Electrobun 原生桥，也没有 mobile-access 中继。
// 唯一通道是同源 HTTP：壳侧在应用 URL 服务上暴露 POST /__shell__/rpc，
// 请求 `{ method, params }`，回包 `{ value }` 或 `{ error }`。
// 端点写相对路径：页面跑在 dsh-app:// 源（官方壳）或 http(s) 源都打到同源端点，
// 没有跨源问题，也不需要任何注入全局。
//
// 壳在场判据：官方桌面载体标记 `globalThis.dshDesktop`（protocolVersion 1，官方壳 preload
// 经 contextBridge 注入，plus fork 原样继承）；兜底是「任意一次 RPC 成功」——同源端点存在
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
  /** RPC 端点，默认同源 /__shell__/rpc。 */
  endpoint?: string | undefined
}

export interface ShellRpcInvokeOptions {
  /** 单请求超时（默认 15s，文件选择/重启类调用可放宽）。 */
  timeoutMs?: number
  /** 不挂客户端超时：长任务靠轮询快照收尾，终态由 runtime_download_status 对账。 */
  noTimeout?: boolean
}

export interface ShellRpcClient {
  invoke<T = unknown>(method: string, params?: Record<string, unknown>, options?: ShellRpcInvokeOptions): Promise<T>
  /** 壳是否在场（面板据此决定激活桌面 chrome 与否）。 */
  available(): boolean
}

const DEFAULT_ENDPOINT = '/__shell__/rpc'
const DEFAULT_TIMEOUT_MS = 15_000

export function createShellRpc(deps?: Partial<ShellRpcDeps>): ShellRpcClient {
  const fetchImpl = deps?.fetchImpl ?? ((input, init) => fetch(input, init))
  const setTimeoutImpl = deps?.setTimeoutImpl ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimeoutImpl = deps?.clearTimeoutImpl ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  const readGlobals = deps?.readGlobals ?? (() => globalThis as unknown as ShellRpcGlobals)
  const endpoint = deps?.endpoint ?? DEFAULT_ENDPOINT
  /** 一次成功的 RPC 即证明同源端点存在（壳未注入载体标记时的兜底判据）。 */
  let shellProven = false

  return {
    async invoke<T = unknown>(method: string, params?: Record<string, unknown>, options?: ShellRpcInvokeOptions): Promise<T> {
      const controller = new AbortController()
      const timeout = options?.noTimeout === true || options?.timeoutMs === 0
        ? undefined
        : setTimeoutImpl(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method, params: params ?? {} }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`shell rpc http ${response.status}`)
        const body: unknown = await response.json()
        if (typeof body === 'object' && body !== null && 'error' in body) {
          const error = (body as { error: unknown }).error
          throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
        }
        shellProven = true
        return (typeof body === 'object' && body !== null && 'value' in body
          ? (body as { value: unknown }).value
          : body) as T
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`shell rpc timeout after ${options?.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms: ${method}`)
        }
        throw error instanceof TypeError ? new Error('shell rpc unavailable') : error
      } finally {
        if (timeout !== undefined) clearTimeoutImpl(timeout)
      }
    },
    available(): boolean {
      if (shellProven) return true
      return readGlobals().dshDesktop !== undefined
    },
  }
}

/** 页面级单例（同源 HTTP；测试可 createShellRpc 注入假环境）。 */
export const shellRpc = createShellRpc()
