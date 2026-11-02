import type { ClientContext } from '../bridge/ctx-types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { DesktopClientEnvironment } from '../features/environment.ts'
import { installLocalChrome } from '../bridge/local-chrome.ts'
import { installAdvancedStyles } from '../ui/styles.ts'
import { installWindowDragGuard } from '../ui/window-drag-guard.ts'
import type { PlusT } from '../i18n/namespace.ts'

/**
 * 高级模式：不禁用 stock ui-layout、不接管 root、不提供 layout 服务，只在
 * 原生布局的局部注入窗口拖拽 chrome（macOS 侧栏顶部拖拽 + 折叠加宽容纳红绿灯；
 * Win/Linux 中间 header 顶部拖拽条 + 自绘窗口按钮，内容用 padding 顶下）。
 */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment, t: PlusT): void {

  // 只有**桌面窗口**才注入窗口 chrome 与平台标记。远程/手机页面加载的是同一份客户端插件，
  // 而官方窄屏布局的条件是 `@media (width<=767px)` **且** `html:not([data-platform='darwin'])`
  // —— 无差别写 `darwin` 会把手机上的设置页（以及其它窄屏形态）按回桌面侧边栏。
  // 判别依据（两个都是壳注入、远程端拿不到的全局）：`dshDesktopBoot` 是官方 preload 只在
  // `dsh-app://` 文档里暴露的全局（`apps/web/src/main.ts` 同源依赖）；`__DSH_PLUS_LOCAL_WINDOW__`
  // 是 #74 里 profile 分区会话 preload 暴露的本地窗口标记（含真实 profile 名）。
  // 手机/浏览器的页面里两者皆无 → 窄屏布局语义（#72）不变。
  if (!isDesktopWindow()) return

  ctx.effect(() => {
    document.body.dataset.dshDesktopPlatform = environment.platform
    // 官方桌面契约：html[data-platform]（旧 Tauri 壳即设，Electrobun 迁移时丢失，#23）
    document.documentElement.dataset.platform = environment.platform
    const removeStyles = installAdvancedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopPlatform
      delete document.documentElement.dataset.platform
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => installLocalChrome(t), 'desktop: local window chrome')
  // #74：`pointer-events: none` 的 body 装饰层不吃掉整窗拖拽面——
  // 否则装了界面插件（满视口透明层）的 profile 窗口会整窗拖不动，干净 profile 却正常。
  ctx.effect(() => installWindowDragGuard(), 'desktop: window drag guard')
}

/** 当前页面是不是本地桌面应用的窗口（而不是浏览器/手机这类远程端）。 */
function isDesktopWindow(): boolean {
  const globals = globalThis as { dshDesktopBoot?: unknown; __DSH_PLUS_LOCAL_WINDOW__?: unknown }
  return typeof globals.dshDesktopBoot !== 'undefined' || typeof globals.__DSH_PLUS_LOCAL_WINDOW__ !== 'undefined'
}
