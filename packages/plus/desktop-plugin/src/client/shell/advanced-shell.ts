import type { ClientContext } from '../bridge/ctx-types.ts'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { DesktopClientEnvironment } from '../features/environment.ts'
import { installLocalChrome } from '../bridge/local-chrome.ts'
import { installAdvancedStyles } from '../ui/styles.ts'
import type { PlusT } from '../i18n/namespace.ts'

/**
 * 高级模式：不禁用 stock ui-layout、不接管 root、不提供 layout 服务，只做两件事：
 * 注入本地窗口的底部状态条样式、挂上状态条宿主。窗口拖拽/标题栏/侧栏/折叠与
 * `html[data-platform]` 全部由官方窗口承担（preload 按窗口角色写标记，#125）。
 */
export function applyAdvancedShell(ctx: ClientContext, environment: DesktopClientEnvironment, t: PlusT): void {
  // 只有**桌面窗口**才注入窗口 chrome。远程/手机页面加载的是同一份客户端插件，
  // 而官方窄屏布局的条件是 `@media (width<=767px)` **且** `html:not([data-platform='darwin'])`
  // —— 无差别写 `darwin` 会把手机上的设置页（以及其它窄屏形态）按回桌面侧边栏。
  // 判别依据是窗口能力本身：官方 preload 只给壳构造的窗口注入完整 dshDesktop 载体
  // （含 browser/keyboard），远程端与浏览器拿不到这份载体。
  if (!isDesktopWindow()) return
  ctx.effect(() => {
    document.body.dataset.dshDesktopPlatform = environment.platform
    const removeStyles = installAdvancedStyles()
    return () => {
      removeStyles()
      delete document.body.dataset.dshDesktopPlatform
    }
  }, 'desktop: advanced shell styles')

  ctx.effect(() => installLocalChrome(t), 'desktop: local window chrome')
}

/** 当前页面是不是壳构造的桌面窗口，由窗口载体（而不是页面来源）判定。 */
function isDesktopWindow(): boolean {
  const bridge = (globalThis as { dshDesktop?: { browser?: unknown } }).dshDesktop
  return typeof bridge?.browser === 'object' && bridge.browser !== null
}
