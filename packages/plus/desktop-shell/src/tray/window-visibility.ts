/**
 * 窗口可见性 → 托盘刷新的单一事件源。
 *
 * 托盘的「显示/隐藏」文案（以及点击语义）是窗口可见性的一次快照：菜单只在
 * 构建与显式 refresh() 时读 getWindowState()。窗口的 hide / show / minimize /
 * restore 发生在托盘动作之外：主窗口关闭路径曾单独补过刷新，profile 窗口的
 * 关闭（close→hide）与两侧的最小化/还原都漏了——每加一条路径都要记得补一次。
 *
 * 这个模块把「窗口可见性变了」收敛成一个订阅：每个会出现在托盘里的窗口
 * （默认主窗口、每个 profile 窗口）创建后绑定一次，事件统一喂给同一个托盘
 * 刷新助手。监听挂在窗口上，窗口销毁时随之消失，无需显式解绑。
 */

/** 会改变托盘可见性判断的 Electron 窗口事件。 */
export type WindowVisibilityEvent = 'hide' | 'show' | 'minimize' | 'restore'

/** 结构上的窗口事件源：BrowserWindow 满足它，测试替身也满足。 */
export interface WindowVisibilitySource {
  on(event: string, listener: () => void): unknown
}

/**
 * 订阅的事件集合：不含 focus（托盘文案只依赖 visible），不含 close
 * （关闭按钮的路径是 preventDefault + hide()，hide 事件已经覆盖）。
 */
export const WINDOW_VISIBILITY_EVENTS: readonly WindowVisibilityEvent[] = ['hide', 'show', 'minimize', 'restore']

/**
 * 把窗口的可见性变化收敛成一条通知。
 *
 * @param window 要观察的窗口：默认主窗口或任一 profile 窗口。
 * @param notify 每次可见性变化调用一次，参数是触发这次变化的事件名。
 */
export function observeWindowVisibility(
  window: WindowVisibilitySource,
  notify: (event: WindowVisibilityEvent) => void,
): void {
  for (const event of WINDOW_VISIBILITY_EVENTS) {
    window.on(event, () => { notify(event) })
  }
}
