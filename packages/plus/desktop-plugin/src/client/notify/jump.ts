// #116 通知点击的会话定位与窗口前置（dsh-pet 手势三段式，从 client/index.ts 迁入）。
import type { ClientContext } from '../bridge/ctx-types.ts'

/**
 * 预留全局：壳侧点击通知后经 executeJavaScript 调这个全局，把页面切到对应会话。
 * 幂等（重复调用 = 重复 openSession）；uiWorkspace 缺席（旧版 DSH 无该服务）或
 * 跳转失败都静默跳过——「把窗口叫回前台」不受影响。
 */
export function installFocusSessionGlobal(ctx: ClientContext): void {
  (globalThis as Record<string, unknown>).__dshPlusFocusSession = (sessionId: unknown): void => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    try {
      const get = (ctx as unknown as { get?: (name: string) => { openSession?: (id: string) => void } | undefined }).get
      get?.('uiWorkspace')?.openSession?.(sessionId)
    } catch {
      // 会话定位失败只降级为聚焦
    }
  }
}

/**
 * toast 点击手势：openSession → window.focus() → Electron 下 iframe 拉起
 * `dsh://open`——系统因此授予前台权，后台/被遮挡的窗口也能被拉到前台
 * （壳侧进程内手段全被 Windows 前台激活限制拦住）。
 */
export function jumpToSession(ctx: ClientContext, sessionId?: string): void {
  if (sessionId !== undefined) {
    const focusSession = (globalThis as { __dshPlusFocusSession?: (sessionId: string) => void }).__dshPlusFocusSession
    try { focusSession?.(sessionId) } catch { /* 不跳会话而已，继续叫窗口 */ }
  }
  window.focus()
  if (!/electron/i.test(navigator.userAgent)) return
  const protocolFrame = document.createElement('iframe')
  protocolFrame.style.display = 'none'
  protocolFrame.src = 'dsh://open'
  document.body.append(protocolFrame)
  setTimeout(() => protocolFrame.remove(), 1000)
}
