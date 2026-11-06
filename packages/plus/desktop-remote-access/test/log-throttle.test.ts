// 失败日志节流（#151）：轮询每 800ms 一次，主机掉线时同一条失败会连续出现，日志不能跟着刷屏。
import { describe, expect, it } from 'vitest'
import { createFailureThrottle } from '../src/host/log-throttle.js'

describe('createFailureThrottle', () => {
  it('同一条失败：首次报告，窗口内的重复被抑制，窗口过后汇总报告一次（带上抑制了几次）', () => {
    let now = 0
    const throttle = createFailureThrottle(60_000, () => now)
    expect(throttle.report('s1', '远端设备未连接')).toBe('远端设备未连接')
    for (let i = 0; i < 10; i += 1) {
      now += 800
      expect(throttle.report('s1', '远端设备未连接')).toBeUndefined()
    }
    now += 60_000
    expect(throttle.report('s1', '远端设备未连接')).toBe('远端设备未连接（这一分钟又重复了 10 次，已抑制）')
  })

  it('失败原因变了立即报告，不等到窗口结束', () => {
    let now = 0
    const throttle = createFailureThrottle(60_000, () => now)
    expect(throttle.report('s1', '连接被拒')).toBe('连接被拒')
    now += 800
    expect(throttle.report('s1', '版本不符')).toBe('版本不符')
  })

  it('成功后清掉记录：下一次失败重新算首次', () => {
    let now = 0
    const throttle = createFailureThrottle(60_000, () => now)
    throttle.report('s1', '失败')
    throttle.clear('s1')
    now += 800
    expect(throttle.report('s1', '失败')).toBe('失败')
  })

  it('不同会话互不影响', () => {
    const throttle = createFailureThrottle(60_000, () => 0)
    expect(throttle.report('s1', '失败')).toBe('失败')
    expect(throttle.report('s2', '失败')).toBe('失败')
  })
})
