//! 设备组网（#156）的纯逻辑。
//!
//! A 当介绍人：把「自己够得着的其它已配对设备」连同一张 A 签名、指名给来问的那台设备的介绍凭证一起下发。
//! B 拿凭证向 C 发起配对请求；C 必须先向 A 核实这张凭证，再弹审批让本机用户决定——
//! 绝不因为「大家都信任 A」就自动互信。同意后 C 发一张一次性配对令牌，B 走正常的双向配对流程。

import { randomBytes } from 'node:crypto'
import { mintWsToken, verifyWsToken } from './ws-token.js'

/** 介绍凭证有效期：五分钟。够 B 发起一次请求，不至于让一张凭证长期可用。 */
export const INTRO_TTL_MS = 5 * 60_000

/** 被介绍方挂起一次请求的时限：超过就清掉，不留没人处理的审批。 */
export const INTRO_REQUEST_TTL_MS = 10 * 60_000

/** 中转授权的时限：介绍人把设备甲介绍给设备乙之后，这段时间里允许乙请介绍人代为转发到甲。 */
export const INTRO_GRANT_TTL_MS = 30 * 60_000

/** 介绍凭证的内容：A 证明「我把 peer 介绍给 to」，并给出 peer 当前的地址与名字。 */
export interface IntroPayload {
  kind: 'intro'
  /** 被介绍的设备（来问的那台，它在 A 上的设备记录 id）。 */
  to: string
  /** 被介绍出去的设备（它在 A 上的设备记录 id）。 */
  peer: string
  /** 被介绍出去的设备当前的地址。 */
  origin: string
  /** 被介绍出去的设备的展示名。 */
  name: string
  /** 来问的那台设备（发起方）的地址，被介绍方据此认它。 */
  toOrigin: string
  /** 来问的那台设备（发起方）的展示名。 */
  toName: string
  /** 签发时间（毫秒时间戳）。 */
  at: number
}

/**
 * 签发一张介绍凭证。
 * @param secret 介绍人 lane 的签名密钥。
 * @param payload 凭证内容（不含种类与时间）。
 * @param now 现在。
 * @returns 可放进请求体的凭证字符串。
 */
export function mintIntro(secret: string, payload: Omit<IntroPayload, 'kind' | 'at'>, now: number = Date.now()): string {
  const full: IntroPayload = { kind: 'intro', at: now, ...payload }
  return mintWsToken(secret, JSON.stringify(full), now, INTRO_TTL_MS)
}

/**
 * 核实一张介绍凭证：签名对、没过期、内容是介绍凭证。
 * @param secret 介绍人 lane 的签名密钥。
 * @param token 凭证字符串。
 * @param now 现在。
 * @returns 凭证内容；不合法返回 null。
 */
export function verifyIntro(secret: string, token: string, now: number = Date.now()): IntroPayload | null {
  const raw = verifyWsToken(secret, token, now)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<IntroPayload>
    if (parsed.kind !== 'intro' || typeof parsed.to !== 'string' || typeof parsed.peer !== 'string' || typeof parsed.origin !== 'string') return null
    return {
      kind: 'intro', to: parsed.to, peer: parsed.peer, origin: parsed.origin, name: typeof parsed.name === 'string' ? parsed.name : '',
      toOrigin: typeof parsed.toOrigin === 'string' ? parsed.toOrigin : '', toName: typeof parsed.toName === 'string' ? parsed.toName : '',
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    }
  } catch {
    return null
  }
}

/** 介绍人主机表里的一行（只取介绍要用的字段）。 */
export interface IntroHostRow {
  /** 本机在该设备上的设备 id。 */
  deviceId: string
  /** 该设备在本机 lane 上的设备记录 id；旧格式的记录没有它，介绍不出去。 */
  laneDeviceId?: string
  /** 该设备当前的地址。 */
  origin: string
  /** 展示名。 */
  name: string
  /** 用户改名的时刻；有则用 name，否则用 origin。 */
  renamedAt?: number
  /** 介绍人上次成功连上它的时间（毫秒时间戳）；用来在清单里区分早已不在线的旧设备。 */
  lastSeen?: number
}

