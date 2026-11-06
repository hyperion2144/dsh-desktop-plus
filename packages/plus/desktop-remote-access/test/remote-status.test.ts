// #108 三态探测：每条用例只制造一种状态，确保三态互不混淆。
import { describe, expect, it } from 'vitest'
import {
  REMOTE_PROTOCOL_VERSION,
  classifyPairInfo,
  describeRemoteLink,
  formatLastSeen,
  probeRemoteHost,
  readPluginVersion,
  type RemoteLinkStatus,
} from '../src/host/remote-status.js'
import type { RemoteHostRecord } from '../src/host/remote-hosts.js'

const record: RemoteHostRecord = {
  hostId: 'dev@http://127.0.0.1:3091',
  origin: 'http://127.0.0.1:3091',
  deviceId: 'dev',
  cookie: 'abc',
  name: 'host-A',
  pairedAt: 1000,
  lastSeen: 2000,
}

/** 造一个只返回固定响应的 fetch。 */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => handler(String(input), init)) as unknown as typeof fetch
}

describe('classifyPairInfo', () => {
  it('协议版本一致即在线，并带回对端版本', () => {
    const verdict = classifyPairInfo({ version: '1.2.3', protocolVersion: REMOTE_PROTOCOL_VERSION })
    expect(verdict.state).toBe('online')
    expect(verdict.remoteVersion).toBe('1.2.3')
    expect(verdict.remoteProtocol).toBe(REMOTE_PROTOCOL_VERSION)
    expect(verdict.detail).toBeNull()
  })

  it('对端没上报协议版本按不兼容处理（禁止半可用）', () => {
    const verdict = classifyPairInfo({ version: '0.0.1' })
    expect(verdict.state).toBe('incompatible')
    expect(verdict.remoteVersion).toBe('0.0.1')
    expect(verdict.remoteProtocol).toBeNull()
    expect(verdict.retryable).toBe(false)
    expect(verdict.detail).toContain('没有上报协议版本')
  })

  it('协议版本不同按不兼容处理，并写清两侧版本与不兼容点', () => {
    const verdict = classifyPairInfo({ version: '9.9.9', protocolVersion: REMOTE_PROTOCOL_VERSION + 1 })
    expect(verdict.state).toBe('incompatible')
    expect(verdict.detail).toContain(String(REMOTE_PROTOCOL_VERSION))
    expect(verdict.detail).toContain(String(REMOTE_PROTOCOL_VERSION + 1))
    expect(verdict.detail).toContain('9.9.9')
  })
})

describe('probeRemoteHost', () => {
  it('连不上时为离线，且可重试', async () => {
    const status = await probeRemoteHost(record, {
      fetchImpl: stubFetch(() => {
        throw new Error('ECONNREFUSED')
      }),
      now: 5000,
    })
    expect(status.state).toBe('offline')
    expect(status.retryable).toBe(true)
    expect(status.detail).toContain('ECONNREFUSED')
    expect(status.lastSeen).toBe(2000)
  })

  it('对端返回 401 时为未配对，不再宣称可重试', async () => {
    const status = await probeRemoteHost(record, {
      fetchImpl: stubFetch(() => new Response('', { status: 401 })),
      now: 5000,
    })
    expect(status.state).toBe('unpaired')
    expect(status.retryable).toBe(false)
    expect(status.detail).toContain('重新配对')
  })

  it('对端在线时刷新 lastSeen', async () => {
    const status = await probeRemoteHost(record, {
      fetchImpl: stubFetch(() => Response.json({ version: '2.0.0', protocolVersion: REMOTE_PROTOCOL_VERSION })),
      now: 5000,
    })
    expect(status.state).toBe('online')
    expect(status.checkedAt).toBe(5000)
    expect(status.lastSeen).toBe(5000)
    expect(status.remoteVersion).toBe('2.0.0')
  })

  it('对端返回非 JSON 时为不兼容，而不是谎报在线', async () => {
    const status = await probeRemoteHost(record, {
      fetchImpl: stubFetch(() => new Response('<html></html>', { status: 200 })),
      now: 5000,
    })
    expect(status.state).toBe('incompatible')
    expect(status.retryable).toBe(false)
  })

  it('请求带上已配对设备会话的 cookie', async () => {
    let seenCookie = ''
    let seenUrl = ''
    await probeRemoteHost(record, {
      fetchImpl: stubFetch((url, init) => {
        seenUrl = url
        seenCookie = new Headers(init.headers ?? {}).get('cookie') ?? ''
        return Response.json({ version: '1.0.0', protocolVersion: REMOTE_PROTOCOL_VERSION })
      }),
      now: 5000,
    })
    expect(seenUrl).toBe('http://127.0.0.1:3091/__dsh-mobile/api/pair/info')
    expect(seenCookie).toBe('dsh_mobile_session=abc')
  })
})

describe('describeRemoteLink', () => {
  const base: RemoteLinkStatus = {
    hostId: record.hostId,
    state: 'online',
    checkedAt: 0,
    lastSeen: 0,
    localVersion: '1.0.0',
    localProtocol: REMOTE_PROTOCOL_VERSION,
    remoteVersion: null,
    remoteProtocol: null,
    detail: null,
    retryable: true,
  }

  it('三态各自有独立文案，互不混淆', () => {
    const online = describeRemoteLink({ ...base, state: 'online', remoteVersion: '1.0.0' })
    const offline = describeRemoteLink({ ...base, state: 'offline' })
    const unpaired = describeRemoteLink({ ...base, state: 'unpaired' })
    const incompatible = describeRemoteLink({ ...base, state: 'incompatible', detail: '协议版本不一致' })
    expect(new Set([online, offline, unpaired, incompatible]).size).toBe(4)
    expect(offline).toContain('上次可见')
    expect(unpaired).toContain('重新配对')
    expect(incompatible).toBe('协议版本不一致')
  })

  it('离线时展示可读的「上次可见」', () => {
    expect(formatLastSeen(0)).toBe('从未')
    expect(formatLastSeen(Date.now() - 30_000)).toBe('刚刚')
    expect(formatLastSeen(Date.now() - 5 * 60_000)).toBe('5 分钟前')
  })
})

describe('readPluginVersion', () => {
  it('从包清单读出与 package.json 一致的版本', () => {
    expect(readPluginVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
