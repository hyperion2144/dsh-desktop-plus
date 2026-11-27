// 解除配对时桥接清掉某台主机的全部派生物（#157）：镜像登记、进度、订阅、待答交互、镜像缓存与落盘。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installRemoteSessionBridge } from '../src/host/remote-session-bridge.js'
import { mirrorIdOf } from '../src/host/mirror-id.js'

let home = ''
let previousHome: string | undefined

beforeEach(() => {
  // 桥接日志落在 $DSH_HOME/logs 下：测试期间指到临时目录，不碰真实的日志。
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(path.join(tmpdir(), 'bridge-forget-'))
  process.env.DSH_HOME = home
})
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

/** 最小装配：官方服务一概缺席，只要能登记、能清、能落盘。 */
function harness() {
  const persisted: Array<{ sessionId: string, hostId: string }> = []
  const removed: string[] = []
  const bridge = installRemoteSessionBridge({
    // 官方会话控制器只要求「在场」：各方法都是可选的，给个空对象即可；其余服务一概缺席。
    ctx: { get: (name: string) => (name === 'sessionController' ? {} : undefined), logger: { warn() { }, info() { } } },
    hosts: { get: () => undefined, list: () => [] },
    workspaces: () => [],
    cursors: new Map(),
    materialized: new Map(),
    cache: { read: () => undefined, watermark: () => -1, append: () => undefined, remove: (hostId, remoteSessionId) => { removed.push(`${hostId}/${remoteSessionId}`) } },
    pollIntervalMs: 1_000_000_000,
    persist: (entries) => { persisted.length = 0; persisted.push(...entries) },
  })
  if (bridge === null) throw new Error('桥接没有装起来')
  return { bridge, persisted, removed }
}

describe('forgetHost', () => {
  it('只清这台主机的镜像：登记、进度、缓存、落盘一起干净，别的主机的不受影响', () => {
    const { bridge, persisted, removed } = harness()
    const a1 = mirrorIdOf('host-a', 's1')
    const a2 = mirrorIdOf('host-a', 's2')
    const b1 = mirrorIdOf('host-b', 's9')
    bridge.register(a1, { hostId: 'host-a', path: '/p' })
    bridge.register(a2, { hostId: 'host-a', path: '/p' })
    bridge.register(b1, { hostId: 'host-b', path: '/q' })
    expect(bridge.forgetHost('host-a')).toEqual([a1, a2])
    expect([...bridge.sessions.keys()]).toEqual([b1])
    expect(removed.sort()).toEqual([`host-a/s1`, `host-a/s2`])
    expect(persisted.map((entry) => entry.sessionId)).toEqual([b1])
    // 再清一次：没有可清的，返回空，不报错。
    expect(bridge.forgetHost('host-a')).toEqual([])
    expect(bridge.forgetHost('no-such-host')).toEqual([])
  })
})
