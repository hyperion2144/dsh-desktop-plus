//! 交互中继（#151）：A 上的提问 / 审批交给已配对设备上的用户回答。
//!
//! 提问与审批在官方是「回答者瀑布」：宿主把请求作为事件分发给回答者，本地界面是其中一个，答案沿瀑布
//! 返回，所以谁先答谁生效。远端设备要参与，就得在 A 的瀑布里有一个「远端回答者」：把请求推给订阅了
//! 这条会话的设备，与本地界面赛跑；设备交回的答案经这里登记后唤醒等待方。
//!
//! 这个文件只有两样纯逻辑：线上帧与答案的校验（来自网络的数据不可信），以及待回答项的登记表。

/** 一条待转发的问题（与官方 `AskUserQuestionItem` 同形，只校验用得到的字段）。 */
export interface InteractionQuestion {
  id: string
  header?: string
  question: string
  options?: Array<{ label: string, description?: string }>
  /** 补充说明。 */
  detail?: string
  /** 是否可多选；缺省单选。 */
  multiSelect?: boolean
  /** 官方的呈现意图（计划评审 / 审批）；不认识就按普通选项列表渲染，回答编码不变。 */
  intent?: Record<string, unknown>
}

/** A → 设备：一次需要人来回答的交互。 */
export type InteractionFrame =
  | { type: 'question', requestId: string, sessionId: string, questions: InteractionQuestion[] }
  | { type: 'approval', requestId: string, sessionId: string, toolName: string, callId?: string, reason?: string }
  /** A 上这次交互已经落定（无论谁答的、还是超时 / 取消）：各端据此收起卡片。 */
  | { type: 'settled', requestId: string, reason: 'answered' | 'closed' }

/** 设备 → A：对一次交互的回答。 */
export type InteractionAnswer =
  | { type: 'question', requestId: string, answer: { answers: Array<{ id: string, selected: string[], custom?: string }> } }
  /** 远端只能允许一次或拒绝；「已取消」「无人可答」是 A 自己结束时的结果，不由设备宣布。 */
  | { type: 'approval', requestId: string, outcome: 'allowed-once' | 'rejected' }

