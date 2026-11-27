// 探测结果按主机的短期缓存（#156）：同一次界面轮询里同一个主机只探一次。
import { describe, expect, it } from 'vitest'
import { createProbeCache } from '../src/host/remote-status.js'

describe('探测结果缓存', () => {
  it('有效期内的并发与重复调用共用同一次探测；过期后重新探测', async () => {
    let now = 0
    let calls = 0
    const probe = createProbeCache(async (key: string) => { calls += 1; return `${key}@${String(calls)}` }, 3_000, () => now)
    const first = await Promise.all([probe('a'), probe('a'), probe('a')])
    expect(first).toEqual(['a@1', 'a@1', 'a@1'])
    expect(await probe('a')).toBe('a@1')
    // 别的主机各自探测。
    expect(await probe('b')).toBe('b@2')
    now = 2_999
    expect(await probe('a')).toBe('a@1')
    now = 3_000
    expect(await probe('a')).toBe('a@3')
    expect(calls).toBe(3)
  })

  it('失败的探测不缓存：下一次照常重试', async () => {
    let attempts = 0
    const probe = createProbeCache(async () => { attempts += 1; if (attempts === 1) throw new Error('连不上'); return 'ok' }, 60_000, () => 0)
    await expect(probe('a')).rejects.toThrow('连不上')
    await expect(probe('a')).resolves.toBe('ok')
    expect(attempts).toBe(2)
  })
})
