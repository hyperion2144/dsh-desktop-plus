//! 会话接管（#154）的纯逻辑。
//!
//! 设备不可达时，用户可以把一条镜像会话**显式接管**成本地分支：用镜像缓存里已同步的事件（到水位为止）
//! 生成一条真正的本机会话，之后用本机模型继续干活。原镜像降为只读历史，回推（#155）成功前不再订阅设备。
//! 接管本身不依赖网络；入口只在设备离线时出现，不做自动切换。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { translateSessionEvents, type RemoteSessionEvent } from './remote-sessions.js'

/** 一条本地分支的出处：它从哪台设备的哪条会话、在哪个水位分出来。 */
export interface BranchProvenance {
  /** 记录种类标记。 */
  kind: 'remote-branch'
  /** 本地分支的会话 id（普通的本机会话 id）。 */
  sessionId: string
  /** 来源主机。 */
  hostId: string
  /** 来源会话在设备上的 id。 */
  remoteSessionId: string
  /** 被接管的镜像会话 id（已降为只读历史）。 */
  mirrorSessionId: string
  /** 分叉点：分支只包含设备上 seq 不大于它的事件。 */
  forkPoint: number
  /** 接管时间（毫秒）。 */
  takenAt: number
  /** 原会话标题。 */
  title: string
  /** 来源主机的展示名。 */
  hostName: string
  /** 发起回推的时刻（毫秒）：回推（#155）前先写下这个意图，失败可据水位重试。 */
  pushIntentAt?: number
  /** 回推成功的时刻（毫秒）：此后这条分支不再回推。 */
  pushedAt?: number
  /** 用户选择「保持本地」的时刻（毫秒）：此后不再提示回推。 */
  keptAt?: number
  /** 用户选择「在设备上另起一条」后，设备上那条新会话的 id。 */
  forkedTo?: string
  /** 原会话在设备上的工作目录：回推被拒后在设备上另起一条时要用它。 */
  path?: string
}

/** 接管裁决：允许，或带着一句能照着做的说明的拒绝。 */
export type TakeoverDecision =
  | { ok: true }
  | { ok: false; reason: 'online' | 'unpaired' | 'incompatible' | 'unknown'; message: string }

/**
 * 现在能不能接管：只看设备的三态，离线才允许。
 * @param state 设备的三态（`online` / `offline` / `unpaired` / `incompatible`）。
 * @returns 裁决。
 */
export function decideTakeover(state: string | undefined): TakeoverDecision {
  if (state === 'offline') return { ok: true }
  if (state === 'online') return { ok: false, reason: 'online', message: '设备在线，直接在远端会话里继续即可，不需要接管' }
  if (state === 'unpaired') return { ok: false, reason: 'unpaired', message: '设备未配对，先重新配对再同步会话' }
  if (state === 'incompatible') return { ok: false, reason: 'incompatible', message: '两台设备的版本不符，远端功能已停用' }
  return { ok: false, reason: 'unknown', message: '还没确认设备是否可达，稍后再试' }
}

/**
 * 生成分支的会话 id：普通的本机会话 id，与镜像 id（`remote-` 前缀）区分得开。
 * @param random 生成一段随机串的函数（缺省用系统随机字节）。
 * @returns 形如 `session-<随机串>` 的 id。
 */
export function newBranchSessionId(random: () => string = (): string => randomBranchId()): string {
  return `session-${random()}`
}

