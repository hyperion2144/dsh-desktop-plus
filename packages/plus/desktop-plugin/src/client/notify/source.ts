// #116 通知触发源：订阅服务快照存储的边沿状态机（dsh-notify-me 同款方法）。
//
// 为什么不是 `ctx.on('session/event')`：那是宿主半区的 cordis 事件，浏览器端根本
// 不存在（运行构建的全部 client bundle 里该事件名只出现在订阅本身），页面半区
// 永远收不到——这是上一版通知彻底静默的根因。页面侧的实时事实由两个快照存储
// 拥有：sessions.list（会话行的 running 边沿）与 uiSession.sessionStatus
// （pendingInteraction / completionUnread，0.1.6+ 唯一 live 源）。两个通道是同一
// 完成的两重视图、同 tick 到达，由 done 去重窗合并（dsh-notify-me 同款）。
import type { ClientContext } from '../bridge/ctx-types.ts'
import { currentSessionId, detailTextOf, isSubagentRow, isStore, listStoreOf, statusStoreOf } from './services.ts'
import type { NotifySourceHooks, SessionListState, SessionRowSummary, SessionStatusEntry, SnapshotStore } from './types.ts'

/** 同一完成两重视图（running 边沿 × completionUnread）的合并窗。 */
const DONE_DEDUPE_MS = 250
/** uiSession 晚激活 / binding 晚铸造的重试节奏（dsh-notify-me 同款 1.5s）。 */
const REBIND_INTERVAL_MS = 1500
/** 无订阅可装时，最多隔多少次重试后放弃并留一条日志。 */
const REBIND_GIVE_UP_AFTER = 40

/**
 * 安装通知触发源。
 * @param ctx - browser cordis context。
 * @param hooks - 边沿回调（投递策略由调用方决定）。
 * @returns 卸载函数（插件拆卸 / HMR 时停订阅与定时器）。
 */
