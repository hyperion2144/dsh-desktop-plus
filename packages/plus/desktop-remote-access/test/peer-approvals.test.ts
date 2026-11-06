// 设备组网的界面模型（#156）：审批卡的说法与动作、同组设备条目的状态。
import { describe, expect, it } from 'vitest'
import { peerApprovalModel, peerGroupState } from '../client/peer-approvals.js'

describe('被介绍方的审批卡', () => {
  it('写明是谁、经谁介绍，并只给「拒绝」「同意」两个动作', () => {
    const model = peerApprovalModel({ id: 'req-1', from: { origin: 'http://b:3092', name: 'B 的 Mac', model: 'macOS' }, introducer: { origin: 'http://a:3091', name: 'A 实例', deviceId: 'dev-a' } })
    expect(model?.text).toBe('设备「B 的 Mac」（经 A 实例 介绍）请求与你配对。')
    expect(model?.actions).toEqual([{ id: 'reject', label: '拒绝' }, { id: 'approve', label: '同意' }])
    expect(model?.detail).toContain('拒绝则对方什么也拿不到')
  })

  it('对方没报名字就用地址；没有请求号就不是一张卡', () => {
    expect(peerApprovalModel({ id: 'req-2', from: { origin: 'http://b:3092' }, introducer: {} })?.text).toBe('设备「http://b:3092」请求与你配对。')
    expect(peerApprovalModel({ id: '', from: {}, introducer: {} })).toBeNull()
    expect(peerApprovalModel(null)).toBeNull()
  })
})

describe('同组设备条目的状态', () => {
  it('已配对 / 等待确认 / 失败带原因 / 过期可重来 / 可请求', () => {
    expect(peerGroupState({ paired: true })).toEqual({ kind: 'paired', text: '已配对' })
    expect(peerGroupState({ paired: false, request: 'pending' })).toEqual({ kind: 'pending', text: '等待对方确认…' })
    expect(peerGroupState({ paired: false, request: 'failed', detail: '连不上 C：fetch failed' })).toEqual({ kind: 'failed', text: '连不上 C：fetch failed' })
    expect(peerGroupState({ paired: false, request: 'expired' }).kind).toBe('expired')
    expect(peerGroupState({ paired: false, request: null })).toEqual({ kind: 'idle', text: '' })
  })
})
