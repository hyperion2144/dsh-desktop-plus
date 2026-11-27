// 远端一元调用的只读闸门（spec #103 重写版，P0）。
// callRemote 是所有「以官方 RPC 形式调用 A」的唯一出口：写类调用必须在这里被挡下，
// 既不发出请求，也不留给上层各处自己判断——漏一处就会把写操作打到 A 上。
import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { answerRemoteInteraction, callRemote, forkRemoteBranch, pushRemoteBranch, RemoteRpcError, requestRemoteWebuiUrl, unwatchRemoteSession, watchRemoteSession } from '../src/host/remote-rpc.js'
import type { RemoteHostRecord } from '../src/host/remote-hosts.js'

function listen(server: http.Server): Promise<number> {
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

describe('callRemote 的只读镜像模式闸门', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.map(server => new Promise<void>((resolve) => {
      server.close(() => resolve())
    })))
    servers.length = 0
  })

  /** 一台假主机：记录收到的每个请求，并对任何一元调用回成功。 */
  async function fakeHost(): Promise<{ host: RemoteHostRecord, requests: string[] }> {
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      req.on('end', () => {
        const rpcId = (JSON.parse(body || '{}') as { rpcId?: string }).rpcId
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: { data: 'ok' } } }))
      })
    })
    servers.push(server)
    const port = await listen(server)
    const host: RemoteHostRecord = {
      hostId: 'dev-a', origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a',
      cookie: 'session-cookie', name: '', pairedAt: 0, lastSeen: 0,
    }
    return { host, requests }
  }

  it('写开关已打开（#151 交互代理）：写类调用照常发往远端，由 A 执行', async () => {
    const { host, requests } = await fakeHost()
    for (const endpoint of ['session/prompt', 'session/cancel', 'actionCards/act']) {
      await expect(callRemote(host, endpoint, { request: {} }), endpoint).resolves.toEqual({ data: 'ok' })
    }
    expect(requests).toEqual(['POST /api/session/prompt', 'POST /api/session/cancel', 'POST /api/actionCards/act'])
  })

  it('只读镜像模式下写类调用被拒，且不向远端发出任何请求', async () => {
    const { host, requests } = await fakeHost()
    for (const endpoint of ['session/prompt', 'session/cancel', 'session/create', 'workspace/create', 'terminal/create']) {
      await expect(callRemote(host, endpoint, { request: {} }, false), endpoint).rejects.toMatchObject({ name: 'RemoteRpcError', code: 'remote-readonly' })
    }
    expect(requests).toEqual([])
  })

  it('只读模式下拒绝原因对用户可读：说清是哪一步、该去哪台机器做', async () => {
    const { host } = await fakeHost()
    const error = await callRemote(host, 'session/prompt', { request: {} }, false).catch((caught: unknown) => caught) as RemoteRpcError
    expect(error.message).toBe('远程会话是只读镜像，发送消息请在设备本机上操作')
  })

  it('只读调用照常发往远端', async () => {
    const { host, requests } = await fakeHost()
    const value = await callRemote(host, 'session/attachment', { request: { sessionId: 's1' } })
    expect(value).toEqual({ data: 'ok' })
    expect(requests).toEqual(['POST /api/session/attachment'])
  })
})

