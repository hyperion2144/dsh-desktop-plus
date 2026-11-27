// 镜像「对方已删除」的确认（#107 / #154）：要连续两次、间隔足够久都得到同一结论才算。
import { describe, expect, it } from 'vitest'
import { createGoneConfirm } from '../src/host/mirror-gone.js'

describe('对方已删除的确认', () => {
  it('一次「不在清单里」不算；间隔够久的第二次才算', () => {
    let now = 0
    const confirm = createGoneConfirm({ gapMs: 10_000, now: () => now })
    expect(confirm('s1', 'absent')).toBe(false)
    now = 4_000
    expect(confirm('s1', 'absent')).toBe(false)
    now = 10_000
    expect(confirm('s1', 'absent')).toBe(true)
    // 算完就清：下一条会话从零开始计。
    expect(confirm('s2', 'absent')).toBe(false)
  })

  it('中途又出现在清单里、或清单问不到：重新计，不拿旧结论凑数', () => {
    let now = 0
    const confirm = createGoneConfirm({ gapMs: 10_000, now: () => now })
    expect(confirm('s1', 'absent')).toBe(false)
    now = 6_000
    expect(confirm('s1', 'present')).toBe(false)
    now = 15_000
    expect(confirm('s1', 'absent')).toBe(false)
    now = 20_000
    expect(confirm('s1', 'unknown')).toBe(false)
    now = 40_000
    expect(confirm('s1', 'absent')).toBe(false)
    now = 50_000
    expect(confirm('s1', 'absent')).toBe(true)
  })

  it('问不到、还在清单里：一律不算删除', () => {
    const confirm = createGoneConfirm({ gapMs: 0, now: () => 0 })
    expect(confirm('s1', 'unknown')).toBe(false)
    expect(confirm('s1', 'present')).toBe(false)
  })
})
