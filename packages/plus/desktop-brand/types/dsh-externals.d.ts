/**
 * dsh web 运行时注入模块的本地类型契约（与 desktop-plugin/types/dsh-externals.d.ts 同款机制）。
 *
 * 值导入的 FishLogo 在构建期是 esbuild external（scripts/build-client.mjs 的 external
 * 列表），由 dsh web 的 ModuleLoader 运行时注入 require，包本体从不进 bundle；纯类型侧
 * 导入被 esbuild 转译期擦除，其空模块声明只为让 tsc 解析 import type 通过。
 * 不能把这些包装成 devDependencies：其 peerDependencies 链上有未公开发布的
 * @deepseek-ai 内部包（安装即 404）。
 *
 * 因此这里只声明品牌包实际触达的面（与 src/client 的 import 一一对应）。
 */

declare module '@deepseek-ai/cordis' {
  /** 宿主 slot 注册表：品牌包只触达 inject（挂工厂）与 register（登记 slot 组件）两面。 */
  export interface ClientSlotRegistry {
    inject(slot: string, factory: () => void | Iterable<unknown>): void
    register(descriptor: { name: string }, component: unknown): unknown
  }

  /** client 根上下文：品牌包只读 slots。 */
  export interface Context {
    readonly slots: ClientSlotRegistry
  }
}

declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}

declare module '@deepseek-ai/dsh-client-ui-sidebar/client' {
  /** 供给 sidebar 品牌 mark 占位者的几何：宿主请求的方形边长（像素）。 */
  export interface SidebarBrandMarkOwnerProps {
    size: number
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  /** dsh 官方鱼形 logo（品牌 mark 复用，几何与官方侧边栏一致）。 */
  export const FishLogo: import('react').ComponentType<{ size?: number | string }>
}
