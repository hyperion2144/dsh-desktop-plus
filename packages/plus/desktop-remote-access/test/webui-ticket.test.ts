// 一次性 Web UI 票据（#150）：B 要在浏览器里打开 A 的 DSH，登录地址必须由 A 签发。
// 票据一次性、短时有效、只用于 Web UI 登录；重复使用与过期都要被拒。
import { describe, expect, it } from 'vitest'
import { createWebuiTicketStore, WEBUI_TICKET_TTL_MS, webuiRefusalMessage } from '../src/host/webui-ticket.js'

function setup() {
  let now = 1_000_000
  let sequence = 0
  const store = createWebuiTicketStore({ now: () => now, random: () => `ticket-${++sequence}` })
  return { store, advance: (ms: number) => { now += ms } }
}

describe('Web UI 票据', () => {
  it('签发的票据默认 120 秒内可兑换一次，兑换时给出签发给的设备', () => {
    const { store } = setup()
    const record = store.issue('dev-b')
    expect(record.expiresAt - 1_000_000).toBe(WEBUI_TICKET_TTL_MS)
    expect(WEBUI_TICKET_TTL_MS).toBeLessThanOrEqual(120_000)
    expect(store.redeem('ticket-1')).toEqual({ ok: true, deviceId: 'dev-b' })
  })

  it('一次性：同一张票据第二次兑换被拒', () => {
    const { store } = setup()
    store.issue('dev-b')
    expect(store.redeem('ticket-1').ok).toBe(true)
    expect(store.redeem('ticket-1')).toEqual({ ok: false, reason: 'used' })
  })

  it('过期被拒：超过有效期后兑换得到 expired，且票据随之作废', () => {
    const { store, advance } = setup()
    store.issue('dev-b')
    advance(WEBUI_TICKET_TTL_MS - 1)
    advance(1)
    expect(store.redeem('ticket-1')).toEqual({ ok: false, reason: 'expired' })
    expect(store.redeem('ticket-1')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('不认识的票据、空票据一律 invalid，不影响别的票据', () => {
    const { store } = setup()
    store.issue('dev-b')
    expect(store.redeem('')).toEqual({ ok: false, reason: 'invalid' })
    expect(store.redeem('nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(store.redeem('ticket-1').ok).toBe(true)
  })

  it('多台设备各签各的，互不串用；清理只动过期的', () => {
    const { store, advance } = setup()
    store.issue('dev-b')
    advance(60_000)
    store.issue('dev-c')
    advance(WEBUI_TICKET_TTL_MS - 60_000 + 1)
    expect(store.prune()).toBe(1)
    expect(store.redeem('ticket-1')).toEqual({ ok: false, reason: 'invalid' })
    expect(store.redeem('ticket-2').ok).toBe(true)
  })

  it('解除配对时撤销该设备的全部票据：别的设备的票据不受影响', () => {
    const { store } = setup()
    store.issue('dev-b')
    store.issue('dev-c')
    expect(store.revokeDevice('dev-b')).toBe(1)
    expect(store.redeem('ticket-1')).toEqual({ ok: false, reason: 'invalid' })
    expect(store.redeem('ticket-2').ok).toBe(true)
    expect(store.revokeDevice('dev-b')).toBe(0)
  })
})

describe('票据被拒时的提示', () => {
  it('三种原因各给一句能照着做的话，且不回显票据', () => {
    expect(webuiRefusalMessage('invalid')).toContain('设备管理')
    expect(webuiRefusalMessage('used')).toContain('已经用过')
    expect(webuiRefusalMessage('expired')).toContain('过期')
    for (const reason of ['invalid', 'used', 'expired']) expect(webuiRefusalMessage(reason)).not.toContain('ticket')
  })
})
