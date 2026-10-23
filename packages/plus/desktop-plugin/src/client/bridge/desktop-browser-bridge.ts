/**
 * 侧边栏浏览器 guest 载体桥（#118/#134）。
 *
 * plus 壳是官方 Electron 壳的 fork：壳侧命令一律走官方插件通道 `/api/shell.invoke`
 * （见 shell/shell-rpc.ts），本文件不再依赖任何 Electrobun / Tauri 专有全局。
 *
 * 桥三方法（acquire / release / onOpenRequested）是壳侧 guest 命令的薄封装；
 * 状态镜像：dsh 对 webview 元素的 getURL/getTitle/isLoading/canGoBack/
 * canGoForward 是同步拉取，而 RPC 是异步——旧壳在每次状态变化后 eval 推送快照，
 * 同源 HTTP 没有回推通道，改由页面按节拍拉 `browser_guest_state`（回执自带 kind），
 * 本层更新镜像并合成对应的 Electron webview DOM 事件（dom-ready / did-navigate /
 * did-start-loading…）；
 * 矩形同步：原生子 webview 永远浮在 dsh 内容之上，必须用 ResizeObserver
 * 把 webview 标签的 getBoundingClientRect 实时同步给壳（CSS px = 窗口逻辑坐标），
 * rect 归零（切 tab/收侧栏）或 [role=dialog] 弹层与标签相交时隐藏 guest。
 *
 * 纯浏览器（壳不在场）不安装任何东西，行为不变。官方 Electron 壳另有原生 carrier
 * （`globalThis.dshDesktop.browser` + `<webview>` 标签），那条路径由 dsh 上游 client 自己走：
 * 原生 carrier 在场时本桥整个不装（patch 会覆盖原生实现），只有壳没有原生 carrier 时才接管。
 * 本桥是壳侧能力实现点：壳侧实现 browser_guest_* 命令时它才真正工作。
 */
import { invokeCommand } from '../desktop-settings/rpc.ts'
import { shellRpc } from '../shell/shell-rpc.ts'
import type { CommandArgs, Commands } from '../../../contracts/index.ts'




/** Rust 推送的 guest 快照（browser_guest_state / _receive 载荷）；形状锚在契约上（#190）。 */
type GuestPush = Commands['browser_guest_state']['result']

/** dsh 侧 acquire 返回的预约（契约形状）。 */
type GuestReservation = Commands['browser_guest_acquire']['result']

/** Electron webview 元素兼容面（dsh ElectronWebViewImpl 调用集）。 */
interface WebviewElementLike extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  clearHistory(): void
  stop(): void
}

interface GuestMirror {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  el: WebviewElementLike | undefined
  /** 已对 Rust 可见（避免重复 show/hide 抖动）。 */
  shown: boolean
  /** 弹层遮挡中（[role=dialog] 与标签矩形相交）。 */
  overlayHidden: boolean
  rectPending: boolean
}

const mirrors = new Map<string, GuestMirror>()
const openListeners = new Map<string, (url: string) => void>()
/** 每个已绑定 guest 的矩形调度器（lease → scheduleRect），供共享轮询兑底。 */
const rectSchedulers = new Map<string, () => void>()
let rectPollTimer: number | undefined
/**
 * 矩形同步兑底轮询：不同引擎的 ResizeObserver 对 display:none 转换不触发
 * （实测某 Chromium），切 tab/收侧栏等隐藏机制也不能全靠 RO；400ms 共享轮询
 * 兑底（调度本身 rAF 合并，几乎无额外开销）。
 */
function ensureRectPoll(): void {
  if (rectPollTimer !== undefined) return
  rectPollTimer = window.setInterval(() => {
    for (const [lease, schedule] of rectSchedulers) {
      if (!mirrors.has(lease)) {
        rectSchedulers.delete(lease)
        continue
      }
      schedule()
    }
  }, 400)
}

/**
 * 状态轮询（plus 传输适配）：旧壳经原生 eval 推送 guest 快照，同源 HTTP 是请求/响应、
 * 没有回推通道——改由页面按固定节拍拉 `browser_guest_state`，回执本身就是契约里的
 * GuestPush（带 kind），直接喂给状态镜像与 DOM 事件合成。只对已绑定 webview 标签的
 * lease 拉取，没有 guest 时零请求。
 */
const STATE_POLL_MS = 1000
let statePollTimer: number | undefined

function ensureStatePoll(): void {
  if (statePollTimer !== undefined) return
  statePollTimer = window.setInterval(() => {
    for (const [lease, m] of mirrors) {
      if (m.el === undefined) continue
      void invokeCommand('browser_guest_state', { lease })
        .then((snap) => applyPush(snap))
        .catch((error: unknown) => {
          console.warn(`[dsh-desktop-plus] guest 状态拉取失败（${lease}）：${String(error)}`)
        })
    }
  }, STATE_POLL_MS)
}

