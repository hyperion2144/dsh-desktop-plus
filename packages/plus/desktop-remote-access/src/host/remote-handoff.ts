//! 会话流转（#109）：把 A 上的一个会话「搬」到 B 继续写，单向、不合并、不复制两份。
//!
//! 设计要点：
//!   - 语义是**搬走**，不是镜像：B 拿到可写副本后，A 侧不再参与同步；同一会话第二次流转一律拒绝，
//!     并把两侧事件数写进原因里（「已流转」比「又生成一份」安全）。
//!   - 来源可追溯：流转记录落本机 0600 文件（$DSH_HOME/storages/remote-access/handoffs.json），
//!     界面据此标注「来自 <主机> 的 <原会话 id>」，A 侧状态也由这条记录解释。
//!   - 幂等：get(sessionId) 命中即返回既有记录，调用方据此拒绝二次流转，不产生第二份副本。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一条流转记录（B 侧视角：某个本机会话是从哪台主机的哪个会话搬来的）。 */
export interface HandoffRecord {
  /** B 侧会话 id（物化时沿用 A 的会话 id，便于对照）。 */
  sessionId: string
  /** 来源主机标识。 */
  hostId: string
  /** 来源主机展示名（记录当时的名字，主机被撤销后仍可解释来源）。 */
  hostName: string
  /** A 上的原会话 id。 */
  originSessionId: string
  /** A 上的目录（绝对路径）。 */
  path: string
  /** 流转时间（毫秒）。 */
  handedOffAt: number
  /** 流转时搬过来的事件数。 */
  eventCount: number
}

/** 持久化状态。 */
export interface PersistedHandoffState {
  handoffs?: HandoffRecord[]
}

/** 持久化适配器。 */
export interface HandoffStorage {
  load(): PersistedHandoffState | null
  save(state: PersistedHandoffState): void
}

/** 文件存储适配器（默认）：$DSH_HOME 下 0600 文件。 */
export function createFileHandoffStorage(file?: string): HandoffStorage & { path: string } {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'handoffs.json')
  return {
    path: resolved,
    load() {
      try {
        return JSON.parse(fs.readFileSync(resolved, 'utf8')) as PersistedHandoffState
      } catch {
        return null
      }
    },
    save(state) {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, JSON.stringify(state))
        try { fs.chmodSync(resolved, 0o600); } catch { /* noop */ }
      } catch { /* 持久化失败不阻塞流转；调用方仍有内存记录 */ }
    },
  }
}

/** 内存存储适配器（测试用）。 */
export function createMemoryHandoffStorage(): HandoffStorage {
  let mem: PersistedHandoffState | null = null
  return {
    load: () => mem,
    save: (state) => { mem = state },
  }
}

/** 流转登记表。 */
export class HandoffStore {
  /** sessionId → 记录。 */
  records: Map<string, HandoffRecord>

  /** 持久化适配器（null = 不持久化）。 */
  storage: HandoffStorage | null

  /**
   * @param opts 构造参数
   * @param opts.storage 持久化适配器
   */
  constructor({ storage = null }: { storage?: HandoffStorage | null } = {}) {
    this.records = new Map()
    this.storage = storage
    if (storage) this._restore()
  }

  /** 从持久化状态恢复（坏记录跳过）。 */
  _restore(): void {
    try {
      const state = this.storage?.load()
      if (!state || typeof state !== 'object' || !Array.isArray(state.handoffs)) return
      for (const record of state.handoffs) {
        if (record && typeof record.sessionId === 'string' && typeof record.hostId === 'string') {
          this.records.set(record.sessionId, {
            sessionId: record.sessionId,
            hostId: record.hostId,
            hostName: typeof record.hostName === 'string' ? record.hostName : record.hostId,
            originSessionId: typeof record.originSessionId === 'string' ? record.originSessionId : record.sessionId,
            path: typeof record.path === 'string' ? record.path : '',
            handedOffAt: Number(record.handedOffAt ?? 0),
            eventCount: Number(record.eventCount ?? 0),
          })
        }
      }
    } catch { /* 损坏/不可读 → 按空开始 */ }
  }

  /** 落盘。 */
  _persist(): void {
    if (!this.storage) return
    try {
      this.storage.save({ handoffs: [...this.records.values()] })
    } catch { /* noop */ }
  }

  /**
   * 按会话 id 取流转记录。
   * @param sessionId B 侧会话 id。
   */
  get(sessionId: string): HandoffRecord | undefined {
    return this.records.get(sessionId)
  }

  /**
   * 落一条流转记录（同会话覆盖：调用方先问过 decideHandoff）。
   * @param record 流转记录。
   */
  upsert(record: HandoffRecord): HandoffRecord {
    this.records.set(record.sessionId, record)
    this._persist()
    return record
  }

  /** 全部记录。 */
  list(): HandoffRecord[] {
    return [...this.records.values()]
  }
}

/** 流转判定结果。 */
export interface HandoffDecision {
  /** 允许首次流转；拒绝二次流转（并给出原因）。 */
  action: 'create' | 'refuse'
  /** 拒绝原因（action=create 时为 null）。 */
  reason: string | null
}

/**
 * 判定一次流转请求是否放行（纯函数）。
 *
 * 规则只有一条：同一会话只流转一次。已流转过就拒绝，并把两侧事件数写进原因，
 * 让用户知道「A 上又写了新事件」这件事本身，而不是悄悄覆盖出一份互相打架的副本。
 * @param existing 既有流转记录（没有则 undefined）。
 * @param incomingEventCount 本次要搬的事件数。
 */
export function decideHandoff(existing: HandoffRecord | undefined, incomingEventCount: number): HandoffDecision {
  if (existing === undefined) return { action: 'create', reason: null }
  const delta = incomingEventCount - existing.eventCount
  const grew = delta > 0 ? '对端此后新增了 ' + delta + ' 个事件' : '对端此后没有新增事件'
  return {
    action: 'refuse',
    reason: '该会话已于 ' + new Date(existing.handedOffAt).toLocaleString() + ' 从 ' + existing.hostName + ' 流转到本机（当时 ' + existing.eventCount + ' 个事件，' + grew + '）。流转是单向搬运，不合并、不覆盖；如需再次搬运，请先在 B 侧删除这条会话的记录。',
  }
}
