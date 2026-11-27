// 交互卡片（#151）的纯逻辑：A 上的提问 / 审批在远程会话里显示成卡片，回答经宿主交回 A。
import { describe, expect, it } from 'vitest'
import { buildApprovalAnswer, buildQuestionAnswer, cardForSession, cardModel } from '../client/interaction-card.js'

const QUESTION = {
  requestId: 'question-1', sessionId: 'remote-0123456789abcdef-s1', type: 'question', handedBack: false,
  questions: [
    { id: 'pet', header: '偏好', question: '更喜欢猫还是狗？', options: [{ label: '猫', description: '选择更喜欢猫。' }, { label: '狗' }] },
    { id: 'free', question: '还有什么想说的？' },
  ],
}
const APPROVAL = { requestId: 'approval-1', sessionId: 'remote-0123456789abcdef-s1', type: 'approval', toolName: 'shell', reason: '要在工作区外写文件' }

// 一张极简的假卡片：只支持本模块用到的查询（按题目找容器、找选项按钮与自定义输入）。
function fakeRoot(selections, customs = {}) {
  const question = (id) => ({ querySelector: (selector) => (selector.includes('data-custom') ? { value: customs[id] ?? '' } : null), querySelectorAll: () => (selections[id] ?? []).map((label) => ({ getAttribute: () => label })) })
  return { querySelector: (selector) => question(/data-question='([^']+)'/.exec(selector)?.[1] ?? '') }
}

describe('cardModel', () => {
  it('提问：每道题带上标题、说明、多选标记与选项', () => {
    const model = cardModel(QUESTION)
    expect(model.kind).toBe('question')
    expect(model.handedBack).toBe(false)
    expect(model.questions.map((question) => [question.header, question.question, question.multiSelect, question.options.map((option) => option.label)])).toEqual([
      ['偏好', '更喜欢猫还是狗？', false, ['猫', '狗']], ['', '还有什么想说的？', false, []],
    ])
  })

  it('审批：有原因用原因，没有原因按工具名生成一句；附带工具名', () => {
    expect(cardModel(APPROVAL)).toMatchObject({ kind: 'approval', toolName: 'shell', reason: '要在工作区外写文件' })
    expect(cardModel({ ...APPROVAL, reason: undefined }).reason).toBe('是否允许执行「shell」？')
    expect(cardModel({ ...APPROVAL, handedBack: true }).handedBack).toBe(true)
  })
})

describe('cardForSession', () => {
  it('只取当前打开的那条远程会话的交互，按先后顺序取第一张', () => {
    const other = { ...QUESTION, sessionId: 'remote-aaaaaaaaaaaaaaaa-s2' }
    expect(cardForSession([other, QUESTION], QUESTION.sessionId)?.requestId).toBe('question-1')
    expect(cardForSession([other], QUESTION.sessionId)).toBeNull()
    expect(cardForSession([], QUESTION.sessionId)).toBeNull()
    expect(cardForSession([QUESTION], '')).toBeNull()
  })
})

describe('buildQuestionAnswer', () => {
  it('把每道题的选项与自由文本整理成与官方同形的回答', () => {
    const answer = buildQuestionAnswer(cardModel(QUESTION), fakeRoot({ pet: ['猫'], free: [] }, { free: '  都可以  ' }), false)
    expect(answer).toEqual({
      type: 'question', requestId: 'question-1',
      answer: { answers: [{ id: 'pet', selected: ['猫'] }, { id: 'free', selected: [], custom: '都可以' }] },
    })
  })

  it('单选题填了自由文本就不再带选项；跳过时每题都不选、不填', () => {
    const both = buildQuestionAnswer(cardModel(QUESTION), fakeRoot({ pet: ['猫'] }, { pet: '其它' }), false)
    expect(both.answer.answers[0]).toEqual({ id: 'pet', selected: [], custom: '其它' })
    const skipped = buildQuestionAnswer(cardModel(QUESTION), fakeRoot({ pet: ['猫'] }, { free: ' x ' }), true)
    expect(skipped.answer.answers).toEqual([{ id: 'pet', selected: [] }, { id: 'free', selected: [] }])
  })
})

describe('buildApprovalAnswer', () => {
  it('只允许两种结果', () => {
    expect(buildApprovalAnswer(cardModel(APPROVAL), 'allowed-once')).toEqual({ type: 'approval', requestId: 'approval-1', outcome: 'allowed-once' })
    expect(buildApprovalAnswer(cardModel(APPROVAL), 'rejected')).toEqual({ type: 'approval', requestId: 'approval-1', outcome: 'rejected' })
  })
})