function mirrorOf(lease: string): GuestMirror {
  let m = mirrors.get(lease)
  if (!m) {
    m = {
      url: `about:blank#${lease}`,
      title: '',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      el: undefined,
      shown: false,
      overlayHidden: false,
      rectPending: false,
    }
    mirrors.set(lease, m)
  }
  return m
}

/** Electron webview 事件对象（属性直接挂在 event 上，detail 不参与）。 */
function makeEvent(type: string, props?: Record<string, unknown>): Event {
  const ev = new Event(type)
  if (props) Object.assign(ev, props)
  return ev
}

/** 应用一次 guest 状态快照（轮询回执或壳侧回推）：更新镜像并合成对应 DOM 事件。 */
function applyPush(push: GuestPush): void {
  const m = mirrors.get(push.lease)
  if (!m) return
  m.url = push.url
  m.title = push.title
  m.loading = push.loading
  m.canGoBack = push.canGoBack
  m.canGoForward = push.canGoForward
  const el = m.el
  if (!el) return
  switch (push.kind) {
    case 'started':
      el.dispatchEvent(makeEvent('did-start-navigation', { isMainFrame: true }))
      el.dispatchEvent(makeEvent('did-start-loading'))
      break
    case 'finished':
      el.dispatchEvent(makeEvent('did-stop-loading'))
      el.dispatchEvent(makeEvent('did-navigate'))
      break
    case 'failed':
      el.dispatchEvent(makeEvent('did-stop-loading'))
      // errorCode 留空：dsh 显示通用「页面加载失败」条（Rust 看门狗超时判失败）
      el.dispatchEvent(makeEvent('did-fail-load', { isMainFrame: true }))
      break
    case 'title':
      el.dispatchEvent(makeEvent('page-title-updated'))
      break
    case 'gone':
      el.dispatchEvent(makeEvent('render-process-gone'))
      break
    default:
      break
  }
}

// ── webview 标签兼容层 ─────────────────────────────────────

function patchElement(el: WebviewElementLike, lease: string, m: GuestMirror): void {
  const fireAndForget = (args: CommandArgs<'browser_guest_control'>): void => {
    void invokeCommand('browser_guest_control', args).catch((e) => {
      console.error('[desktop-browser-bridge] browser_guest_control 失败', e)
    })
  }
  el.loadURL = (url: string): Promise<void> =>
    invokeCommand('browser_guest_navigate', { lease, url }).then(
      () => undefined,
      (e) => {
        // dsh 仅忽略 ERR_ABORTED；其余 rejection 走 commandFailed 显示失败条
        throw e
      },
    )
  el.getURL = (): string => m.url
  el.getTitle = (): string => m.title
  el.isLoading = (): boolean => m.loading
  el.canGoBack = (): boolean => m.canGoBack
  el.canGoForward = (): boolean => m.canGoForward
  el.goBack = (): void => fireAndForget({ lease, action: 'back' })
  el.goForward = (): void => fireAndForget({ lease, action: 'forward' })
  el.reload = (): void => fireAndForget({ lease, action: 'reload' })
  // bootstrap 历史不落地策略：初始 about:blank 不产生 back-forward 条目（Rust 侧
  // 不为其导航），WKWebView/WebView2 均无需真实清历史
  el.clearHistory = (): void => {}
  el.stop = (): void => {}
}

function rectsIntersect(a: DOMRectReadOnly, b: DOMRectReadOnly): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function isWebviewTag(node: Node): node is WebviewElementLike {
  if (node.nodeType !== Node.ELEMENT_NODE) return false
  const el = node as HTMLElement
  // 不用 instanceof HTMLUnknownElement：不同引擎对未注册标签的构造器不统一
  // （实测某 Chromium 下 webview 非 HTMLUnknownElement）；tagName + dsh 自有的
  // dataset 稳定标记已足够判定
  return (
    el.tagName.toLowerCase() === 'webview' &&
    el.dataset?.sidebarBrowserFrame === 'webview' &&
    typeof el.getAttribute('name') === 'string'
  )
}

