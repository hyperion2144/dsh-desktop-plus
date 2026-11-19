// #116 通知触发源的服务探针（dsh-notify-me lookupService 同款）。
// `uiSession` 刻意不在插件 inject 里声明：cordis inject 是硬门（服务缺席时 entry
// 永不激活，web boot 审计失败），而它由官方 ui-session 包提供、晚于本插件激活的
// 时序不受我们控制——懒查找 + 周期重试才是安全路径。直接读 `ctx.uiSession` 会抛
// `cannot get property "uiSession" without inject`（inject 名单外的属性代理拒绝
// 解析），必须走 `ctx.get()` / `ctx.reflect.get()`。
import type { ClientContext } from '../bridge/ctx-types.ts'
import type { PendingInteraction, SessionListState, SessionRowSummary, SessionStatusEntry, SnapshotStore } from './types.ts'

/** 读 cordis 上下文里的可选服务实例；三级回退（get → reflect.get → 属性 in）。 */
export function lookupService(ctx: ClientContext, name: string): unknown {
  let service: unknown = null
  try {
    const get = (ctx as unknown as { get?: (name: string) => unknown }).get
    if (typeof get === 'function') service = get(name) ?? null
  } catch { service = null }
  if (service !== null) return service
  try {
    const reflect = (ctx as unknown as { reflect?: { get?: (n: string) => unknown } }).reflect
    if (typeof reflect?.get === 'function') service = reflect.get(name) ?? null
  } catch { service = null }
  if (service !== null) return service
  try {
    if (name in ctx) service = (ctx as unknown as Record<string, unknown>)[name] ?? null
  } catch { service = null }
  return service
}

/** 是否为可订阅快照存储。 */
export function isStore(value: unknown): value is SnapshotStore<unknown> {
  return !!value && typeof (value as { getSnapshot?: unknown }).getSnapshot === 'function' &&
    typeof (value as { subscribe?: unknown }).subscribe === 'function'
}

/** 会话列表存储（sessions 服务的 `list` 面）。 */
export function listStoreOf(ctx: ClientContext): SnapshotStore<SessionListState> | null {
  const sessions = lookupService(ctx, 'sessions') as { list?: unknown } | null
  const list = sessions?.list
  if (!isStore(list)) return null
  return list as SnapshotStore<SessionListState>
}

/**
 * uiSession 的待交互存储：sessionStatus（0.1.6+ 唯一 live 源）。
 *
 * rc.5 起 `sessionStatus` 是 Cordis 子服务，按 `uiSession.sessionStatus` 读会被属性
 * 代理拒绝（`cannot get property "uiSession.sessionStatus" without inject`），而这条
 * 读取不在 try/catch 里，会直接冒泡让整个客户端插件激活失败。按服务名直接
 * `ctx.get('uiSession.sessionStatus')` 读，与上游 ui-session-status 自己的用法一致。
 */
export function statusStoreOf(ctx: ClientContext): SnapshotStore<ReadonlyMap<string, SessionStatusEntry>> | null {
  const store = lookupService(ctx, 'uiSession.sessionStatus')
  if (!isStore(store)) return null
  return store as SnapshotStore<ReadonlyMap<string, SessionStatusEntry>>
}

/**
 * 用户正盯着的会话 id；列表未就绪时为 null。
 * 0.1.6+ 列表快照不再携带 `current`，按 mainView 保留计数推导——官方
 * DocumentTitle / ui-workspace / ui-session 的 isMain() 都用同一条规则。
 */
export function currentSessionId(list: SnapshotStore<SessionListState>): string | null {
  try {
    const snapshot = list.getSnapshot()
    if (!snapshot) return null
    const current = (snapshot as { current?: unknown }).current
    if (typeof current === 'string' && current !== '') return current
    const byId = snapshot.byId ?? {}
    for (const id of Object.keys(byId)) {
      const retainedBy = (byId[id] as { retainedBy?: { mainView?: number } }).retainedBy
      if ((retainedBy?.mainView ?? 0) > 0) return id
    }
  } catch { /* 快照形状异常：当作未知 */ }
  return null
}

/** 会话显示名（列表行的 displayTitle → title → 空串）。 */
export function sessionTitleOf(list: SnapshotStore<SessionListState>, sessionId: string): string {
  try {
    const row = list.getSnapshot()?.byId?.[sessionId]
    if (row) return row.displayTitle || row.title || ''
  } catch { /* 未知标题 */ }
  return ''
}

/** 后台 subagent 子会话判定（用户打开着的不算后台）。 */
export function isSubagentRow(row: SessionRowSummary | undefined, sessionId: string, currentId: string | null): boolean {
  if (currentId === sessionId) return false
  return row?.origin === 'subagent'
}

/**
 * 交互的一行摘要：扫描交互对象自有的文本字段与 questions 嵌套
 * （dsh-notify-me textFromPayload 同款键序——PendingApproval 的 toolName 携
 * reason 拼接，PendingQuestion 取首个问题的文本）。
 */
export function detailTextOf(interaction: PendingInteraction): string {
  const clip = (value: string): string => {
    const text = value.replace(/\s+/g, ' ').trim()
    if (text === '') return ''
    return text.length > 160 ? `${text.slice(0, 160)}…` : text
  }
  const keys = ['text', 'question', 'prompt', 'title', 'summary', 'description', 'message', 'operation', 'toolName', 'reason', 'name', 'tool']
  for (const key of keys) {
    const value = interaction[key]
    if (typeof value === 'string') {
      const clipped = clip(value)
      if (clipped !== '') {
        if (key === 'toolName') {
          const reason = typeof interaction.reason === 'string' ? clip(interaction.reason) : ''
          if (reason !== '') return `${clipped} · ${reason}`
        }
        return clipped
      }
    } else if (value !== null && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
      const nested = clip((value as { text: string }).text)
      if (nested !== '') return nested
    }
  }
  const questions = interaction.questions
  if (Array.isArray(questions) && questions.length > 0) {
    const first = questions[0] as unknown
    if (typeof first === 'string') return clip(first)
    if (first !== null && typeof first === 'object') {
      for (const key of ['question', 'title', 'text', 'detail']) {
        const value = (first as Record<string, unknown>)[key]
        if (typeof value === 'string' && clip(value) !== '') return clip(value)
      }
    }
  }
  return ''
}
