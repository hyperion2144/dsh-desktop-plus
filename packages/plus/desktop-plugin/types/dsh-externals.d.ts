/**
 * dsh web 运行时注入模块的本地类型契约。
 *
 * 值导入的模块（如 primitives）在构建期是 esbuild external（scripts/build-client.mjs
 * 的 external 列表），由 dsh web 的 ModuleLoader 运行时注入 require，包本体从不进
 * bundle；纯类型侧导入（theme/client）被 esbuild 转译期擦除、不在该列表，其空模块
 * 声明只为让 tsc 解析 import type 通过。
 * 不能把它们装成 devDependencies：其 peerDependencies 链上有未公开发布的
 * @deepseek-ai 内部包（dsh-paths / dsh-compact / dsh-type-meta /
 * dsh-user-interaction 在 npm 404），安装即失败。
 *
 * 因此这里只声明插件实际触达的面（与 src/client 的 import 一一对应）。
 * 上游 API 漂移（如 #103 的图标改名）运行时才暴露——test:client 与 CI 的
 * 双跑兜底；若后续上游公开了类型链路，可换回真实包类型并删除本文件。
 */

type DshIconComponent = import('react').ComponentType<{ size?: number | string }>

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** dsh 官方按钮（toolbar/ghost 变体，样式由 --dsw-alias-button-* token 家族接管）。 */
  export const Button: import('react').ComponentType<{
    variant?: string
    size?: string
    icon?: import('react').ReactNode
    title?: string
    'aria-label'?: string
    onClick?: () => void
    children?: import('react').ReactNode
  }>
  /** #103：dsh 0.1.7 改名 IconDownloadOutline16 → IconDownloadOutlineRegular；
   * CJS require 下旧名缺失（undefined），保留 ?? 兼容两代运行时。 */
  export const IconDownloadOutline16: DshIconComponent | undefined
  export const IconDownloadOutlineRegular: DshIconComponent
  /** dsh 官方两态开关（role=switch）：轨道/滑块的颜色与形状全由主题 token 决定。 */
  export const Switch: import('react').ComponentType<{
    checked: boolean
    onChange: (next: boolean) => void
    label: string
    disabled?: boolean
    title?: string | undefined
    className?: string | undefined
  }>
}

declare module '@deepseek-ai/dsh-client-ui-theme/client' {}

/**
 * 官方 locale 服务与词典合并表：本插件只触达「注册词典 / 绑定命名空间」两面，
 * 以及声明合并用的空 `LocaleNamespaceMap`（词典 owner 各自并入自己的 key 联合）。
 * 运行时由 dsh web 的 ModuleLoader 注入，包本体不进 bundle。
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