function installTagObserver(): void {
  const bind = (el: WebviewElementLike): void => {
    const lease = el.getAttribute('name') as string
    const m = mirrorOf(lease)
    if (m.el === el) return
    m.el = el
    patchElement(el, lease, m)

    // 矩形同步：rAF 合并；rect 归零或弹层相交即隐藏
    const applyRect = (): void => {
      m.rectPending = false
      const r = el.getBoundingClientRect()
      const rectVisible = r.width > 1 && r.height > 1
      const shouldShow = rectVisible && !m.overlayHidden
      if (rectVisible) {
        void invokeCommand('browser_guest_set_bounds', {
          lease,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }).catch((error: unknown) => {
          console.warn(`[dsh-desktop-plus] guest 控制失败（set_bounds）：${String(error)}`)
        })
      }
      if (shouldShow !== m.shown) {
        m.shown = shouldShow
        void invokeCommand('browser_guest_set_visible', { lease, visible: shouldShow }).catch((error: unknown) => {
          console.warn(`[dsh-desktop-plus] guest 控制失败（set_visible）：${String(error)}`)
        })
      }
    }
    const scheduleRect = (): void => {
      if (m.rectPending) return
      m.rectPending = true
      requestAnimationFrame(applyRect)
    }
    rectSchedulers.set(lease, scheduleRect)
    ensureRectPoll()
    const recomputeOverlay = (): void => {
      const el2 = m.el
      if (!el2) return
      let hidden = false
      const r = el2.getBoundingClientRect()
      for (const dlg of document.querySelectorAll('[role=dialog]')) {
        const dr = dlg.getBoundingClientRect()
        if (dr.width > 0 && rectsIntersect(r, dr)) {
          hidden = true
          break
        }
      }
      m.overlayHidden = hidden
      scheduleRect()
    }
    const ro = new ResizeObserver(scheduleRect)
    ro.observe(el)
    if (el.parentElement) ro.observe(el.parentElement)
    window.addEventListener('resize', scheduleRect)
    const dialogMo = new MutationObserver(recomputeOverlay)
    dialogMo.observe(document.body, { childList: true, subtree: true })

    // 初始同步 + dom-ready（dsh 收到后置 ready 并 loadPending）
    void invokeCommand('browser_guest_state', { lease })
      .then((snap) => {
        m.url = snap.url
        m.title = snap.title
        m.loading = snap.loading
        m.canGoBack = snap.canGoBack
        m.canGoForward = snap.canGoForward
      })
      .catch((error: unknown) => {
        console.warn(`[dsh-desktop-plus] guest 控制失败（guest_state）：${String(error)}`)
      })
      .finally(() => {
        scheduleRect()
        recomputeOverlay()
        el.dispatchEvent(makeEvent('dom-ready'))
      })
  }

  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      for (const node of mu.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && isWebviewTag(node)) bind(node)
      }
    }
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })
}

// ── 桥实现安装 ─────────────────────────────────────────────

interface BridgeImpl {
  acquire(workspace: unknown): Promise<GuestReservation>
  release(lease: string): Promise<void>
  onOpenRequested(lease: string, listener: (url: string) => void): () => void
  _receive(push: GuestPush): void
  _openRequested(payload: { lease: string; url: string }): void
}

/**
 * 安装桌面壳浏览器 guest 桥（幂等）。
 * 壳在场（官方桌面载体标记或同源 RPC 探针成功）时才生效；纯浏览器不装。
 */
export function installDesktopBrowserBridge(): void {
  const g = globalThis as unknown as {
    __dshShellBridgeImpl?: BridgeImpl
    dshDesktop?: { readonly protocolVersion?: number; readonly browser?: unknown }
  }
  // 官方 Electron 壳自带原生 carrier（globalThis.dshDesktop.browser，protocolVersion 1）：
  // dsh 上游 client 直接用它接管 webview。本桥会 patch 同一批 <webview> 标签，
  // 两者同时生效会覆盖原生实现（getURL/canGoBack 等读不到真值），所以原生 carrier 在场时本桥让位。
  if (g.dshDesktop?.protocolVersion === 1 && g.dshDesktop.browser !== undefined) return
  if (g.__dshShellBridgeImpl !== undefined) return
  if (!shellRpc.available()) return
  const impl: BridgeImpl = {
    acquire(workspace: unknown): Promise<GuestReservation> {
      const key = typeof workspace === 'string' ? workspace : String(workspace ?? '')
      return invokeCommand('browser_guest_acquire', { workspaceKey: key }).then(
        (res) => {
          mirrorOf(res.lease)
          return res
        },
      )
    },
    release(lease: string): Promise<void> {
      const m = mirrors.get(lease)
      if (m) {
        m.el = undefined
        m.shown = false
        mirrors.delete(lease)
      }
      openListeners.delete(lease)
      return invokeCommand('browser_guest_release', { lease }).then(
        () => undefined,
        (e) => {
          console.error('[desktop-browser-bridge] guest release 失败', e)
        },
      )
    },
    onOpenRequested(lease: string, listener: (url: string) => void): () => void {
      openListeners.set(lease, listener)
      return () => {
        if (openListeners.get(lease) === listener) openListeners.delete(lease)
      }
    },
    _receive(push: GuestPush): void {
      applyPush(push)
    },
    _openRequested(payload: { lease: string; url: string }): void {
      openListeners.get(payload.lease)?.(payload.url)
    },
  }
  g.__dshShellBridgeImpl = impl
  installTagObserver()
  ensureStatePoll()
  // 页面卸载（dsh 重启/切换 profile 重导航）兜底释放 guest，防原生 webview 泄漏
  window.addEventListener('pagehide', () => {
    void invokeCommand('browser_guest_release_all').catch(() => {})
  })
}
