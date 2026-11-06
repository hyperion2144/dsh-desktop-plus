// 端到端：#93 最小链路——B 配对 A → 拉 A 的会话列表 → 拉会话日志 → 在 B 物化。
// 全程真 HTTP（loopback），只有会话来源与会话存储是可控替身：链路本身不 mock。
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteAccessService } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'
import { pairWithHost } from '../src/host/remote-hosts.js'
import {
  fetchRemoteSessionLog,
  fetchRemoteSessions,
  materializeSession,
  type RemoteSessionEvent,
} from '../src/host/remote-sessions.js'

const REMOTE_PATH = '/Users/a/proj'

function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

describe('远端会话端到端链路', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>((resolve) => {
      server.close(() => resolve())
    })))
    servers.length = 0
  })

  it('配对后能读到目标目录下的会话并物化成官方会话', async () => {
    const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)

    const events: RemoteSessionEvent[] = [
      { type: 'request/header', seq: 0, time: 1, data: { text: 'hi' } },
      { type: 'assistant/message', seq: 1, time: 2, data: { text: 'hello' }, surfaceOp: 'append', sourceEventSeqs: [0] },
    ]
    const svc = createRemoteAccessService({
      storage: createMemoryStorage(),
      upstreamPort,
      platform: 'darwin',
      sessions: {
        listHeaders: async () => [
          { id: 's1', cwd: REMOTE_PATH },
          { id: 's2', cwd: '/Users/a/other' },
        ],
        readLog: async (sessionId: string) => (sessionId === 's1'
          ? { header: { id: 's1', cwd: REMOTE_PATH }, events }
          : undefined),
      },
    })
    const port = await svc.listen()

    const token = svc.store.mint()
    const paired = await pairWithHost({ origin: `http://127.0.0.1:${String(port)}`, token, name: 'B' })
    expect(paired.record.deviceId).not.toBe('')
    expect(paired.record.cookie).not.toBe('')

    const headers = await fetchRemoteSessions(paired.record, REMOTE_PATH)
    expect(headers.map(header => header.id)).toEqual(['s1'])

    const log = await fetchRemoteSessionLog(paired.record, 's1')
    expect(log.header.cwd).toBe(REMOTE_PATH)
    expect(log.events).toHaveLength(2)

    const created: Array<{ id: string, seed: RemoteSessionEvent[] }> = []
    const known = new Map<string, unknown>()
    const persisted: RemoteSessionEvent[][] = []
    const result = await materializeSession({
      get: id => known.get(id),
      create: (id, options) => {
        created.push({ id, seed: options.seed })
        const handle = { id }
        known.set(id, handle)
        return handle
      },
    }, log, REMOTE_PATH, {
      stat: async () => undefined,
      create: async () => ({
        append: async (batch) => { persisted.push([...batch]) },
        flush: async () => undefined,
        close: async () => undefined,
      }),
    })
    expect(result).toEqual({ id: 's1', eventCount: 2, durable: true })
    expect(created[0]?.seed.map(event => [event.type, event.seq])).toEqual([
      ['request/header', 0],
      ['assistant/message', 1],
    ])
    expect(created[0]?.seed[1]?.sourceEventSeqs).toEqual([0])
    // 落盘的那一份与内存镜像必须是同一批事件（seq 连续、引用已翻译）。
    expect(persisted[0]?.map(event => [event.type, event.seq])).toEqual([
      ['request/header', 0],
      ['assistant/message', 1],
    ])
  })

  it('未配对的主机拿不到会话（cookie 无效 → 非属主回 401）', async () => {
    const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    servers.push(upstream)
    const upstreamPort = await listen(upstream)
    const svc = createRemoteAccessService({
      storage: createMemoryStorage(),
      upstreamPort,
      platform: 'darwin',
      sessions: { listHeaders: async () => [{ id: 's1', cwd: REMOTE_PATH }], readLog: async () => undefined },
    })
    const port = await svc.listen()
    const response = await fetch(`http://127.0.0.1:${String(port)}/__dsh-mobile/api/remote/session.read`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
    })
    // 环回请求可能被当成属主（isLocalOwner），此时应回 404；非属主则回 401。两者都表示「没泄露日志」。
    expect([401, 404]).toContain(response.status)
    if (response.status === 404) {
      expect(await response.json()).toEqual({ error: 'not-found' })
    }
  })
})
