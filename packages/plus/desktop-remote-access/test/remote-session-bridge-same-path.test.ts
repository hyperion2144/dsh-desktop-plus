// 本机会话与远程工作区同路径时不能被当成远端会话（#107 / #151 / #153 / #156 验收中发现）：
// 两台机器上同一个仓库的检出路径一样很常见。只有镜像会话（`remote-` 前缀）才是远端会话。
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
  home = mkdtempSync(path.join(tmpdir(), 'bridge-same-path-'))
  process.env.DSH_HOME = home
})
afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

const PATH = '/users/me/proj'
const LOCAL_SESSION = 'session-local-0001'
const MIRROR = mirrorIdOf('host-a', 'session-on-a')

/**
 * 最小装配：本机有一个本地工作区和 A 登记来的远程工作区，两者同路径；A 的地址指向一个没人监听的端口，
 * 所以「转给对端」一定会失败——据此分辨一次调用走的是本机还是远端。
 */
function harness(localDirectory = true) {
  const localPrompted: string[] = []
  const localCreated: string[] = []
  const warnings: string[] = []
  const controller = {
    create: async (request: { cwd?: string, workspaceId?: string }) => { localCreated.push(request.cwd ?? ''); return { sessionId: 'session-created-locally' } },
    prompt: async (request: { sessionId: string, requestId?: string, content?: readonly { type?: string, text?: string }[] }) => { localPrompted.push(request.sessionId); return { accepted: true } },
  }
  const cwds = new Map<string, string>([[LOCAL_SESSION, PATH], [MIRROR, PATH]])
  const registry = {
    get: (id: string) => ({ id, path: PATH }),
    list: () => [{ id: 'ws-local', path: PATH }, { id: 'ws-remote', path: PATH }],
  }
  let snapshots: Array<{ header: { id: string, cwd: string } }> = []
  const bridge = installRemoteSessionBridge({
    ctx: {
      get: (name: string) => {
        if (name === 'sessionController') return controller
        if (name === 'sessions') return { get: (id: string) => ({ header: { id, cwd: cwds.get(id) } }) }
        if (name === 'workspaceRegistry') return registry
        if (name === 'sessionPersistence') return { list: async () => snapshots }
        return undefined
      },
      logger: { warn(message: string) { warnings.push(String(message)) }, info() { } },
    },
    hosts: {
      get: (id: string) => (id === 'host-a' ? { hostId: 'host-a', origin: 'http://127.0.0.1:9', cookie: 'c', deviceId: 'dev', name: 'A', pairedAt: 0, lastSeen: 0 } : undefined),
      list: () => [],
    },
    workspaces: () => [{ hostId: 'host-a', path: PATH, workspaceId: 'ws-remote' }],
    cursors: new Map(),
    materialized: new Map(),
    cache: { read: () => undefined, watermark: () => -1, append: () => undefined, remove: () => undefined },
    pollIntervalMs: 1_000_000_000,
    localDirectoryExists: () => localDirectory,
    persist: () => undefined,
  })
  if (bridge === null) throw new Error('桥接没有装起来')
  return {
    bridge, controller, localPrompted, localCreated, warnings,
    setSnapshots: (next: Array<{ header: { id: string, cwd: string } }>) => { snapshots = next },
  }
}

describe('本机会话与远程工作区同路径', () => {
  it('启动时只把镜像会话登记成远端会话；目录相同的老会话仍归本机', async () => {
    const { bridge, setSnapshots } = harness()
    setSnapshots([{ header: { id: LOCAL_SESSION, cwd: PATH } }, { header: { id: MIRROR, cwd: PATH } }])
    await bridge.hydrate()
    expect([...bridge.sessions.keys()]).toEqual([MIRROR])
  })

  it('在本机会话上发消息照常落在本机；镜像会话仍然转给对端', async () => {
    const { bridge, controller, localPrompted } = harness()
    bridge.register(MIRROR, { hostId: 'host-a', path: PATH })
    await expect(controller.prompt({ sessionId: LOCAL_SESSION, requestId: 'r1', content: [{ type: 'text', text: '你好' }] })).resolves.toEqual({ accepted: true })
    expect(localPrompted).toEqual([LOCAL_SESSION])
    await expect(controller.prompt({ sessionId: MIRROR, requestId: 'r2', content: [{ type: 'text', text: '你好' }] })).rejects.toThrow(/远端/)
    expect(localPrompted).toEqual([LOCAL_SESSION])
  })
  it('新建会话：本机有这个目录就在本机新建（带着并成同一个的远程工作区 id 也一样，页面启动时恢复当前会话就是这种）；本机没有这个目录才建在远端', async () => {
    const local = harness(true)
    await expect(local.controller.create({ cwd: PATH })).resolves.toEqual({ sessionId: 'session-created-locally' })
    await expect(local.controller.create({ cwd: PATH, workspaceId: 'ws-remote' })).resolves.toEqual({ sessionId: 'session-created-locally' })
    expect(local.localCreated).toEqual([PATH, PATH])
    expect(local.warnings.filter((message) => message.includes('host-a'))).toEqual([])
    // 本机没有这个目录：远端专属，去找对端（对端不可达，所以失败后退回本机，日志里留得下痕迹）。
    const remote = harness(false)
    await expect(remote.controller.create({ cwd: PATH, workspaceId: 'ws-remote' })).resolves.toEqual({ sessionId: 'session-created-locally' })
    expect(remote.warnings.some((message) => message.includes('host-a'))).toBe(true)
  })
})
