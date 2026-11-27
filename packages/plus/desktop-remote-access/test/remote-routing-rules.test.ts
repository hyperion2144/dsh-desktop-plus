import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const client = readFileSync(fileURLToPath(new URL('../client/client.source.jsx', import.meta.url)), 'utf8')
const badge = readFileSync(fileURLToPath(new URL('../client/workspace-badge.js', import.meta.url)), 'utf8')
const bridge = readFileSync(fileURLToPath(new URL('../src/host/remote-session-bridge.ts', import.meta.url)), 'utf8')
const host = readFileSync(fileURLToPath(new URL('../src/host/index.ts', import.meta.url)), 'utf8')
const manager = readFileSync(fileURLToPath(new URL('../client/remote-device-manager.jsx', import.meta.url)), 'utf8')

describe('远程会话的请求不允许回退到本地', () => {
  it('转发失败时报错，而不是改在本机执行', () => {
    expect(client).toContain("code: 'remote-failed'")
    // 曾经的写法：not-found 被当成「不归远程管」，于是静默落到本地，界面还显示成功。
    expect(client).not.toContain("if (!message.includes('not-found')) {")
  })
})

describe('远程工作区的连接状态必须真实', () => {
  it('探测失败画成离线，不停在上一次的绿色', () => {
    expect(badge).toContain('probed.set(hostId, "offline")')
  })

  it('主机 id 是重新配对前的旧值时，按 origin 找得到当前主机', () => {
    expect(bridge).toContain("entry.origin === origin")
    expect(host).toContain('entry.origin === origin')
  })

  it('会话确实是远程会话但主机不在时，如实报错', () => {
    expect(bridge).toContain('远端设备未连接')
  })
})

describe('远程工作区与镜像会话的来源标记（#106）', () => {
  it('镜像会话行有来源点：按会话行认出来源主机，颜色跟设备三态走', () => {
    expect(badge).toContain('const SOURCE_ATTR = "data-dsh-remote-source"')
    expect(badge).toContain('来自 ${shown}')
  })

  it('设备离线时条目变灰但仍列出，悬停说明原因且说法与三态同源', () => {
    expect(badge).toContain('result?.description')
    expect(badge).toContain('row.style.opacity = offline ? "0.55" : ""')
    expect(badge).toContain('会话仍可查看')
  })

  it('远程工作区的目录集合随刷新一并下发：远程工作区上新建会话要按它认出来', () => {
    expect(badge).toContain('globalThis.__DSH_REMOTE_WORKSPACE_PATHS__')
  })

  it('侧栏重绘后来源点会补画；卸载时来源点与变灰一并清掉', () => {
    expect(badge).toContain('repaint(); repaintSources();')
    // 卸载函数第一句就引用未定义的 timer 会直接抛错，后面的清理全都执行不到：徽标永远留在侧栏上。
    expect(badge).not.toContain('clearInterval(timer)')
  // 探测进行期间提前把 states 改成离线，会让这一行每次刷新都先灰一下，悬停说明却还是上一次探测的结论。
  expect(badge).not.toContain('states.set(hostId, mapped)')
    expect(badge).toContain('row.style.opacity = ""')
  })
})

describe('设备管理（P0）', () => {
  it('「重连」是真的重新探测这台设备，不是一个没定义的函数', () => {
    expect(manager).toContain('const reconnect = async (hostId) => {')
    expect(manager).toContain('void reconnect(host.hostId)')
  })

  it('「归档」是在设备上执行的写操作，P0 不露出', () => {
    const start = manager.indexOf('>归档</button>')
    expect(start).toBeGreaterThan(-1)
    const tag = manager.lastIndexOf('<button', start)
    expect(manager.slice(tag - 30, tag)).toContain('{REMOTE_WRITES_ENABLED ? (')
  })

  it('状态说明与三态同源：悬停与重连的提示都用宿主给的那句话', () => {
    expect(manager).toContain('result?.description')
    expect(manager).toContain('title={notes[host.hostId] ?? ""}')
  })
})