/** 下发给已配对设备的一条同组设备。 */
export interface PeerEntry {
  /** 该设备在介绍人上的设备记录 id（发起方用它指认）。 */
  deviceId: string
  /** 展示名。 */
  name: string
  /** 当前地址。 */
  origin: string
  /** 介绍人上次成功连上它的时间（毫秒时间戳）；0 表示介绍人没连过。 */
  lastSeen: number
  /** 指名给来问的那台设备的介绍凭证。 */
  intro: string
}

/**
 * 从介绍人的主机表挑出可以介绍的设备：自己够得着（记了设备记录 id）、且不是来问的那台。
 * @param hosts 介绍人的主机表。
 * @param callerDeviceId 来问的设备在介绍人上的设备记录 id。
 * @param secret 介绍人的签名密钥。
 * @param now 现在。
 * @returns 同组设备清单。
 */
export function pickPeers(hosts: readonly IntroHostRow[], callerDeviceId: string, secret: string, now: number = Date.now()): PeerEntry[] {
  const peers: PeerEntry[] = []
  const caller = hosts.find((row) => row.laneDeviceId === callerDeviceId)
  const toOrigin = caller?.origin ?? ''
  const toName = caller === undefined ? '' : caller.renamedAt !== undefined && caller.name !== '' ? caller.name : caller.origin
  for (const row of hosts) {
    if (row.laneDeviceId === undefined || row.laneDeviceId === '' || row.laneDeviceId === callerDeviceId) continue
    const name = row.renamedAt !== undefined && row.name !== '' ? row.name : row.origin
    peers.push({ deviceId: row.laneDeviceId, name, origin: row.origin, lastSeen: row.lastSeen ?? 0, intro: mintIntro(secret, { to: callerDeviceId, peer: row.laneDeviceId, origin: row.origin, name, toOrigin, toName }, now) })
  }
  // 最近连得上的排前面：介绍人表里可能留着早已不在的旧设备，不该让它们抢在在线设备前面。
  return peers.sort((left, right) => right.lastSeen - left.lastSeen)
}

/** 一次到达被介绍方的配对请求。 */
export interface IntroRequest {
  /** 请求号（128 位随机，发起方凭它轮询结果；不知道请求号的人什么也查不到）。 */
  id: string
  /** 发起方自报的地址、名字、型号。 */
  from: { origin: string; name: string; model: string }
  /** 介绍人（经谁介绍）。 */
  introducer: { origin: string; name: string; deviceId: string }
  /** pending = 等本机用户决定；approved / rejected = 已决定。 */
  state: 'pending' | 'approved' | 'rejected'
  /** 到达时间（毫秒时间戳）。 */
  openedAt: number
  /** 决定时间（毫秒时间戳）。 */
  decidedAt?: number
  /** 同意后发给发起方的一次性配对令牌。 */
  pairToken?: string
}

/** 被介绍方的审批收件箱。 */
export interface IntroInbox {
  /** 收到一次请求：同一发起方已有挂起的请求时不叠加。 */
  open: (request: Omit<IntroRequest, 'id' | 'state' | 'openedAt'>) => IntroRequest
  /** 按请求号取。 */
  get: (id: string) => IntroRequest | undefined
  /** 等待本机用户决定的请求。 */
  pending: () => IntroRequest[]
  /** 本机用户的决定；同意时要给一张配对令牌。已决定的请求不能改。 */
  decide: (id: string, approve: boolean, pairToken?: string) => IntroRequest | undefined
  /** 清掉过期或已结案的请求，返回清掉的条数。 */
  prune: () => number
}

/**
 * 被介绍方的审批收件箱（进程内）。
 * @param options.now 时钟。
 * @param options.random 请求号生成器。
 * @param options.ttlMs 请求保留时限。
 * @returns 收件箱。
 */
