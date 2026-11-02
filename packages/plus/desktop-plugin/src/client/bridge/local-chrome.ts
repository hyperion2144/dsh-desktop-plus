import { shellRpc } from '../shell/shell-rpc.ts'
import { invokeCommand } from '../desktop-settings/rpc.ts'
import type { PlusT } from '../i18n/namespace.ts'


/** ui-layout 原生 frame 的 overlay 层稳定标记（AppFrame 固定渲染 data-shell-overlay）。 */
const FRAME_LAYER_SELECTOR = '[data-shell-overlay]'

/** 定位标准布局的 AppFrame（overlay 层的父节点）与三列。children 顺序：sidebar / center / rightbar / overlay … */
function locateLayout(): { frame: HTMLElement; sidebar: HTMLElement; center: HTMLElement | null; rightColumn: HTMLElement | null } | null {
  const layer = document.querySelector(FRAME_LAYER_SELECTOR)
  const frame = layer?.parentElement
  if (frame === null || frame === undefined) return null
  const children = Array.from(frame.children).filter((el): el is HTMLElement => el instanceof HTMLElement)
  return { frame, sidebar: children[0] ?? frame, center: children[1] ?? null, rightColumn: children[2] ?? null }
}

/**
 * 高级模式局部窗口 chrome（#74 收缩后只剩 plus 自己的能力）：
 * 底部状态条——DSH 服务状态 + 悬停「退出本窗口」交互（官方没有这个表面）。
 * 窗口拖拽、标题栏空间、侧栏、折叠态全部走官方路径（壳 preload 标 data-platform；
 * ui-web 的 data-window-drag chrome 行 + recall watcher；官方 AppFrame 的 darwin 折叠与
 * clearance 变量），本模块不再自绘拖拽带/侧栏修复/折叠覆盖。
 *
 * 挂点范式照搬 better-sidebar：往 document.body 追加 fixed host，状态条绝对定位；
 * frame / 侧栏用 ui-layout 的稳定标记定位（不依赖 hash 类名）。
 */