describe('数据面调用：按会话订阅与交互回答', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => { server.close(() => resolve()) })))
  })

  /** 一台假主机：记录请求行与请求体；交互回答按请求号决定收不收。 */
  async function fakeLane(accept: (requestId: string) => boolean, status = 200): Promise<{ host: RemoteHostRecord, calls: Array<{ line: string, body: Record<string, unknown> }> }> {
    const calls: Array<{ line: string, body: Record<string, unknown> }> = []
    const server = http.createServer((req, res) => {
      let text = ''
      req.on('data', (chunk: Buffer) => { text += chunk.toString('utf8') })
      req.on('end', () => {
        const body = JSON.parse(text || '{}') as Record<string, unknown>
        calls.push({ line: `${req.method} ${req.url ?? ''}`, body })
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: status === 200, accepted: accept(String(body['requestId'] ?? '')) }))
      })
    })
    servers.push(server)
    const port = await listen(server)
    return {
      calls,
      host: { hostId: 'dev-a', origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a', cookie: 'session-cookie', name: '', pairedAt: 0, lastSeen: 0 },
    }
  }

  it('订阅与退订走保留命名空间，带上远端会话 id（订阅顺带记下目录）', async () => {
    const { host, calls } = await fakeLane(() => true)
    await watchRemoteSession(host, 's1', '/Users/a/proj')
    await unwatchRemoteSession(host, 's1')
    expect(calls).toEqual([
      { line: 'POST /__dsh-mobile/api/remote/session.watch', body: { sessionId: 's1', path: '/Users/a/proj' } },
      { line: 'POST /__dsh-mobile/api/remote/session.unwatch', body: { sessionId: 's1' } },
    ])
  })

  it('交回答案：A 收下为 true；A 那边已经落定（本地界面先答了、超时）为 false', async () => {
    const { host, calls } = await fakeLane((requestId) => requestId === 'question-1')
    expect(await answerRemoteInteraction(host, { type: 'question', requestId: 'question-1', answer: { answers: [{ id: 'q', selected: ['猫'] }] } })).toBe(true)
    expect(await answerRemoteInteraction(host, { type: 'approval', requestId: 'approval-9', outcome: 'rejected' })).toBe(false)
    expect(calls.map((call) => call.line)).toEqual(['POST /__dsh-mobile/api/remote/interaction.answer', 'POST /__dsh-mobile/api/remote/interaction.answer'])
    expect(calls[0]?.body).toEqual({ type: 'question', requestId: 'question-1', answer: { answers: [{ id: 'q', selected: ['猫'] }] } })
  })

  it('向 A 要「在浏览器打开它的 DSH」的地址：走 A 的数据面，原样带回 A 签发的地址；A 没给地址就报错', async () => {
    let body = '{"ok":true,"url":"http://10.0.0.5:3091/__dsh-mobile/webui?ticket=t1","expiresInMs":120000}'
    const lines: string[] = []
    const server = http.createServer((req, res) => {
      lines.push(`${req.method} ${req.url ?? ''}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    })
    servers.push(server)
    const port = await listen(server)
    const host: RemoteHostRecord = { hostId: 'dev-a', origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a', cookie: 'c', name: '', pairedAt: 0, lastSeen: 0 }
    expect(await requestRemoteWebuiUrl(host)).toBe('http://10.0.0.5:3091/__dsh-mobile/webui?ticket=t1')
    expect(lines).toEqual(['POST /__dsh-mobile/api/remote/webui-ticket'])
    body = '{"ok":true,"url":""}'
    await expect(requestRemoteWebuiUrl(host)).rejects.toMatchObject({ name: 'RemoteRpcError', code: 'bad-response' })
  })

  it('回推与另起一条：走 A 的数据面，原样带回设备的答复；另起一条没拿到新会话 id 就报错', async () => {
    let body = '{"ok":false,"reason":"diverged","message":"设备上的会话又前进了","exits":["keep-local","fork-on-device"]}'
    const lines: string[] = []
    const server = http.createServer((req, res) => {
      lines.push(`${req.method} ${req.url ?? ''}`)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
    })
    servers.push(server)
    const port = await listen(server)
    const host: RemoteHostRecord = { hostId: 'dev-a', origin: `http://127.0.0.1:${String(port)}`, deviceId: 'dev-a', cookie: 'c', name: '', pairedAt: 0, lastSeen: 0 }
    expect(await pushRemoteBranch(host, { sessionId: 'session-s1', afterSeq: 9, events: [] })).toMatchObject({ ok: false, reason: 'diverged', exits: ['keep-local', 'fork-on-device'] })
    body = '{"ok":false}'
    await expect(forkRemoteBranch(host, { cwd: '/p', events: [] })).rejects.toMatchObject({ name: 'RemoteRpcError', code: 'bad-response' })
    body = '{"ok":true,"sessionId":"session-new"}'
    expect(await forkRemoteBranch(host, { cwd: '/p', events: [] })).toBe('session-new')
    expect(lines).toEqual(['POST /__dsh-mobile/api/remote/session.push', 'POST /__dsh-mobile/api/remote/session.fork', 'POST /__dsh-mobile/api/remote/session.fork'])
  })

  it('A 拒绝时抛 RemoteRpcError，不把失败当成「已收下」', async () => {
    const { host } = await fakeLane(() => true, 401)
    await expect(watchRemoteSession(host, 's1')).rejects.toMatchObject({ name: 'RemoteRpcError', code: 'transport' })
  })
})