/** 一次待回答的中继。 */
export interface PendingInteraction {
  requestId: string
  /** 设备交回答案时兑现；A 这边先落定（本地答了、超时、取消）时不会兑现——调用方应与本地回答赛跑。 */
  answer: Promise<InteractionAnswer>
  /** 推给设备的那一帧：设备重连时据此重推。 */
  frame: InteractionFrame
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 解析一条来自网络的交互帧。
 * @param value 线上收到的原始值。
 * @returns 合法的帧；不合法时返回 undefined。
 */
export function parseInteractionFrame(value: unknown): InteractionFrame | undefined {
  const frame = record(value)
  if (frame === undefined) return undefined
  const requestId = text(frame['requestId'])
  if (requestId === undefined) return undefined
  if (frame['type'] === 'settled') {
    const reason = frame['reason']
    return reason === 'answered' || reason === undefined ? { type: 'settled', requestId, reason: reason ?? 'closed' }
      : reason === 'closed' ? { type: 'settled', requestId, reason: 'closed' } : undefined
  }
  const sessionId = text(frame['sessionId'])
  if (sessionId === undefined) return undefined
  if (frame['type'] === 'approval') {
    const toolName = text(frame['toolName'])
    if (toolName === undefined) return undefined
    const callId = text(frame['callId'])
    const reason = text(frame['reason'])
    return { type: 'approval', requestId, sessionId, toolName, ...(callId === undefined ? {} : { callId }), ...(reason === undefined ? {} : { reason }) }
  }
  if (frame['type'] === 'question') {
    const list = frame['questions']
    if (!Array.isArray(list) || list.length === 0) return undefined
    const questions: InteractionQuestion[] = []
    for (const item of list) {
      const question = record(item)
      if (question === undefined) return undefined
      const id = text(question['id'])
      const sentence = text(question['question'])
      if (id === undefined || sentence === undefined) return undefined
      const header = text(question['header'])
      const detail = text(question['detail'])
      const intent = record(question['intent'])
      const multiSelect = question['multiSelect'] === true
      const rawOptions = question['options']
      const options = Array.isArray(rawOptions)
        ? rawOptions.map(record).filter((option): option is Record<string, unknown> => option !== undefined && text(option['label']) !== undefined)
          .map((option) => {
            const label = text(option['label']) as string
            const description = text(option['description'])
            return description === undefined ? { label } : { label, description }
          })
        : undefined
      questions.push({
        id, question: sentence, ...(header === undefined ? {} : { header }), ...(options === undefined ? {} : { options }),
        ...(detail === undefined ? {} : { detail }), ...(multiSelect ? { multiSelect } : {}), ...(intent === undefined ? {} : { intent }),
      })
    }
    return { type: 'question', requestId, sessionId, questions }
  }
  return undefined
}

/**
 * 解析一条来自网络的交互回答。
 * @param value 线上收到的原始值。
 * @returns 合法的回答；不合法时返回 undefined。
 */
export function parseInteractionAnswer(value: unknown): InteractionAnswer | undefined {
  const answer = record(value)
  if (answer === undefined) return undefined
  const requestId = text(answer['requestId'])
  if (requestId === undefined) return undefined
  if (answer['type'] === 'approval') {
    const outcome = answer['outcome']
    return outcome === 'allowed-once' || outcome === 'rejected' ? { type: 'approval', requestId, outcome } : undefined
  }
  if (answer['type'] === 'question') {
    const body = record(answer['answer'])
    const list = body?.['answers']
    if (body === undefined || !Array.isArray(list) || list.length === 0) return undefined
    const answers: Array<{ id: string, selected: string[], custom?: string }> = []
    for (const item of list) {
      const entry = record(item)
      const id = text(entry?.['id'])
      if (entry === undefined || id === undefined) return undefined
      const selected = Array.isArray(entry['selected']) ? entry['selected'].filter((choice): choice is string => typeof choice === 'string') : []
      const custom = text(entry['custom'])
      answers.push({ id, selected, ...(custom === undefined ? {} : { custom }) })
    }
    return { type: 'question', requestId, answer: { answers } }
  }
  return undefined
}

interface Entry {
  sessionId: string
  kind: 'question' | 'approval'
  resolve: (answer: InteractionAnswer) => void
  promise: Promise<InteractionAnswer>
  frame: InteractionFrame
}

/**
 * A 侧的待回答登记表：请求号 → 等待中的交互。
 * 设备交回答案时按请求号唤醒；A 这边先落定时由调用方关闭，等待方的 Promise 不兑现（靠赛跑择先）。
 */
export class InteractionHub {
  private readonly entries = new Map<string, Entry>()

  /** 当前等待中的交互数。 */
  get size(): number {
    return this.entries.size
  }

  /**
   * 登记一次待回答的交互。
   * @param kind 种类。
   * @param body 随帧转发的内容（问题列表，或工具名 / 调用标识 / 原因）。
   * @returns 待回答项：请求号、推给设备的帧与等待答案的 Promise。
   */
  open(kind: 'question' | 'approval', sessionId: string, body: Record<string, unknown> = {}): PendingInteraction {
    let resolve: (answer: InteractionAnswer) => void = () => undefined
    const promise = new Promise<InteractionAnswer>((done) => { resolve = done })
    const requestId = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const frame = { type: kind, requestId, sessionId, ...body } as InteractionFrame
    this.entries.set(requestId, { sessionId, kind, resolve, promise, frame })
    return { requestId, answer: promise, frame }
  }

  /**
   * 列出某条会话上仍在等待的交互帧。
   * 设备重连或重启后内存里已经没有待答的卡片，A 据此把还在等的交互重推一遍。
   * @param sessionId A 上发起交互的会话。
   * @returns 仍在等待的帧，按登记先后。
   */
  framesOf(sessionId: string): InteractionFrame[] {
    return [...this.entries.values()].filter((entry) => entry.sessionId === sessionId).map((entry) => entry.frame)
  }

  /**
   * 设备交回答案。
   * @param answer 已通过 parseInteractionAnswer 校验的回答。
   * @returns 唤醒了等待方为 true；请求号对不上、种类对不上或已关闭为 false。
   */
  settle(answer: InteractionAnswer): boolean {
    const entry = this.entries.get(answer.requestId)
    if (entry === undefined || entry.kind !== answer.type) return false
    this.entries.delete(answer.requestId)
    entry.resolve(answer)
    return true
  }

  /**
   * A 这边已经落定：关闭登记，之后设备交回的答案不再收。
   * @param requestId 请求号。
   */
  close(requestId: string): void {
    this.entries.delete(requestId)
  }

  /** 清空全部待回答项（宿主卸载时用）。 */
  closeAll(): void {
    this.entries.clear()
  }
}
