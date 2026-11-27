// 出站主机：地址归一、cookie 提取、配对（注入 fetch，不出网）。
import { describe, expect, it } from 'vitest'
import {
  RemoteHostStore,
  RemoteHostPairError,
  cookieFromSetCookie,
  createMemoryRemoteHostStorage,
  normalizeHostOrigin,
  pairWithHost,
} from '../src/host/remote-hosts.js'

function jsonResponse(body: unknown, init: { status?: number, setCookie?: string } = {}): Response {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (init.setCookie !== undefined) headers.set('set-cookie', init.setCookie)
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

describe('normalizeHostOrigin', () => {
  it('去尾斜杠并保留 http(s)', () => {
    expect(normalizeHostOrigin('http://127.0.0.1:3091/')).toBe('http://127.0.0.1:3091')
    expect(normalizeHostOrigin(' https://a.example.com ')).toBe('https://a.example.com')
  })

  it('拒绝空地址与非 http(s)', () => {
    expect(() => normalizeHostOrigin('  ')).toThrow(RemoteHostPairError)
    expect(() => normalizeHostOrigin('ftp://x')).toThrow(/http\(s\)/)
  })
})

describe('cookieFromSetCookie', () => {
  it('取出 dsh_mobile_session 的值', () => {
    expect(cookieFromSetCookie('dsh_mobile_session=abc123; HttpOnly; Path=/')).toBe('abc123')
    expect(cookieFromSetCookie('other=1, dsh_mobile_session=def; Path=/')).toBe('def')
  })

  it('没有该 cookie 时返回空串', () => {
    expect(cookieFromSetCookie(null)).toBe('')
    expect(cookieFromSetCookie('other=1; Path=/')).toBe('')
  })
})

describe('pairWithHost', () => {
  it('成功时拿到 deviceId 与 cookie', async () => {
    const calls: string[] = []
    const result = await pairWithHost({
      origin: 'http://127.0.0.1:3091/',
      token: 'tok',
      name: 'MacBook B',
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(input))
        const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string }
        expect(body.token).toBe('tok')
        return jsonResponse({ ok: true, deviceId: 'dev-1' }, { setCookie: 'dsh_mobile_session=xyz; Path=/' })
      }) as typeof fetch,
    })
    expect(calls).toEqual(['http://127.0.0.1:3091/__dsh-mobile/api/pair/accept'])
    expect(result.record.deviceId).toBe('dev-1')
    expect(result.record.cookie).toBe('xyz')
    expect(result.record.origin).toBe('http://127.0.0.1:3091')
    expect(result.record.name).toBe('MacBook B')
  })

  it('令牌无效抛 invalid-token', async () => {
    await expect(pairWithHost({
      origin: 'http://x',
      token: 'bad',
      fetchImpl: (async () => jsonResponse({ error: 'invalid-token' }, { status: 403 })) as typeof fetch,
    })).rejects.toMatchObject({ code: 'invalid-token' })
  })

  it('连不上抛 unreachable', async () => {
    await expect(pairWithHost({
      origin: 'http://x',
      token: 'tok',
      fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch,
    })).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('响应缺 cookie 视为配对失败', async () => {
    await expect(pairWithHost({
      origin: 'http://x',
      token: 'tok',
      fetchImpl: (async () => jsonResponse({ ok: true, deviceId: 'dev-1' })) as typeof fetch,
    })).rejects.toMatchObject({ code: 'pair-failed' })
  })
})

describe('RemoteHostStore', () => {
  it('同 origin + 同 deviceId 覆盖更新而不是新增', () => {
    const storage = createMemoryRemoteHostStorage()
    const store = new RemoteHostStore({ storage })
    const first = store.upsert({ hostId: 'a@http://x', origin: 'http://x', deviceId: 'a', cookie: 'c1', name: 'A', pairedAt: 1, lastSeen: 1 })
    const second = store.upsert({ hostId: 'a@http://x', origin: 'http://x', deviceId: 'a', cookie: 'c2', name: 'A2', pairedAt: 1, lastSeen: 2 })
    expect(store.list()).toHaveLength(1)
    expect(second.hostId).toBe(first.hostId)
    expect(second.cookie).toBe('c2')
    expect(new RemoteHostStore({ storage }).list()[0]?.cookie).toBe('c2')
  })

  it('remove 落盘', () => {
    const storage = createMemoryRemoteHostStorage()
    const store = new RemoteHostStore({ storage })
    store.upsert({ hostId: 'h', origin: 'http://x', deviceId: 'a', cookie: 'c', name: 'A', pairedAt: 1, lastSeen: 1 })
    expect(store.remove('h')).toBe(true)
    expect(store.remove('h')).toBe(false)
    expect(new RemoteHostStore({ storage }).list()).toHaveLength(0)
  })
})
