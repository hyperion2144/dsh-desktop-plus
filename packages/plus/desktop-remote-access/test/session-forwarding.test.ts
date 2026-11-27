import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const client = readFileSync(fileURLToPath(new URL('../client/client.source.jsx', import.meta.url)), 'utf8')
const host = readFileSync(fileURLToPath(new URL('../src/host/index.ts', import.meta.url)), 'utf8')
const gate = readFileSync(fileURLToPath(new URL('../client/remote-gate.js', import.meta.url)), 'utf8')

// 裁决本身的行为（哪些拒绝、哪些转发、提示措辞）在 remote-gate.test.ts 里逐条覆盖；
// 这里只锁接线：传输层确实把裁决交给了 remote-gate，并且按裁决结果行事。
describe('远程会话是只读镜像（P0）：传输层接线', () => {
  it('裁决只有 remote-gate 一个来源：jsx 里不再另存一份端点清单', () => {
    expect(client).toContain('decideRemoteCall(endpoint, args, knownRemote(), remoteFlags(endpoint, args))')
    expect(client).not.toContain('FORWARD_SESSION')
    expect(client).not.toContain('TOAST_ENDPOINTS')
  })

  it('被拒的调用返回 remote-readonly，绝不落到本地执行', () => {
    const start = client.indexOf("if (verdict.kind === 'refuse') {")
    const end = client.indexOf('inside = true;', start)
    const block = client.slice(start, end)
    expect(block).toContain("code: 'remote-readonly'")
    expect(block).not.toContain('originalCall(')
  })

  it('转发失败时不退回本地，唯一例外是 host 明确告知 not-remote-workspace', () => {
    const start = client.indexOf('inside = true;\n        try {')
    const end = client.indexOf('return originalCall(channel, endpoint, payload, signal);\n      };', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const block = client.slice(start, end)
    const fallbackAt = block.indexOf('originalCall(channel, endpoint, payload, signal)')
    const guardAt = block.indexOf("message.includes('not-remote-workspace')")
    expect(fallbackAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(-1)
    expect(fallbackAt).toBeGreaterThan(guardAt)
  })

  it('删除远程工作区只删本机条目并摘掉登记，不打到远端', () => {
    const start = client.indexOf("if (verdict.kind === 'local-remove') {")
    const end = client.indexOf("if (verdict.kind === 'refuse') {", start)
    const block = client.slice(start, end)
    expect(block).toContain('originalCall(channel, endpoint, payload, signal)')
    expect(block).toContain("hostCall('remoteWorkspace.remove'")
    expect(block).not.toContain('remoteSession.invoke')
  })

  it('命名空间包装层对写类方法不生效：它们在传输层被拒绝，包了反而会先转发到远端', () => {
    expect(client).toContain("if (decideRemoteInvoke(name, method) === 'refuse') continue;")
  })

  it('「分享到远程」菜单不露出，流式端点暂不接管：各有独立开关，不随写开关打开', () => {
    expect(gate).toContain('export const SESSION_SHARE_MENU_ENABLED = false;')
    expect(gate).toContain('export const REMOTE_STREAMS_ENABLED = true;')
    expect(client).toContain('if (SESSION_SHARE_MENU_ENABLED) slots.inject("sidebar.workspaces.session.menu.item"')
    expect(client).toContain('if (!REMOTE_STREAMS_ENABLED) return undefined;')
  })
})
