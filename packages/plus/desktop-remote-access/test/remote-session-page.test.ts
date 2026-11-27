// 事件分页（#107）：A 侧按 seq 游标切页，B 侧按水位续传。一次性全量 read 只留给旧客户端兼容。
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createRemoteAccessService } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'
import type { RemoteHostRecord } from '../src/host/remote-hosts.js'
import {
  SESSION_PAGE_DEFAULT,
  SESSION_PAGE_MAX,
  clampPageLimit,
  fetchRemoteEventPage,
  paginateSessionHeaders,
  sliceEventPage,
} from '../src/host/remote-sessions.js'
import type { RemoteSessionEvent } from '../src/host/remote-sessions.js'

const EVENTS: RemoteSessionEvent[] = Array.from({ length: 7 }, (_, seq) => ({
  type: 'assistant/message', seq, time: 10 + seq, data: { text: `m${String(seq)}` }, surfaceOp: 'append',
}))

function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

describe('sliceEventPage（A 侧按 seq 游标切页）', () => {
  it('从水位之后取 limit 条，并报告远端是否还有更晚的事件', () => {
    expect(sliceEventPage(EVENTS, -1, 3)).toEqual({ events: EVENTS.slice(0, 3), watermark: 6, hasMore: true })
    expect(sliceEventPage(EVENTS, 2, 3)).toEqual({ events: EVENTS.slice(3, 6), watermark: 6, hasMore: true })
    expect(sliceEventPage(EVENTS, 5, 3)).toEqual({ events: [EVENTS[6]], watermark: 6, hasMore: false })
  })

  it('已经追平水位：空页，且没有更多', () => {
    expect(sliceEventPage(EVENTS, 6, 3)).toEqual({ events: [], watermark: 6, hasMore: false })
  })

  it('输入乱序也按 seq 升序返回', () => {
    expect(sliceEventPage([...EVENTS].reverse(), -1, 2).events.map((event) => event.seq)).toEqual([0, 1])
  })

  it('空日志：水位是 -1', () => {
    expect(sliceEventPage([], -1, 3)).toEqual({ events: [], watermark: -1, hasMore: false })
  })
})

describe('clampPageLimit', () => {
  it('缺省 500，上限 5000，下限 1，非法值回落缺省', () => {
    expect(clampPageLimit(undefined)).toBe(SESSION_PAGE_DEFAULT)
    expect(clampPageLimit(10)).toBe(10)
    expect(clampPageLimit('120')).toBe(120)
    expect(clampPageLimit(0)).toBe(1)
    expect(clampPageLimit(-5)).toBe(1)
    expect(clampPageLimit('abc')).toBe(SESSION_PAGE_DEFAULT)
    expect(clampPageLimit(999999)).toBe(SESSION_PAGE_MAX)
  })
})

describe('paginateSessionHeaders', () => {
  const headers = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, cwd: '/p' }))

  it('不带分页参数时返回全部（兼容旧客户端），并带上总数', () => {
    expect(paginateSessionHeaders(headers)).toEqual({ sessions: headers, total: 5 })
  })

  it('按 offset / limit 切页，总数不变', () => {
    expect(paginateSessionHeaders(headers, 1, 2)).toEqual({ sessions: [headers[1], headers[2]], total: 5 })
  })
})

