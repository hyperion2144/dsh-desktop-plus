// #116 通知触发源的本地 duck-typing 契约。
// 形状对照 upstream 0.2.2-rc.3 的真实服务定义（不 import upstream 类型——本插件
// 的 client 面向运行时宿主服务，字段以我们实际读取的子集声明）：
//   - api/session-controller client `sessions.list`：SnapshotStore<SessionListState>
//     （upstream packages/api/session-controller/src/client/sessions/service.ts）
//   - client ui-session `sessionStatus`：HostObservable<ReadonlyMap<SessionId, SessionStatus>>
//     （upstream packages/client/ui-session/src/client/index.ts）
// dsh-notify-me（chromoany/dsh-notify-me lib/client.js）在同一组服务上以同样的
// duck-typing 订阅工作，字段名与其实现一致。

/** 可订阅快照存储的最小面（cordis HostObservable / SnapshotStore 共同形状）。 */
export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 会话列表行（upstream `SessionSummary` 的读取子集）。 */
export interface SessionRowSummary {
  readonly displayTitle?: string
  readonly title?: string
  /** 后台 subagent 子会话标记；其等待与完成是父回合的步骤，默认静音。 */
  readonly origin?: 'subagent'
  readonly running: boolean
}

/** 会话列表快照（upstream `SessionListState` 的读取子集）。 */
export interface SessionListState {
  readonly ids?: readonly string[]
  readonly byId: Readonly<Record<string, SessionRowSummary>>
}

/** 待用户处理的交互（upstream `SessionPendingInteraction` 基础字段 + 域自有字段）。 */
export interface PendingInteraction {
  readonly key: string
  readonly kind: string
  readonly sessionId?: string
  readonly [field: string]: unknown
}

/** 单会话 UI 状态（upstream `SessionStatus`）。 */
export interface SessionStatusEntry {
  readonly running: boolean | undefined
  readonly pendingInteraction: PendingInteraction | undefined
  readonly completionUnread: boolean
}

/** 触发源回调：边沿已检出，投递策略（活跃门/设置门/横幅）由 deliver 层决定。 */
export interface NotifySourceHooks {
  /**
   * 会话出现新的待交互请求（审批/提问等待用户）。
   * @param kind - 交互域 kind（approval / plan-review / question …）。
   * @param sessionId - 会话 id。
   * @param detail - 交互的一行摘要（textFromPayload 提取），可为空串。
   * @param isCurrent - 是否用户正盯着的会话。
   */
  onAttention(kind: string, sessionId: string, detail: string, isCurrent: boolean): void
  /**
   * 会话 running 出现 true → false 边沿（回复完成）。
   * @param sessionId - 会话 id。
   * @param isCurrent - 是否用户正盯着的会话。
   */
  onDone(sessionId: string, isCurrent: boolean): void
}