function randomBranchId(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 分支的种子事件：只取水位以内的，按原顺序从 0 重编号，投递标记换成分支的 id。
 * 水位以外的事件是镜像还没对齐过的尾部，不能带进分支。
 * @param snapshot 镜像缓存快照。
 * @param localId 分支的会话 id。
 * @returns 可直接写进本机会话日志的事件序列。
 */
export function branchEvents(snapshot: { events: readonly RemoteSessionEvent[]; watermark: number }, localId: string): RemoteSessionEvent[] {
  return translateSessionEvents(snapshot.events.filter((event) => event.seq <= snapshot.watermark), 0, localId)
}

/**
 * 原会话标题的兜底：会话头里没有标题时，取日志里记下的标题（官方生成的）；再没有就取第一条真正的用户消息。
 * @param events 已同步的事件。
 * @returns 标题；取不到返回空串。
 */
export function titleFromEvents(events: readonly RemoteSessionEvent[]): string {
  const textOf = (data: unknown): string => {
    const content = (data as { content?: unknown } | null)?.content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => (part as { text?: unknown } | null)?.text)
      .filter((text): text is string => typeof text === 'string')
      .join(' ')
      .trim()
  }
  const clean = (text: string): string => text.replace(/\s+/g, ' ').slice(0, 40)
  for (const event of events) {
    if (event.type !== 'session/title') continue
    const title = (event.data as { title?: unknown } | null)?.title
    if (typeof title === 'string' && title.trim() !== '') return clean(title)
  }
  for (const event of events) {
    if (event.type !== 'user/message') continue
    // 只认用户自己说的话：系统注入的提醒（工作区说明等）也是 user/message，但 source 不是 user。
    if ((event.data as { source?: { kind?: unknown } } | null)?.source?.kind !== 'user') continue
    const text = textOf(event.data)
    if (text !== '' && !text.startsWith('<system-reminder>')) return clean(text)
  }
  return ''
}

/**
 * 会话页上标明出处的说法。
 * @param provenance 分支出处。
 * @returns 「本地分支（来自 <主机> / <原会话>，自 seq N）」。
 */
export function branchLabel(provenance: BranchProvenance): string {
  return `本地分支（来自 ${provenance.hostName} / ${provenance.title}，自 seq ${String(provenance.forkPoint)}）`
}

/** 分支出处登记表存储。 */
export interface BranchRegistry {
  /** 落盘路径。 */
  path: string
  /** 读取全部分支出处；文件缺失或损坏时返回空表。 */
  load: () => BranchProvenance[]
  /** 覆盖写入全部分支出处。 */
  save: (records: BranchProvenance[]) => void
}

/**
 * 文件存储适配器（默认）：按 profile 隔离的目录下 0600 文件，与镜像登记表同一棵目录树。
 * @param file 存储文件路径；默认 `$DSH_HOME/storages/remote-access/profiles/<profile>/remote-branches.json`
 * @returns 登记表。
 */
export function createBranchRegistry(file?: string): BranchRegistry {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'profiles', 'desktop', 'remote-branches.json')
  return {
    path: resolved,
    load() {
      try {
        const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as { branches?: unknown }
        if (!Array.isArray(raw.branches)) return []
        const records: BranchProvenance[] = []
        for (const item of raw.branches) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Partial<BranchProvenance>
          if (record.kind !== 'remote-branch' || typeof record.sessionId !== 'string' || typeof record.hostId !== 'string' || typeof record.remoteSessionId !== 'string') continue
          records.push({
            kind: 'remote-branch',
            sessionId: record.sessionId,
            hostId: record.hostId,
            remoteSessionId: record.remoteSessionId,
            mirrorSessionId: typeof record.mirrorSessionId === 'string' ? record.mirrorSessionId : '',
            forkPoint: typeof record.forkPoint === 'number' ? record.forkPoint : 0,
            takenAt: typeof record.takenAt === 'number' ? record.takenAt : 0,
            title: typeof record.title === 'string' ? record.title : '',
            hostName: typeof record.hostName === 'string' ? record.hostName : '',
            ...(typeof record.pushIntentAt === 'number' ? { pushIntentAt: record.pushIntentAt } : {}),
            ...(typeof record.pushedAt === 'number' ? { pushedAt: record.pushedAt } : {}),
            ...(typeof record.keptAt === 'number' ? { keptAt: record.keptAt } : {}),
            ...(typeof record.forkedTo === 'string' ? { forkedTo: record.forkedTo } : {}),
            ...(typeof record.path === 'string' ? { path: record.path } : {}),
          })
        }
        return records
      } catch {
        return []
      }
    },
    save(records) {
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, JSON.stringify({ branches: records }, null, 2), { mode: 0o600 })
    },
  }
}
