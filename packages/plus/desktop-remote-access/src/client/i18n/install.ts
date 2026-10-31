/**
 * apply 侧的 locale 接线：向官方 locale 服务注册本插件的双语词典，并绑定命名空间。
 *
 * 词典注册是 effect（dispose 时随插件卸载撤销）；翻译函数每个命名空间只绑一次、
 * 引用稳定，可直接下传给 slot 注册点与页面内组件。
 */
import type { LocaleDictOf, LocaleNamespaceMap, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from './dictionary.ts'
import { REMOTE_ACCESS_NAMESPACE, type RemoteAccessT } from './namespace.ts'

/** 本包 client 半区实际触达的 cordis 面（locale 服务 + effect 收尾）。 */
interface LocaleContext {
  effect(fn: () => void | (() => void), name?: string): void
  locale: {
    register<N extends Extract<keyof LocaleNamespaceMap, string>>(
      ns: N,
      dicts: Record<'zh' | 'en', LocaleDictOf<N>>,
    ): () => void
    bind(ns: string): Translate
  }
}

/**
 * 注册词典并绑定面板文案函数。
 * @param ctx - 已 inject `locale` 的 client context。
 * @returns 本插件命名空间下的翻译函数（locale 切换后仍按当前语言查表）。
 */
export function installRemoteAccessCopy(ctx: LocaleContext): RemoteAccessT {
  ctx.effect(() => ctx.locale.register(REMOTE_ACCESS_NAMESPACE, { zh, en }), 'dsh-remote-access: dictionaries')
  return ctx.locale.bind(REMOTE_ACCESS_NAMESPACE)
}
