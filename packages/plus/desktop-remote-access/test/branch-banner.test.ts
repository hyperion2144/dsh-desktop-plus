// 会话接管的横幅模型（#154 / #155）：接管入口只在设备离线时出现；分支标明出处，设备恢复后可回推，被拒时给出出口。
import { describe, expect, it } from 'vitest'
import { branchBannerModel } from '../client/branch-banner.js'

const label = '本地分支（来自 A 的 Mac / 改登录页，自 seq 9）'

describe('会话接管横幅', () => {
  it('镜像会话 + 设备离线：说明原因并给出「接管为本地分支」', () => {
    const model = branchBannerModel({ kind: 'mirror', state: 'offline', reason: '设备离线 · 上次可见 刚刚', canTakeover: true, message: '' })
    expect(model?.kind).toBe('mirror')
    expect(model?.text).toContain('设备离线：设备离线 · 上次可见 刚刚')
    expect(model?.actions).toEqual([{ id: 'takeover', label: '接管为本地分支' }])
  })

  it('设备在线、未配对、版本不符：没有入口，也不显示横幅', () => {
    for (const state of ['online', 'unpaired', 'incompatible']) {
      expect(branchBannerModel({ kind: 'mirror', state, reason: 'x', canTakeover: false, message: '不用接管' })).toBeNull()
    }
  })

  it('本地分支：设备离线时只说明恢复后可回推，没有动作', () => {
    const model = branchBannerModel({ kind: 'branch', label, push: { state: 'offline', message: '设备不可达' } })
    expect(model).toEqual({ kind: 'branch', text: `${label}。设备离线，恢复后可以回推。`, actions: [] })
    expect(branchBannerModel({ kind: 'branch', label: '' })).toBeNull()
  })

  it('设备恢复：给出「回推到设备」', () => {
    const model = branchBannerModel({ kind: 'branch', label, push: { state: 'ready' } })
    expect(model?.actions).toEqual([{ id: 'push', label: '回推到设备' }])
    expect(model?.text).toContain('可以把分支里的新内容回推回去')
  })

  it('回推被拒且带出口：说明原因，并给出「保持本地」「在设备上另起一条」', () => {
    const model = branchBannerModel({ kind: 'branch', label, push: { state: 'ready' } }, { message: '设备上的会话在分叉点之后又前进了，不会自动合并', exits: ['keep-local', 'fork-on-device'] })
    expect(model?.text).toBe(`${label}。设备上的会话在分叉点之后又前进了，不会自动合并`)
    expect(model?.actions).toEqual([{ id: 'keep', label: '保持本地' }, { id: 'fork', label: '在设备上另起一条' }])
  })

  it('已保持本地或已回推过：只标明出处，不再提回推', () => {
    expect(branchBannerModel({ kind: 'branch', label, push: { state: 'kept', message: 'x' } })).toEqual({ kind: 'branch', text: label, actions: [] })
    expect(branchBannerModel({ kind: 'branch', label, push: { state: 'pushed', message: 'x' } })?.actions).toEqual([])
  })

  it('不是镜像也不是分支：没有横幅', () => {
    expect(branchBannerModel(null)).toBeNull()
    expect(branchBannerModel(undefined)).toBeNull()
  })

  it('离线但没有给出原因时，补一句兜底说明', () => {
    expect(branchBannerModel({ kind: 'mirror', state: 'offline', canTakeover: true })?.text).toContain('设备不可达')
  })
})
