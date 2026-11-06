// 用最小的假 DOM 装切换栏（#149）：验证全局唯一（客户端被再次应用时接手已有那条，不放第二条）、三种视图与卸载。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSidebarSourceFilter } from '../client/sidebar-source-filter.js'

/** 极简元素：只实现切换栏用到的那些能力（语义与真实 DOM 一致：把已在位的节点再插入是移动，不是复制）。 */
class FakeElement {
  children: FakeElement[] = []
  attrs: Record<string, string> = {}
  style: Record<string, string> = {}
  isConnected = true
  parentElement: FakeElement | null = null
  listeners: Record<string, () => void> = {}
  textContent = ''
  constructor(private tag: string) {}
  setAttribute(name: string, value: string): void { this.attrs[name] = value }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null }
  hasAttribute(name: string): boolean { return name in this.attrs }
  removeAttribute(name: string): void { delete this.attrs[name] }
  appendChild(child: FakeElement): FakeElement { child.parentElement = this; this.children.push(child); return child }
  insertBefore(node: FakeElement): FakeElement {
    node.remove()
    node.isConnected = true
    node.parentElement = this
    this.children.unshift(node)
    return node
  }
  replaceChildren(): void { for (const child of this.children) child.parentElement = null; this.children = [] }
  remove(): void {
    if (this.parentElement !== null) this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
    this.isConnected = false
  }
  addEventListener(name: string, listener: () => void): void { this.listeners[name] = listener }
  get childElementCount(): number { return this.children.length }
  click(): void { this.listeners['click']?.() }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null }
  /** 只认属性选择器（可多个并写）：`[a]`、`[a="v"]`、`[a^="prefix"]`。 */
  matches(selector: string): boolean {
    for (const match of selector.matchAll(/\[([\w-]+)(\^?=)?"?([^"\]]*)"?\]/g)) {
      const name = match[1] ?? ''
      const value = this.attrs[name]
      if (value === undefined) return false
      if ((match[2] ?? '') === '=' && value !== (match[3] ?? '')) return false
      if ((match[2] ?? '') === '^=' && !value.startsWith(match[3] ?? '')) return false
    }
    return true
  }
  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = []
    for (const child of this.children) {
      if (child.matches(selector)) found.push(child)
      found.push(...child.querySelectorAll(selector))
    }
    return found
  }
}

class FakeDocument {
  body = new FakeElement('body')
  querySelector(selector: string): FakeElement | null { return this.body.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector: string): FakeElement[] { return this.body.querySelectorAll(selector) }
  createElement(tag: string): FakeElement { return new FakeElement(tag) }
}

/** 一棵侧栏树：两个分组，各带一条工作区头行；其中一个是远程工作区。 */
function sidebar(): { document: FakeDocument; sectionTitles: () => string[] } {
  const document = new FakeDocument()
  const root = document.body.appendChild(new FakeElement('div'))
  const area = root.appendChild(new FakeElement('div'))
  const treeBody = area.appendChild(new FakeElement('div'))
  const tree = treeBody.appendChild(new FakeElement('div'))
  tree.setAttribute('role', 'tree')
  tree.setAttribute('aria-label', '会话')
  for (const [key, title] of [['workspace:w-local', '本机'], ['workspace:w-remote', '远程']] as const) {
    const section = tree.appendChild(new FakeElement('div'))
    const header = section.appendChild(new FakeElement('div'))
    header.setAttribute('data-row-key', key)
    header.textContent = title
  }
  return {
    document,
    sectionTitles: () => tree.children.filter((section) => !section.hasAttribute('data-dsh-remote-source-hidden')).map((section) => section.children[0]?.textContent ?? ''),
  }
}

const install = (document: FakeDocument) => installSidebarSourceFilter({ document, hostCall: async () => ({}), intervalMs: 1_000_000_000, log: () => {} })

describe('侧栏来源切换栏的装配', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('全局唯一：客户端被再次应用时接手页面上已有的那条，不放第二条；接手后按钮照样可用', async () => {
    const { document, sectionTitles } = sidebar()
    const storage = new Map<string, string>()
    vi.stubGlobal('document', document)
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } })
    vi.stubGlobal('__DSH_REMOTE_WORKSPACES__', new Set(['w-remote']))
    const first = install(document)
    const second = install(document)
    const bars = document.querySelectorAll('[data-dsh-remote-source-bar]')
    expect(bars).toHaveLength(1)
    expect(bars[0]?.parentElement).toBe(document.querySelector('[role="tree"]')?.parentElement?.parentElement)
    // 接手的那条上仍有三个页签，点击「远程」只剩远程分组。
    expect(bars[0]?.querySelectorAll('[role="tab"]')).toHaveLength(3)
    bars[0]?.querySelector('[data-source="remote"]')?.click()
    expect(sectionTitles()).toEqual(['远程'])
    first()
    expect(document.querySelectorAll('[data-dsh-remote-source-bar]')).toHaveLength(0)
    second()
  })

  it('卸载时恢复被隐藏的分组', () => {
    const { document, sectionTitles } = sidebar()
    vi.stubGlobal('document', document)
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('__DSH_REMOTE_WORKSPACES__', new Set(['w-remote']))
    const uninstall = install(document)
    document.querySelector('[data-source="local"]')?.click()
    expect(sectionTitles()).toEqual(['本机'])
    uninstall()
    expect(sectionTitles()).toEqual(['本机', '远程'])
  })
})
