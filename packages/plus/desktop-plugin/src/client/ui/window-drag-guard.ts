/**
 * 满视口的透明直挂面不让窗口丢掉拖拽区（#74）。
 *
 * 官方模型（upstream/packages/client/web/src/base.css）：macOS 上 chrome 行标
 * `data-window-drag` 拿 `-webkit-app-region: drag` 的盒子，`body > :not(#root)` 把 body
 * 直挂浮层统一算 `no-drag`，Electron 再把两边的矩形合成窗口的拖拽区。
 *
 * 但实测（#74，Electron 44 / macOS 27）真正的失败不在矩形合成：第三方界面插件把
 * `position: fixed; inset: 0; pointer-events: none` 的装饰层直接挂在 body 下
 * （`data-annotation-overlay` z-index 900、`data-annotation-num-layer` z-index 1100），
 * 只要这两层**被绘制**，chrome 行的拖拽矩形就整批进不了窗口——顶栏按下去页面收得到
 * `mousedown`，窗口却纹丝不动。把这两层的 `-webkit-app-region` 写成 `none`、或者把它们
 * 搬进别的容器，都无效；一旦它们不再绘制（删除、或只关掉它们自己的绘制），立刻恢复。
 * 所以这里裁决的不是 app-region 的值，而是**这一层要不要作为一块面画出来**。
 *
 * 收法：只关掉这一层自己的绘制（`visibility: hidden`），子节点一律恢复可见。装饰层的
 * 可见内容（高亮块、编号芯片）都在子节点上，坐标与插件自己的 `clip-path` 裁剪因此完全
 * 不变。不能改成 0×0：那会让插件 clip-path 里的 `100%` 退化成 0，标记被整片裁掉。
 *
 * 子节点的可见性必须是样式表规则而不是逐个内联：插件每次重渲染都会新建标记节点，
 * 逐个写只能覆盖当时存在的那些，新节点会继承父层的 `hidden` 而不显示。
 */

/** 判定桌面平台的 html 属性：官方桌面契约，由壳的 preload 写入。 */
const PLATFORM_ATTRIBUTE = 'data-platform'

/** 唯一存在 app-region 组合的平台（ui-web base.css 的 darwin 规则）。 */
const DARWIN = 'darwin'

/** 标记「这一层自身不绘制」的属性；样式表按它选，后来的子节点照样可见。 */
const SURFACE_ATTRIBUTE = 'data-dsh-hidden-surface'

/** 关掉直挂面自身的绘制、只恢复它的子节点——两者都必须 `!important`，压过插件的内联值。 */
const SURFACE_STYLES = `
html[${PLATFORM_ATTRIBUTE}='${DARWIN}'] body > [${SURFACE_ATTRIBUTE}] { visibility: hidden !important; }
html[${PLATFORM_ATTRIBUTE}='${DARWIN}'] body > [${SURFACE_ATTRIBUTE}] * { visibility: visible !important; }
`

/** 守护的文档/窗口来源（默认全局；注入是为了在非全局环境里跑）。 */
export interface WindowDragGuardOptions {
  /** 观察的文档，默认 `document`。 */
  readonly doc?: Document
  /** 观察的窗口，默认 `window`。 */
  readonly view?: Window & typeof globalThis
}

/**
 * 让满视口的透明直挂面不再占据窗口拖拽区的收集面。
 * @param options - 文档与窗口来源。
 * @returns disposer：断开观察、去掉样式表并还原所有层。
 */
export function installWindowDragGuard(options: WindowDragGuardOptions = {}): () => void {
  const doc = options.doc ?? document
  const view = options.view ?? window
  const hidden = new Set<HTMLElement>()
  let observer: MutationObserver | null = null
  let scheduled = false
  let disposed = false
  const style = doc.createElement('style')
  style.dataset.plugin = 'dsh-desktop-plus'
  style.dataset.pluginCss = 'dsh-desktop-plus/window-drag-surface'
  style.textContent = SURFACE_STYLES
  doc.head.appendChild(style)

  /** 这个元素现在能不能被按到：`pointer-events: none` 的盒子按不到。 */
  const receivesPointer = (el: HTMLElement): boolean =>
    view.getComputedStyle(el).pointerEvents !== 'none'

  /** 这一层是不是铺满整个视口——只有这种面会把 chrome 行的拖拽矩形挤掉。 */
  const coversViewport = (el: HTMLElement): boolean => {
    const rect = el.getBoundingClientRect()
    return rect.width >= view.innerWidth - 1 && rect.height >= view.innerHeight - 1
  }

  /** 这个元素该不该由我们关掉自身的绘制。 */
  const shouldHide = (el: HTMLElement): boolean => {
    // #root 是官方规则唯一豁免的节点，这里同样不碰。
    if (el.id === 'root') return false
    // 能接指针的层是有用的界面（浮层、面板），别碰它。
    if (receivesPointer(el)) return false
    return coversViewport(el)
  }

  /** 已经在观察的直挂层：每个节点只登记一次，`observe` 重复调用只会换掉选项。 */
  const watched = new WeakSet<HTMLElement>()

  /** 层自己改样式（进/退标注模式、改 z-index、整段重写 cssText）时要重新裁决。 */
  const watch = (el: HTMLElement): void => {
    if (watched.has(el)) return
    watched.add(el)
    observer?.observe(el, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  }

  /** 关掉这一层自身的绘制（子节点由样式表恢复可见）。 */
  const hide = (el: HTMLElement): void => {
    if (hidden.has(el)) return
    hidden.add(el)
    el.setAttribute(SURFACE_ATTRIBUTE, '')
  }

  /** 把绘制还给这一层。 */
  const reveal = (el: HTMLElement): void => {
    if (!hidden.delete(el)) return
    el.removeAttribute(SURFACE_ATTRIBUTE)
  }

  /** 重新裁决 body 的直挂元素：满视口、又拿不到指针的面不该参与绘制。 */
  const reconcile = (): void => {
    const body = doc.body
    if (body === null) return
    const active = doc.documentElement.getAttribute(PLATFORM_ATTRIBUTE) === DARWIN
    for (const el of Array.from(body.children)) {
      if (!(el instanceof view.HTMLElement)) continue
      // 直挂层可能稍后才铺满视口或变成 `pointer-events: none`，所以要盯样式，
      // 不能只在第一次判定时才登记；官方规则唯一豁免的 `#root` 不必盯。
      if (el.id !== 'root') watch(el)
      if (active && shouldHide(el)) hide(el)
      else reveal(el)
    }
    // 已经离开文档的层：去掉标记后丢弃，别把引用留住。
    for (const el of Array.from(hidden)) if (!el.isConnected) reveal(el)
  }

  /** 同一批次里的多次变动合并成一次裁决。 */
  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      if (disposed) return
      scheduled = false
      reconcile()
    })
  }

  observer = new view.MutationObserver(schedule)
  // 平台标记可能晚于本模块写入（advanced shell 的 effect 顺序）：标上再裁决一次。
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: [PLATFORM_ATTRIBUTE] })
  // body 直挂子节点的增删（第三方浮层按需挂载/卸载）。
  if (doc.body !== null) observer.observe(doc.body, { childList: true })
  view.addEventListener('resize', schedule)
  reconcile()

  return () => {
    disposed = true
    observer?.disconnect()
    observer = null
    view.removeEventListener('resize', schedule)
    style.remove()
    for (const el of Array.from(hidden)) reveal(el)
  }
}
