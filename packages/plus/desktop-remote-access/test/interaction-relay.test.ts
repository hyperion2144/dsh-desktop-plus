// 交互中继（#151）：A 上的提问 / 审批交给已配对设备上的用户回答——帧的校验与待回答登记。
import { describe, expect, it } from 'vitest'
import { InteractionHub, parseInteractionAnswer, parseInteractionFrame } from '../src/host/interaction-relay.js'

describe('parseInteractionFrame', () => {
  it('提问帧：带上问题列表，原样通过', () => {
    const frame = parseInteractionFrame({ type: 'question', requestId: 'r1', sessionId: 's1', questions: [{ id: 'q', header: 'h', question: '猫还是狗？', options: [{ label: '猫' }, { label: '狗' }] }] })
    expect(frame).toEqual({ type: 'question', requestId: 'r1', sessionId: 's1', questions: [{ id: 'q', header: 'h', question: '猫还是狗？', options: [{ label: '猫' }, { label: '狗' }] }] })
  })

  it('审批帧：工具名必填，调用标识与原因可省', () => {
    expect(parseInteractionFrame({ type: 'approval', requestId: 'r2', sessionId: 's1', toolName: 'shell' })).toEqual({ type: 'approval', requestId: 'r2', sessionId: 's1', toolName: 'shell' })
    expect(parseInteractionFrame({ type: 'approval', requestId: 'r2', sessionId: 's1', toolName: 'shell', callId: 'c1', reason: '要写文件' }))
      .toEqual({ type: 'approval', requestId: 'r2', sessionId: 's1', toolName: 'shell', callId: 'c1', reason: '要写文件' })
  })

  it('落定帧：带原因', () => {
    expect(parseInteractionFrame({ type: 'settled', requestId: 'r1', reason: 'answered' })).toEqual({ type: 'settled', requestId: 'r1', reason: 'answered' })
    expect(parseInteractionFrame({ type: 'settled', requestId: 'r1' })).toEqual({ type: 'settled', requestId: 'r1', reason: 'closed' })
  })

  it('问题的补充说明、多选标记与呈现意图原样带给设备', () => {
    const frame = parseInteractionFrame({ type: 'question', requestId: 'r1', sessionId: 's1', questions: [{ id: 'q', question: '选哪些？', detail: '可多选', multiSelect: true, intent: { kind: 'plan-review', approve: '同意' } }] })
    expect(frame?.type === 'question' ? frame.questions[0] : undefined).toMatchObject({ id: 'q', detail: '可多选', multiSelect: true, intent: { kind: 'plan-review', approve: '同意' } })
  })

  it('来自网络的数据不可信：缺字段、类型不对、问题列表为空一律丢弃', () => {
    expect(parseInteractionFrame(undefined)).toBeUndefined()
    expect(parseInteractionFrame('question')).toBeUndefined()
    expect(parseInteractionFrame({ type: 'question', requestId: '', sessionId: 's1', questions: [{ id: 'q' }] })).toBeUndefined()
    expect(parseInteractionFrame({ type: 'question', requestId: 'r1', sessionId: 's1', questions: [] })).toBeUndefined()
    expect(parseInteractionFrame({ type: 'question', requestId: 'r1', sessionId: 's1', questions: 'q' })).toBeUndefined()
    expect(parseInteractionFrame({ type: 'approval', requestId: 'r1', sessionId: 's1' })).toBeUndefined()
    expect(parseInteractionFrame({ type: 'unknown', requestId: 'r1' })).toBeUndefined()
    expect(parseInteractionFrame({ type: 'settled', requestId: 'r1', reason: 'whatever' })).toBeUndefined()
  })
})