export function installNotifySource(ctx: ClientContext, hooks: NotifySourceHooks): () => void {
  const list = listStoreOf(ctx)
  if (list === null) {
    console.warn('[dsh-desktop-plus] sessions.list 不可用——通知触发源未安装')
    return () => { }
  }
  const disposers: Array<() => void> = []
  // ── 边沿基线 ──
  const prevRunningBySession = new Map<string, boolean>()
  const attentionFiredKeys = new Set<string>()
  const attentionBaseline = new Map<string, string>()
  const doneFiredAt = new Map<string, number>()
  const unreadReported = new Set<string>()
  let statusSub: (() => void) | null = null
  let statusStoreRef: SnapshotStore<ReadonlyMap<string, SessionStatusEntry>> | null = null

  const fireDone = (sessionId: string, isCurrent: boolean): void => {
    const now = Date.now()
    const last = doneFiredAt.get(sessionId) ?? 0
    if (now - last < DONE_DEDUPE_MS) return
    doneFiredAt.set(sessionId, now)
    hooks.onDone(sessionId, isCurrent)
  }

  /** uiStatus 通道：pendingInteraction 出现 / running 下降沿 / completionUnread 兜底。 */
  const evalUiStatus = (): void => {
    const store = statusStoreRef
    if (store === null) return
    let snapshot: ReadonlyMap<string, SessionStatusEntry>
    try {
      snapshot = store.getSnapshot()
    } catch { return }
    if (snapshot === null || typeof snapshot.forEach !== 'function') return
    const cur = currentSessionId(list)
    const seen = new Set<string>()
    snapshot.forEach((status, sessionId) => {
      if (status === null || typeof status !== 'object') return
      seen.add(sessionId)
      const pending = status.pendingInteraction
      const key = pending?.key ?? null
      const prevKey = attentionBaseline.get(sessionId) ?? null
      if (pending !== undefined && pending.key !== prevKey && !attentionFiredKeys.has(pending.key)) {
        attentionFiredKeys.add(pending.key)
        if (!isSubagentRow(list.getSnapshot()?.byId?.[sessionId], sessionId, cur)) {
          hooks.onAttention(pending.kind, sessionId, detailTextOf(pending), sessionId === cur)
        }
      }
      if (key !== null) attentionBaseline.set(sessionId, key)
      else attentionBaseline.delete(sessionId)
      const wasRunning = prevRunningBySession.get(sessionId)
      if (wasRunning === true && status.running === false && key === null) fireDone(sessionId, sessionId === cur)
      if (status.running !== undefined) prevRunningBySession.set(sessionId, status.running)
      // 完成未读兜底：列表快照合并导致 running 边沿漏检时的补偿通道
      // （completionUnread 在会话被打开 / 重跑 / 消失时清除）。
      if (status.completionUnread && sessionId !== cur &&
        !isSubagentRow(list.getSnapshot()?.byId?.[sessionId], sessionId, cur)) {
        if (!unreadReported.has(sessionId)) {
          unreadReported.add(sessionId)
          fireDone(sessionId, false)
        }
      } else {
        unreadReported.delete(sessionId)
      }
    })
    for (const sessionId of attentionBaseline.keys()) {
      if (!seen.has(sessionId)) attentionBaseline.delete(sessionId)
    }
  }

  /** list 通道：非当前会话行的 running 下降沿（当前会话归 uiStatus 通道）。 */
  const evalListRow = (sessionId: string, row: SessionRowSummary, currentId: string | null): void => {
    if (isSubagentRow(row, sessionId, currentId)) {
      prevRunningBySession.delete(sessionId)
      return
    }
    const wasRunning = prevRunningBySession.get(sessionId)
    const hasPending = attentionBaseline.has(sessionId)
    if (wasRunning === true && !row.running && !hasPending) fireDone(sessionId, sessionId === currentId)
    prevRunningBySession.set(sessionId, row.running)
  }

  const onListChanged = (): void => {
    const statusStore = bindUiStatus()
    if (statusStore !== null) evalUiStatus()
    let snapshot: SessionListState
    try {
      snapshot = list.getSnapshot()
    } catch { return }
    const byId = snapshot?.byId ?? {}
    const currentId = currentSessionId(list)
    for (const sessionId of Object.keys(byId)) {
      if (sessionId === currentId) continue
      const row = byId[sessionId]
      if (row !== undefined) evalListRow(sessionId, row, currentId)
    }
    for (const sessionId of prevRunningBySession.keys()) {
      if (byId[sessionId] === undefined && !attentionBaseline.has(sessionId)) prevRunningBySession.delete(sessionId)
    }
  }

  /** 绑定 uiSession.sessionStatus（服务晚激活时由重试定时器再试）。 */
  const bindUiStatus = (): SnapshotStore<ReadonlyMap<string, SessionStatusEntry>> | null => {
    if (statusSub !== null && statusStoreRef !== null) return statusStoreRef
    const store = statusStoreOf(ctx)
    if (store === null) return null
    if (!isStore(store)) return null
    statusStoreRef = store
    statusSub = store.subscribe(() => { evalUiStatus() })
    disposers.push(() => { if (statusSub !== null) statusSub() })
    evalUiStatus()
    return store
  }

  disposers.push(list.subscribe(onListChanged))
  onListChanged()
  // uiSession 晚激活重试：绑定成功或超过上限后停。
  let rebinds = 0
  const rebindTimer = setInterval(() => {
    if (statusSub !== null || rebinds >= REBIND_GIVE_UP_AFTER) {
      clearInterval(rebindTimer)
      if (statusSub === null) console.warn('[dsh-desktop-plus] uiSession.sessionStatus 不可达——待交互通知静默')
      return
    }
    rebinds += 1
    bindUiStatus()
  }, REBIND_INTERVAL_MS)
  disposers.push(() => clearInterval(rebindTimer))
  console.info('[dsh-desktop-plus] 通知触发源已安装（sessions.list + uiSession.sessionStatus）')
  return () => {
    for (const dispose of disposers) {
      try { dispose() } catch { /* 单个拆卸失败不影响其余 */ }
    }
  }
}