export function createIntroInbox(options: { now?: () => number, random?: () => string, ttlMs?: number } = {}): IntroInbox {
  const now = options.now ?? ((): number => Date.now())
  const random = options.random ?? ((): string => randomBytes(16).toString('base64url'))
  const ttlMs = options.ttlMs ?? INTRO_REQUEST_TTL_MS
  const requests = new Map<string, IntroRequest>()
  return {
    open(request) {
      for (const existing of requests.values()) {
        if (existing.state === 'pending' && existing.from.origin === request.from.origin) return existing
      }
      const record: IntroRequest = { ...request, id: random(), state: 'pending', openedAt: now() }
      requests.set(record.id, record)
      return record
    },
    get: (id) => requests.get(id),
    pending: () => [...requests.values()].filter((record) => record.state === 'pending'),
    decide(id, approve, pairToken) {
      const record = requests.get(id)
      if (record === undefined || record.state !== 'pending') return record
      const decided: IntroRequest = { ...record, state: approve ? 'approved' : 'rejected', decidedAt: now(), ...(approve && pairToken !== undefined ? { pairToken } : {}) }
      requests.set(id, decided)
      return decided
    },
    prune() {
      let pruned = 0
      for (const [id, record] of requests) {
        const expired = now() - record.openedAt > ttlMs
        const settledLongAgo = record.state === 'rejected' || (record.state === 'approved' && record.pairToken === undefined)
        if (expired || settledLongAgo) { requests.delete(id); pruned += 1 }
      }
      return pruned
    },
  }
}

/** 发起方的一次请求走到了哪一步。 */
export type IntroOutboxState = 'pending' | 'paired' | 'rejected' | 'failed' | 'expired'

/** 发起方请求簿里的一条。 */
export interface IntroOutboxEntry {
  /** 目标设备在介绍人上的设备记录 id。 */
  deviceKey: string
  /** 目标设备当前的地址。 */
  origin: string
  /** 目标设备的展示名。 */
  name: string
  /** 发给对方的请求号（重发会追加）。 */
  requestIds: string[]
  /** 走到了哪一步。 */
  state: IntroOutboxState
  /** 最近更新时间（毫秒时间戳）。 */
  updatedAt: number
  /** 说明（被拒原因、失败原因）。 */
  detail?: string
}

/** 发起方的请求簿。 */
export interface IntroOutbox {
  /** 记一次请求（已有的沿用条目）。 */
  open: (deviceKey: string, origin: string, name: string) => IntroOutboxEntry
  /** 记下发给对方的请求号。 */
  note: (deviceKey: string, requestId: string) => void
  /** 按目标设备取。 */
  byDevice: (deviceKey: string) => IntroOutboxEntry | undefined
  /** 更新进度。 */
  set: (deviceKey: string, state: IntroOutboxState, detail?: string) => void
  /** 仍在进行中的请求。 */
  inFlight: () => IntroOutboxEntry[]
}

/**
 * 发起方的请求簿（进程内）。
 * @param options.now 时钟。
 * @returns 请求簿。
 */
export function createIntroOutbox(options: { now?: () => number } = {}): IntroOutbox {
  const now = options.now ?? ((): number => Date.now())
  const entries = new Map<string, IntroOutboxEntry>()
  const byDevice = (deviceKey: string): IntroOutboxEntry | undefined => entries.get(deviceKey)
  return {
    byDevice,
    open(deviceKey, origin, name) {
      const existing = entries.get(deviceKey)
      if (existing !== undefined) return existing
      const entry: IntroOutboxEntry = { deviceKey, origin, name, requestIds: [], state: 'pending', updatedAt: now() }
      entries.set(deviceKey, entry)
      return entry
    },
    note(deviceKey, requestId) {
      const entry = entries.get(deviceKey)
      if (entry === undefined) return
      entries.set(deviceKey, { ...entry, requestIds: [...entry.requestIds, requestId], state: 'pending', updatedAt: now() })
    },
    set(deviceKey, state, detail) {
      const entry = entries.get(deviceKey)
      if (entry === undefined) return
      entries.set(deviceKey, { ...entry, state, updatedAt: now(), ...(detail === undefined ? {} : { detail }) })
    },
    inFlight: () => [...entries.values()].filter((entry) => entry.state === 'pending'),
  }
}
