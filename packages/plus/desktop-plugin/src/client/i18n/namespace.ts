/**
 * 词典命名空间契约：官方 locale 服务按命名空间注册词典、按命名空间绑定翻译函数。
 *
 * namespace id 是注册与绑定两处的同一事实源；把 key 联合并入
 * `LocaleNamespaceMap` 后，注册处的「双语 key 集合必须相同」由编译期保证
 * （官方 `LocaleDictOf<N>` = 该联合的 Record）。
 */
import type { PlusCopyKey } from './dictionary.ts'

/** 插件在官方 locale 服务里的命名空间 id。 */
export const PLUS_NAMESPACE = 'dsh-desktop-plus'

/**
 * 面板文案函数：词典里的 key 出当前语言译文，词典外的中文原文原样返回
 * （官方查表 miss 时回退 key，因此 t() 任意中文都是安全的）。
 */
export type PlusT = (key: string, params?: Record<string, string | number>) => string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-desktop-plus': PlusCopyKey
  }
}
