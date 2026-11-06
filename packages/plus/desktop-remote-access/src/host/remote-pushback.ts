//! 会话回推（#155）的纯逻辑。
//!
//! 设备恢复后，把本地分支在分叉点之后的增量追加回设备上的原会话，恢复成远程会话。
//! 四个前提全部满足才允许：设备可达、原会话在分叉点之后没有新事件、原会话没在运行、没有别的分支已回推过。
//! 不满足就拒绝，并给两个出口：保持本地 / 在设备上另起一条。绝不自动合并。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { translateSessionEvents, type RemoteSessionEvent } from './remote-sessions.js'
import type { BranchProvenance } from './remote-takeover.js'

/** 回推被拒的原因。 */
export type PushbackBlocker = 'unreachable' | 'kept' | 'pushed' | 'not-found' | 'running' | 'diverged' | 'already-pushed'

/** 被拒后的出口：保持本地（不再回推）/ 在设备上用分支内容另起一条新会话。 */
export type PushbackExit = 'keep-local' | 'fork-on-device'

/** 回推裁决：允许，或带着一句说明与若干出口的拒绝。 */
export type PushbackDecision =
  | { ok: true }
  | { ok: false; reason: PushbackBlocker; message: string; exits: PushbackExit[] }

/** 分叉之后设备上的会话又前进了 / 别的分支已回推：两种情况的出口相同。 */
const DIVERGED_EXITS: PushbackExit[] = ['keep-local', 'fork-on-device']

/**
 * 发起侧（持有分支的一端）的裁决：回推之前先看设备。
 * @param branch 分支出处。
 * @param state 设备的三态。
 * @returns 裁决。
 */
export function decidePushbackFromBranch(branch: BranchProvenance, state: string | undefined): PushbackDecision {
  if (state !== 'online') return { ok: false, reason: 'unreachable', message: '设备不可达，回推要等它恢复后进行', exits: [] }
  if (branch.keptAt !== undefined) return { ok: false, reason: 'kept', message: '这条分支已选择保持本地，不再回推', exits: [] }
  if (branch.pushedAt !== undefined) return { ok: false, reason: 'pushed', message: '这条分支已经回推过了', exits: [] }
  return { ok: true }
}

/** 设备侧裁决的输入。 */
export interface PushbackCheck {
  /** 原会话在设备上的最后一条事件 seq；会话不存在时为 undefined。 */
  lastSeq: number | undefined
  /** 分支的分叉点。 */
  forkPoint: number
  /** 原会话此刻是否在运行。 */
  running: boolean
  /** 这条会话上已有的回推认领（来自任何设备）。 */
  priorPush: { deviceId: string; state: string } | undefined
}

/**
 * 设备侧（被回推的一端）的裁决：四个前提全部满足才允许。
 * @param check 设备上查到的事实。
 * @returns 裁决。
 */
export function decidePushbackOnDevice(check: PushbackCheck): PushbackDecision {
  if (check.lastSeq === undefined) return { ok: false, reason: 'not-found', message: '设备上没有这条会话', exits: [] }
  if (check.running) return { ok: false, reason: 'running', message: '设备上这条会话正在运行，等它停下来再回推', exits: [] }
  if (check.priorPush !== undefined) {
    return { ok: false, reason: 'already-pushed', message: '另一条分支已经回推到设备上的这条会话，不会自动合并', exits: [...DIVERGED_EXITS] }
  }
  if (check.lastSeq !== check.forkPoint) {
    return { ok: false, reason: 'diverged', message: `设备上的会话在分叉点（seq ${String(check.forkPoint)}）之后又前进了，不会自动合并`, exits: [...DIVERGED_EXITS] }
  }
  return { ok: true }
}

/**
 * 分支里要回推的尾部：分叉点之后的事件，seq 接在分叉点后面，投递标记换回设备上的会话 id。
 * @param events 分支的全部事件。
 * @param forkPoint 分叉点。
 * @param remoteSessionId 原会话在设备上的 id。
 * @returns 追加到设备日志末尾的事件序列；没有新内容时为空。
 */
export function pushbackTail(events: readonly RemoteSessionEvent[], forkPoint: number, remoteSessionId: string): RemoteSessionEvent[] {
  return translateSessionEvents(events.filter((event) => event.seq > forkPoint), forkPoint + 1, remoteSessionId)
}

/** 出处事件的类型：设备日志里标明「这一段来自哪台设备的分支」。 */
export const PUSHBACK_PROVENANCE_TYPE = 'remote-access/branch-imported'

/**
 * 回推成功后写进设备日志的出处事件。
 * @param seq 接在回推内容之后的 seq。
 * @param time 时间。
 * @param deviceId 发起回推的设备（它在设备 lane 上的记录 id）。
 * @param forkPoint 分叉点。
 * @param count 回推的事件条数。
 * @returns 出处事件。
 */
export function pushbackProvenanceEvent(seq: number, time: number, deviceId: string, forkPoint: number, count: number): RemoteSessionEvent {
  return { type: PUSHBACK_PROVENANCE_TYPE, seq, time, data: { importedFrom: deviceId, forkPoint, events: count } }
}

/** 一次回推在设备上的认领记录（单分支的依据）。 */
export interface PushbackRecord {
  /** 被回推的会话（设备上的 id）。 */
  sessionId: string
  /** 发起回推的设备。 */
  deviceId: string
  /** 分叉点。 */
  forkPoint: number
  /** 回推的事件条数。 */
  events: number
  /** pushing = 已认领、正在写；done = 写完；partial = 写了一半（拒绝再次回推，也不自动修）。 */
  state: 'pushing' | 'done' | 'partial'
  /** 认领时间（毫秒）。 */
  at: number
}

/** 回推认领登记表存储。 */
export interface PushbackRegistry {
  /** 落盘路径。 */
  path: string
  /** 读取全部认领；文件缺失或损坏时返回空表。 */
  load: () => PushbackRecord[]
  /** 覆盖写入全部认领。 */
  save: (records: PushbackRecord[]) => void
}

/**
 * 文件存储适配器（默认）：按 profile 隔离的目录下 0600 文件。
 * @param file 存储文件路径；默认 `$DSH_HOME/storages/remote-access/profiles/<profile>/remote-pushbacks.json`
 * @returns 登记表。
 */
export function createPushbackRegistry(file?: string): PushbackRegistry {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'profiles', 'desktop', 'remote-pushbacks.json')
  return {
    path: resolved,
    load() {
      try {
        const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as { pushbacks?: unknown }
        if (!Array.isArray(raw.pushbacks)) return []
        const records: PushbackRecord[] = []
        for (const item of raw.pushbacks) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Partial<PushbackRecord>
          if (typeof record.sessionId !== 'string' || typeof record.deviceId !== 'string') continue
          records.push({
            sessionId: record.sessionId,
            deviceId: record.deviceId,
            forkPoint: typeof record.forkPoint === 'number' ? record.forkPoint : 0,
            events: typeof record.events === 'number' ? record.events : 0,
            state: record.state === 'done' || record.state === 'partial' ? record.state : 'pushing',
            at: typeof record.at === 'number' ? record.at : 0,
          })
        }
        return records
      } catch {
        return []
      }
    },
    save(records) {
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, JSON.stringify({ pushbacks: records }, null, 2), { mode: 0o600 })
    },
  }
}