describe('fetchRemoteEventPage（B 侧拉一页）', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.close(() => resolve()) })))
    servers.length = 0
  })

  const fakeHost = async (status: number, body: unknown, requests: unknown[] = []): Promise<RemoteHostRecord> => {
    const server = http.createServer((req, res) => {
      let text = ''
      req.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      req.on('end', () => {
        requests.push({ url: req.url, body: JSON.parse(text) as unknown })
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      })
    })
    servers.push(server)
    const port = await listen(server)
    return { hostId: 'dev-a', origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a', cookie: 'c', name: '', pairedAt: 0, lastSeen: 0 }
  }

  it('走 lane 的 session.page 路由，请求带 afterSeq 与 limit，响应原样返回', async () => {
    const page = { header: { id: 's1', cwd: '/p' }, events: EVENTS.slice(0, 2), watermark: 6, hasMore: true }
    const requests: unknown[] = []
    const host = await fakeHost(200, page, requests)
    expect(await fetchRemoteEventPage(host, 's1', -1, 200)).toEqual(page)
    expect(requests).toEqual([{ url: '/__dsh-mobile/api/remote/session.page', body: { sessionId: 's1', afterSeq: -1, limit: 200 } }])
  })

  it('远端没有这条会话（404）时返回 undefined', async () => {
    const host = await fakeHost(404, { error: 'not-found' })
    expect(await fetchRemoteEventPage(host, 'gone', -1)).toBeUndefined()
  })

  it('其它失败如实抛错，不假装成空页', async () => {
    const host = await fakeHost(500, { error: 'read-failed' })
    await expect(fetchRemoteEventPage(host, 's1', -1)).rejects.toThrow(/远端事件分页失败/)
  })
})

describe('A 侧 lane 路由 /api/remote/session.page', () => {
  const servers: http.Server[] = []
  const services: Array<{ close: () => Promise<unknown> }> = []

  afterEach(async () => {
    await Promise.all(services.map((service) => service.close()))
    services.length = 0
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => { server.close(() => resolve()) })))
    servers.length = 0
  })

  async function boot(readLog: (id: string) => Promise<unknown>): Promise<number> {
    const upstream = http.createServer((_req, res) => { res.writeHead(200); res.end('ok') })
    servers.push(upstream)
    const svc = createRemoteAccessService({
      storage: createMemoryStorage(),
      upstreamPort: await listen(upstream),
      platform: 'darwin',
      sessions: { listHeaders: async () => [], readLog: readLog as never },
    })
    const port = await svc.listen()
    services.push(svc)
    return port
  }

  const post = async (port: number, body: unknown): Promise<{ status: number, body: Record<string, unknown> }> => {
    const response = await fetch(`http://127.0.0.1:${String(port)}/__dsh-mobile/api/remote/session.page`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }

  it('按游标返回一页与水位：先 0..2，再从 2 之后接着取', async () => {
    const port = await boot(async (id) => (id === 's1' ? { header: { id: 's1', cwd: '/p', createdAt: 5 }, events: [...EVENTS].reverse() } : undefined))
    const first = await post(port, { sessionId: 's1', limit: 3 })
    expect(first.status).toBe(200)
    expect((first.body.events as RemoteSessionEvent[]).map((event) => event.seq)).toEqual([0, 1, 2])
    expect(first.body).toMatchObject({ watermark: 6, hasMore: true, header: { id: 's1', createdAt: 5 } })
    const second = await post(port, { sessionId: 's1', afterSeq: 2, limit: 3 })
    expect((second.body.events as RemoteSessionEvent[]).map((event) => event.seq)).toEqual([3, 4, 5])
    const tail = await post(port, { sessionId: 's1', afterSeq: 5 })
    expect((tail.body.events as RemoteSessionEvent[]).map((event) => event.seq)).toEqual([6])
    expect(tail.body).toMatchObject({ watermark: 6, hasMore: false })
  })

  it('游标非法 → 400，不去读日志', async () => {
    let reads = 0
    const port = await boot(async () => { reads += 1; return undefined })
    expect((await post(port, { sessionId: 's1', afterSeq: 'abc' })).status).toBe(400)
    expect((await post(port, { sessionId: '', afterSeq: -1 })).status).toBe(400)
    expect(reads).toBe(0)
  })

  it('会话不存在 → 404 not-found', async () => {
    const port = await boot(async () => undefined)
    const result = await post(port, { sessionId: 'gone', afterSeq: -1 })
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'not-found' })
  })
})
