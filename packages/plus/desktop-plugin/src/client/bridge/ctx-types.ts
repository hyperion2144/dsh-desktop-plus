// dsh 客户端上下文最小本地契约。
// dsh 0.1.5-rc.2 已移除 @deepseek-ai/dsh-client-runtime（ClientContext 类型随之消失），
// 本插件只声明实际触达的面：logger、slots、connection、locale、sessions、theme、workspaces。
// 属性访问受 Cordis Guard 校验，必须与 index.ts 的 inject 声明保持一致。
import type { LocaleDictOf, LocaleNamespaceMap, Translate } from '@deepseek-ai/dsh-client-ui-slots'
export interface ClientLogger {
  warn?(...args: unknown[]): void
  info?(...args: unknown[]): void
  error?(...args: unknown[]): void
}

export interface ClientSlots {
  inject(name: string, fn: () => void): void
  register(meta: Record<string, unknown>, component: unknown): void
}

export interface ClientConnection {
  rpc: {
    call(channel: string, endpoint: string, payload?: unknown): Promise<any>
    handle(channel: string, handler: unknown, opts?: unknown): void
  }
}

/**
 * 官方 locale 服务（dsh client-locale 插件提供）：词典按命名空间注册，
 * 翻译函数按命名空间绑定。只声明本插件用到的两个动作。
 */
export interface ClientLocale {
  /**
   * 注册一个命名空间的双语词典（key 集合由 `LocaleNamespaceMap` 约束）。
   * @param ns - 并入 `LocaleNamespaceMap` 的命名空间 id。
   * @param dicts - zh/en 两套 key 集合相同的词典。
   * @returns 卸载函数，交给 `ctx.effect` 收尾。
   */
  register<N extends Extract<keyof LocaleNamespaceMap, string>>(
    ns: N,
    dicts: Record<'zh' | 'en', LocaleDictOf<N>>,
  ): () => void
  /**
   * 绑定命名空间，返回按当前 locale 查表的翻译函数（查不到回退 key）。
   * @param ns - 命名空间 id。
   * @returns 翻译函数，引用按命名空间稳定。
   */
  bind(ns: string): Translate
}

export interface ClientContext {
  logger?: ClientLogger
  slots?: ClientSlots
  connection?: ClientConnection
  /** 官方 locale 服务：面板文案的词典注册与命名空间绑定（inject 声明在 index.ts）。 */
  locale: ClientLocale
  /** cordis effect 挂载：回调可返回清理函数（advanced-shell 窗口 chrome 用，调用点无守卫直调）。 */
  effect(fn: () => void | (() => void), name?: string): void
  [key: string]: unknown
}
