// 设备组网（#156）的纯逻辑：介绍凭证、被介绍方的审批收件箱、发起方的请求簿。
import { describe, expect, it } from 'vitest'
import { createIntroInbox, createIntroOutbox, INTRO_TTL_MS, mintIntro, pickPeers, verifyIntro } from '../src/host/remote-intro.js'

const secret = 'lane-secret'

describe('介绍凭证', () => {
  it('介绍人签名、指名给某台设备、五分钟内有效；篡改或过期都不认', () => {
    const token = mintIntro(secret, { to: 'dev-b', peer: 'dev-c', origin: 'http://192.168.1.9:3093', name: 'C 的 Mac', toOrigin: 'http://192.168.1.8:3092', toName: 'B' }, 1_000)
    expect(verifyIntro(secret, token, 1_000 + INTRO_TTL_MS - 1)).toEqual({
      kind: 'intro', to: 'dev-b', peer: 'dev-c', origin: 'http://192.168.1.9:3093', name: 'C 的 Mac', toOrigin: 'http://192.168.1.8:3092', toName: 'B', at: 1_000,
    })
    expect(verifyIntro(secret, token, 1_000 + INTRO_TTL_MS)).toBeNull()
    expect(verifyIntro('another-secret', token, 1_000)).toBeNull()
    expect(verifyIntro(secret, token.slice(0, -2) + 'xx', 1_000)).toBeNull()
    expect(verifyIntro(secret, 'not-a-token', 1_000)).toBeNull()
  })

  it('介绍人只把「自己够得着、且不是来问的那台」设备介绍出去', () => {
    const hosts = [
      { deviceId: 'me-on-c', laneDeviceId: 'dev-c', origin: 'http://c:3093', name: 'C', renamedAt: 5 },
      { deviceId: 'me-on-b', laneDeviceId: 'dev-b', origin: 'http://b:3092', name: 'B' },
      { deviceId: 'me-on-x', origin: 'http://x:3099', name: '旧格式的记录，没记设备 id' },
    ]
    const peers = pickPeers(hosts, 'dev-b', secret, 1_000)
    expect(peers).toHaveLength(1)
    expect(peers[0]).toMatchObject({ deviceId: 'dev-c', name: 'C', origin: 'http://c:3093' })
    expect(verifyIntro(secret, peers[0]!.intro, 1_000)).toMatchObject({ to: 'dev-b', peer: 'dev-c' })
    // 凭证里带着来问的那台设备（B）的地址与名字：被介绍方据此认发起方。
    // B 没改过名：凭证里的展示名就是它的地址。
    expect(verifyIntro(secret, peers[0]!.intro, 1_000)).toMatchObject({ toOrigin: 'http://b:3092', toName: 'http://b:3092' })
    // 来问的换成 C：清单里是 B，不含 C 自己。
    expect(pickPeers(hosts, 'dev-c', secret, 1_000).map((peer) => peer.deviceId)).toEqual(['dev-b'])
    // 最近连得上的排前面，并带上介绍人上次连上它的时间。
    const ordered = pickPeers([
      { deviceId: 'me-on-x', laneDeviceId: 'dev-x', origin: 'http://x:3099', name: 'X', lastSeen: 1 },
      { deviceId: 'me-on-c', laneDeviceId: 'dev-c', origin: 'http://c:3093', name: 'C', lastSeen: 9 },
    ], 'dev-b', secret, 1_000)
    expect(ordered.map((peer) => peer.deviceId)).toEqual(['dev-c', 'dev-x'])
    expect(ordered[0]?.lastSeen).toBe(9)
  })
})

describe('被介绍方的审批收件箱', () => {
  it('收到请求先挂起；同意后才发配对令牌，拒绝则不留可配对的东西', () => {
    const inbox = createIntroInbox({ now: () => 7, random: () => 'req-1' })
    const request = inbox.open({ from: { origin: 'http://b:3092', name: 'B', model: 'macOS' }, introducer: { origin: 'http://a:3091', name: 'A', deviceId: 'me-on-a' } })
    expect(request).toMatchObject({ id: 'req-1', state: 'pending', openedAt: 7 })
    expect(inbox.pending()).toHaveLength(1)
    expect(inbox.decide('req-1', true, 'pair-token')?.pairToken).toBe('pair-token')
    expect(inbox.pending()).toHaveLength(0)
    const other = inbox.open({ from: { origin: 'http://d:3094', name: 'D', model: '' }, introducer: { origin: 'http://a:3091', name: 'A', deviceId: 'me-on-a' } })
    expect(inbox.decide(other.id, false)?.state).toBe('rejected')
    expect(inbox.decide(other.id, true, 'late')?.state).toBe('rejected')
  })

  it('同一台设备重复请求不叠加；过期或已结案的会被清掉', () => {
    let now = 0
    const inbox = createIntroInbox({ now: () => now, random: (() => { let n = 0; return () => `req-${++n}` })() })
    const from = { origin: 'http://b:3092', name: 'B', model: '' }
    const via = { origin: 'http://a:3091', name: 'A', deviceId: 'me-on-a' }
    expect(inbox.open({ from, introducer: via }).id).toBe('req-1')
    expect(inbox.open({ from, introducer: via }).id).toBe('req-1')
    now = 11 * 60_000
    expect(inbox.prune()).toBe(1)
    expect(inbox.pending()).toEqual([])
  })
})

describe('发起方的请求簿', () => {
  it('记下向谁发过、走到哪一步；被拒后不再当成进行中', () => {
    let now = 0
    const outbox = createIntroOutbox({ now: () => now })
    const entry = outbox.open('dev-c', 'http://c:3093', 'C')
    expect(entry.state).toBe('pending')
    outbox.note('dev-c', 'req-9')
    expect(outbox.byDevice('dev-c')).toMatchObject({ requestIds: ['req-9'] })
    now = 1_000
    outbox.set('dev-c', 'rejected', '对方拒绝了')
    expect(outbox.byDevice('dev-c')).toMatchObject({ state: 'rejected', detail: '对方拒绝了' })
    expect(outbox.inFlight()).toEqual([])
    expect(outbox.byDevice('nope')).toBeUndefined()
  })
})
