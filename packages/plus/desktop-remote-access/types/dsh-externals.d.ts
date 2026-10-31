/**
 * 官方 locale 服务与词典合并表的最小本地类型契约。
 *
 * 本包不安装上游 @deepseek-ai 包（peer 链上有未公开发布的包），因此这里只声明
 * `src/client/i18n` 实际触达的两面：`LocaleDictOf`（注册处的 key 集合约束）与
 * `Translate`（绑定出的翻译函数），以及供 `namespace.ts` 做 declaration merging
 * 的空 `LocaleNamespaceMap`。运行时由 dsh web 的 ModuleLoader 注入。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  /** 词典命名空间合并表：key 是命名空间 id，value 是该命名空间的词典 key 联合。 */
  export interface LocaleNamespaceMap {}

  /** 按 key 取译文；查表 miss 时回退 key 本身（故 key 可以直接写中文原文）。 */
  export type Translate<K extends string = string> =
    (key: K, params?: Record<string, unknown>) => string

  /** 某命名空间的词典形状：恰好是该命名空间并入的 key 联合。 */
  export type LocaleDictOf<N extends keyof LocaleNamespaceMap & string> =
    Record<LocaleNamespaceMap[N] & string, string>
}
