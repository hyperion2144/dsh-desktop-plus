// 订阅租约（#152）：设备登记「我在看这条会话」后要定期续租；断线或关页后租约到期，A 侧记录随之清除。
import { describe, expect, it } from 'vitest'
import { isLeaseExpired, leaseExpiresAt, leaseRemainingMs, pruneExpiredLeases, REMOTE_WATCH_LEASE_MS, REMOTE_WATCH_RENEW_MS } from '../src/host/remote-lease.js'

describe('订阅租约', () => {
  it('租约三分钟，续租间隔是租约的三分之一：断线后最多三个间隔就被清掉，在线时总来得及续', () => {
    expect(REMOTE_WATCH_LEASE_MS).toBe(180_000)
    expect(REMOTE_WATCH_RENEW_MS).toBe(60_000)
  })

  it('到期时刻 = 现在 + 租约', () => {
    expect(leaseExpiresAt(1_000)).toBe(1_000 + REMOTE_WATCH_LEASE_MS)
  })

  it('过期判定：到了到期时刻就算过期；没有到期时刻的旧登记视为长期，不过期', () => {
    expect(isLeaseExpired(5_000, 4_999)).toBe(false)
    expect(isLeaseExpired(5_000, 5_000)).toBe(true)
    expect(isLeaseExpired(undefined, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it('清理只动已过期的，长期登记原样保留', () => {
    const entries = [{ id: 'fresh', expiresAt: 10_000 }, { id: 'old', expiresAt: 1_000 }, { id: 'forever' }]
    expect(pruneExpiredLeases(entries, 5_000).map((entry) => entry.id)).toEqual(['fresh', 'forever'])
  })

  it('剩余时间给诊断用：过期为 0，长期为 null', () => {
    expect(leaseRemainingMs(10_000, 4_000)).toBe(6_000)
    expect(leaseRemainingMs(1_000, 5_000)).toBe(0)
    expect(leaseRemainingMs(undefined, 5_000)).toBeNull()
  })
})
