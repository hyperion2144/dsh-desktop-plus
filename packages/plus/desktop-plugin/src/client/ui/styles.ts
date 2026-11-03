/**
 * 高级模式局部 chrome 样式（最小自包含）：
 * - fixed host：只覆盖状态条自身（几何尺寸由 local-chrome 按侧栏宽度设置），
 *   绝不能是全视口元素——官方 darwin 组合规则把 body 直挂元素算作 no-drag，
 *   全视口 host 会按几何顺序减掉窗口里所有官方拖拽行（#74 聚焦拖不动根因）。
 * - 底部状态条与「退出本窗口」交互（#180）。
 * 窗口拖拽/标题栏/侧栏/折叠全部由官方样式承担（#74 删除自绘 chrome 后仅剩状态条）。
 */
const ADVANCED_STYLES = `
.dshDesktopChromeHost { position: fixed; left: 0; bottom: 0; z-index: 45; pointer-events: none; }
.dshDesktopStatusBar { position: absolute; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-secondary, currentColor); border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25)); pointer-events: auto; -webkit-app-region: no-drag; user-select: none; }
.dshDesktopStatusDot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
/* 状态条「退出」（#180）：仅运行中悬停/确认态生效，data-* 稳定标记；文案超宽折叠。 */
.dshDesktopStatusText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopStatusBar[data-dsh-exit-mode="hover"] { background: rgba(220, 38, 38, 0.16); color: #ef4444; font-weight: 600; }
.dshDesktopExitBtn { padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.55); background: transparent; color: inherit; font-size: 11px; line-height: 1; cursor: default; flex: none; }
.dshDesktopExitBtn:hover { filter: brightness(1.1); }
`

/** Install and remove the advanced shell's local-window-chrome styles. @returns the style disposer. */
export function installAdvancedStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-desktop-plus'
  style.dataset.pluginCss = 'dsh-desktop-plus/local-chrome'
  style.textContent = ADVANCED_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
