import { describe, expect, it } from 'vitest'
import { shouldHideShareMenu } from '../client/share-menu-visibility.js'

describe('会话菜单的分享入口可见性', () => {
  it('远程会话必须隐藏：本体在别的设备上，分享没有语义', () => {
    const remote = new Set(['session-remote-1'])
    expect(shouldHideShareMenu('session-remote-1', remote)).toBe(true)
  })

  it('本机会话必须显示', () => {
    const remote = new Set(['session-remote-1'])
    expect(shouldHideShareMenu('session-local-1', remote)).toBe(false)
  })

  it('远程会话集合尚未就绪时按本机处理，不误隐藏', () => {
    expect(shouldHideShareMenu('session-any', undefined)).toBe(false)
    expect(shouldHideShareMenu('session-any', new Set())).toBe(false)
  })

  it('会话标识缺失时不隐藏', () => {
    const remote = new Set(['session-remote-1'])
    expect(shouldHideShareMenu('', remote)).toBe(false)
  })
})