export function installLocalChrome(t: PlusT): () => void {

  const host = document.createElement('div')
  host.className = 'dshDesktopChromeHost'
  document.body.appendChild(host)

  /** 底部状态条高度（sidebar 内容用 padding-bottom 让出一整行）。 */
  const STATUS_BAR_HEIGHT = 24

  const STATUS_TEXT: Record<number, string> = {
    0: '初始化', 1: '启动中', 2: '运行中', 3: '复用外部实例', 4: '重启中',
    5: '服务异常', 6: '服务下线', 7: '远程',
  }
  const STATUS_COLOR: Record<number, string> = {
    0: '#9ca3af', 1: '#f59e0b', 2: '#22c55e', 3: '#22c55e',
    4: '#f59e0b', 5: '#ef4444', 6: '#ef4444', 7: '#3b82f6',
  }


  let raf = 0
  let attempts = 0
  let mountTimer = 0
  let statusTimer = 0
  let currentStatus = -1
  let exitMode: '' | 'hover' = ''
  let resizeObserver: ResizeObserver | null = null
  let mutationObserver: MutationObserver | null = null

  // 底部状态条：sidebar 独占一整行（仅展示状态，不做点击重启——重启走托盘）
  const bar = document.createElement('div')
  bar.className = 'dshDesktopStatusBar'
  bar.innerHTML = '<span class="dshDesktopStatusDot" aria-hidden="true"></span><span class="dshDesktopStatusText"></span>'
  host.appendChild(bar)


  const refreshStatus = () => {
    if (!shellRpc.available()) return
    void invokeCommand('get_dsh_status')
      .then((value) => {
        const s = (value as { status?: number }).status
        if (typeof s !== 'number') return
        currentStatus = s
        if (exitMode !== '') return // 退出交互态：不覆盖按钮/文案
        const dot = bar.querySelector('.dshDesktopStatusDot') as HTMLElement | null
        const text = bar.querySelector('.dshDesktopStatusText') as HTMLElement | null
        const label = t(STATUS_TEXT[s] ?? `状态 ${s}`)
        if (dot !== null) dot.style.background = STATUS_COLOR[s] ?? '#9ca3af'
        if (text !== null) text.textContent = label
        bar.title = `dsh：${label}`
      })
      .catch(() => {})
  }

  // #180 反馈定稿：点击后弹独立确认弹窗（不在状态条内继续选择）；失败信息可见。
  const setExitMode = (mode: '' | 'hover') => {
    exitMode = mode
    const text = bar.querySelector('.dshDesktopStatusText') as HTMLElement | null
    if (mode === '') {
      delete bar.dataset.dshExitMode
      if (text !== null) text.textContent = t(STATUS_TEXT[currentStatus] ?? `状态 ${currentStatus}`)
      bar.title = `dsh：${STATUS_TEXT[currentStatus] ?? ''}`
      refreshStatus()
      return
    }
    bar.dataset.dshExitMode = 'hover'
    if (text !== null) text.textContent = t('退出')
    bar.title = t('完全退出本窗口（关闭窗口 + 停止实例）')
  }

  const openExitConfirm = () => {
    document.getElementById('dshDesktopExitConfirm')?.remove()
    const overlay = document.createElement('div')
    overlay.id = 'dshDesktopExitConfirm'
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;'
    const card = document.createElement('div')
    card.style.cssText =
      'background:var(--dsw-alias-bg-layer-1,#1e1e1e);border:1px solid var(--dsw-alias-border-l2,#444);border-radius:12px;padding:18px 20px;min-width:320px;max-width:80vw;box-shadow:0 12px 40px rgba(0,0,0,0.4);color:var(--dsw-alias-label-primary,#eee);'
    const titleEl = document.createElement('div')
    titleEl.textContent = t('完全退出本窗口')
    titleEl.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:10px;'
    const bodyEl = document.createElement('div')
    bodyEl.textContent = t('将关闭本窗口并停止其 dsh 实例（运行中的会话进程一并停止）。确认继续？')
    bodyEl.style.cssText = 'font-size:12.5px;line-height:1.6;color:var(--dsw-alias-label-secondary,#bbb);'
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:14px;'
    const close = () => {
      document.removeEventListener('keydown', onKey)
      overlay.remove()
      setExitMode('')
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const mkBtn = (label: string, primary: boolean) => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = primary
        ? 'padding:6px 14px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-size:13px;cursor:default;'
        : 'padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);font-size:13px;cursor:default;'
      btn.addEventListener('click', () => {
        if (!primary) {
          close()
          return
        }
        if (!shellRpc.available()) {
          close()
          return
        }
        btn.disabled = true
        void invokeCommand('exit_window_instance')
          .then(() => close())
          .catch((err) => {
            // #180 反馈：失败必须可见（此前静默恢复导致「没退出」无从排查）
            bodyEl.textContent = t('退出失败：{message}', { message: String(err) })
            bodyEl.style.color = '#ef4444'
            btn.disabled = false
          })
      })
      return btn
    }
    row.appendChild(mkBtn(t('取消'), false))
    row.appendChild(mkBtn(t('确认退出'), true))
    card.appendChild(titleEl)
    card.appendChild(bodyEl)
    card.appendChild(row)
    overlay.appendChild(card)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })
    document.addEventListener('keydown', onKey)
    document.body.appendChild(overlay)
  }
  bar.addEventListener('mouseenter', () => {
    if (currentStatus === 2 && exitMode === '') setExitMode('hover')
  })
  bar.addEventListener('mouseleave', () => {
    if (exitMode === 'hover') setExitMode('')
  })
  bar.addEventListener('click', () => {
    if (exitMode !== 'hover' || currentStatus !== 2) return
    openExitConfirm()
  })
  refreshStatus()
  statusTimer = window.setInterval(refreshStatus, 5000)

  const schedule = () => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      sync()
    })
  }

  const sync = () => {
    const layout = locateLayout()
    if (layout === null) {
      // ui-layout 尚未挂载：重试有限次数，避免空转
      if (attempts++ < 1200) schedule()
      return
    }
    attempts = 0
    const { sidebar } = layout
    const sidebarWidth = sidebar.offsetWidth
    // 底部状态条：内容行让出一整行（所有平台），状态条覆盖其上
    sidebar.style.paddingBottom = `${STATUS_BAR_HEIGHT}px`
    // #74：host 只覆盖状态条自身——官方 darwin 组合规则把 body 直挂元素（body > :not(#root)）
    // 算作 no-drag，全视口 host 会按几何顺序减掉窗口里所有官方拖拽行（聚焦拖不动的根因）。
    host.style.cssText = `left:0;bottom:0;width:${sidebarWidth}px;height:${STATUS_BAR_HEIGHT}px;`
    bar.style.cssText = `left:0;bottom:0;width:${sidebarWidth}px;height:${STATUS_BAR_HEIGHT}px;`

  }

  try {
    resizeObserver = new ResizeObserver(schedule)
    mutationObserver = new MutationObserver(schedule)
  } catch {
    resizeObserver = null
    mutationObserver = null
  }

  /** frame 出现后挂上观察器（幂等），返回是否已就位。 */
  const attachObservers = (): boolean => {
    const layout = locateLayout()
    if (layout === null) return false
    if (resizeObserver !== null) {
      resizeObserver.observe(layout.frame)
      resizeObserver.observe(layout.sidebar)
      if (layout.center !== null) resizeObserver.observe(layout.center)
      if (layout.rightColumn !== null) resizeObserver.observe(layout.rightColumn)
    }
    if (mutationObserver !== null) {
      mutationObserver.observe(layout.frame, {
        attributes: true,
        attributeFilter: ['data-sidebar-collapsed', 'data-details-collapsed', 'style'],
      })
    }
    return true
  }

  if (!attachObservers()) {
    // frame 挂在 React 布局里，可能晚于本插件 client；轮询直到出现
    mountTimer = window.setInterval(() => {
      if (attachObservers()) {
        window.clearInterval(mountTimer)
        sync()
      }
    }, 250)
  }
  sync()

  return () => {
    if (raf !== 0) cancelAnimationFrame(raf)
    if (mountTimer !== 0) window.clearInterval(mountTimer)
    if (statusTimer !== 0) window.clearInterval(statusTimer)
    resizeObserver?.disconnect()
    mutationObserver?.disconnect()
    const found = locateLayout()
    if (found !== null) found.sidebar.style.paddingBottom = ''
    host.remove()
  }
}