describe('parseInteractionAnswer', () => {
  it('提问回答：每条答案带所属问题的 id', () => {
    expect(parseInteractionAnswer({ type: 'question', requestId: 'r1', answer: { answers: [{ id: 'q', selected: ['猫'] }] } }))
      .toEqual({ type: 'question', requestId: 'r1', answer: { answers: [{ id: 'q', selected: ['猫'] }] } })
  })

  it('自由文本放在 custom；没选选项时 selected 是空数组（跳过就是这么编码的）', () => {
    expect(parseInteractionAnswer({ type: 'question', requestId: 'r1', answer: { answers: [{ id: 'q', custom: '都行' }, { id: 'q2' }] } }))
      .toEqual({ type: 'question', requestId: 'r1', answer: { answers: [{ id: 'q', selected: [], custom: '都行' }, { id: 'q2', selected: [] }] } })
  })

  it('审批回答：远端只能「允许一次」或「拒绝」——取消与不可用是本机取消时的结果，不接受设备替本机宣布', () => {
    expect(parseInteractionAnswer({ type: 'approval', requestId: 'r1', outcome: 'allowed-once' })).toEqual({ type: 'approval', requestId: 'r1', outcome: 'allowed-once' })
    expect(parseInteractionAnswer({ type: 'approval', requestId: 'r1', outcome: 'rejected' })).toEqual({ type: 'approval', requestId: 'r1', outcome: 'rejected' })
    for (const outcome of ['cancelled', 'unavailable', 'always', '']) {
      expect(parseInteractionAnswer({ type: 'approval', requestId: 'r1', outcome })).toBeUndefined()
    }
  })

  it('来自网络的数据不可信：缺请求号、答案列表为空、答案缺 id 一律丢弃', () => {
    expect(parseInteractionAnswer(undefined)).toBeUndefined()
    expect(parseInteractionAnswer({ type: 'question', requestId: 'r1', answer: { answers: [] } })).toBeUndefined()
    expect(parseInteractionAnswer({ type: 'question', requestId: 'r1', answer: { answers: [{ selected: ['猫'] }] } })).toBeUndefined()
    expect(parseInteractionAnswer({ type: 'question', answer: { answers: [{ id: 'q' }] } })).toBeUndefined()
    expect(parseInteractionAnswer({ type: 'nope', requestId: 'r1' })).toBeUndefined()
  })
})

describe('InteractionHub', () => {
  it('登记一次待回答的中继：设备交回答案后，等待方拿到它', async () => {
    const hub = new InteractionHub()
    const pending = hub.open('question', 's1')
    expect(hub.size).toBe(1)
    expect(hub.settle({ type: 'question', requestId: pending.requestId, answer: { answers: [{ id: 'q', selected: ['猫'] }] } })).toBe(true)
    expect(await pending.answer).toEqual({ type: 'question', requestId: pending.requestId, answer: { answers: [{ id: 'q', selected: ['猫'] }] } })
    expect(hub.size).toBe(0)
  })

  it('请求号对不上、种类对不上、已经关闭的：一律不收，等待方不会被别人的答案唤醒', () => {
    const hub = new InteractionHub()
    const pending = hub.open('approval', 's1')
    expect(hub.settle({ type: 'question', requestId: pending.requestId, answer: { answers: [{ id: 'q', selected: [] }] } })).toBe(false)
    expect(hub.settle({ type: 'approval', requestId: 'no-such', outcome: 'allowed-once' })).toBe(false)
    hub.close(pending.requestId)
    expect(hub.settle({ type: 'approval', requestId: pending.requestId, outcome: 'allowed-once' })).toBe(false)
    expect(hub.size).toBe(0)
  })

  it('登记时记下转发用的帧：设备重连时按会话列出仍在等待的交互重推一遍；落定后不再列出', () => {
    const hub = new InteractionHub()
    const pending = hub.open('question', 's1', { questions: [{ id: 'q', question: '猫还是狗？' }] })
    expect(pending.frame).toEqual({ type: 'question', requestId: pending.requestId, sessionId: 's1', questions: [{ id: 'q', question: '猫还是狗？' }] })
    expect(hub.framesOf('s1').map((frame) => frame.requestId)).toEqual([pending.requestId])
    expect(hub.framesOf('s2')).toEqual([])
    hub.close(pending.requestId)
    expect(hub.framesOf('s1')).toEqual([])
  })

  it('closeAll 清空全部待回答项（宿主卸载时用）', () => {
    const hub = new InteractionHub()
    hub.open('question', 's1')
    hub.open('approval', 's2')
    hub.closeAll()
    expect(hub.size).toBe(0)
  })
})
