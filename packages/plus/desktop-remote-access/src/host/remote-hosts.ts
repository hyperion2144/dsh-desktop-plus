//! 远程主机（出站）：本机主动连过去的那台已配对主机。
//!
//! 方向很重要：lane 的 `PairingStore` 记的是「谁配对到了**我**」（入站，被访问方视角）；
//! 而「我要连到 A」是出站，需要自己保存 A 的地址与 A 发给我的设备会话。两者互不重叠，
//! 所以这里另起一份 `remote-hosts.json`，而不是往 pairing 状态里塞字段。
//!
//! 配对流程直接复用 lane 已发布的协议（与手机壳同款）：
//!   POST {origin}/__dsh-mobile/api/pair/accept  {token} → 200 {deviceId} + Set-Cookie
//!   POST {origin}/__dsh-mobile/api/pair/renew   {deviceId} → 新 cookie（cookie 丢失时自愈）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一台出站主机的登记。 */
export interface RemoteHostRecord {
  /** 本机生成的主机标识（与对方的 deviceId 区分：那个是「我」在对方那边的身份）。 */
  hostId: string
  /** 对方 lane 的基地址，如 `http://192.168.1.9:3091`。 */
  origin: string
  /** 对方在配对时给我分配的设备标识（续 cookie 用）。 */
  deviceId: string
  /** 设备会话 cookie（数据面凭证；缺失即需 renew 或重新配对）。 */
  cookie: string
  /** 展示名（配对时可指定）。 */
  name: string
  /** 用户改名的时刻（毫秒）；缺省表示没改过名，展示时用 origin。 */
  renamedAt?: number
  /** 配对时间（毫秒）。 */
  pairedAt: number
  /** 最近一次成功通信时间（毫秒）。 */
  lastSeen: number
  /** 对端设备型号（配对时由对端自报，如 `macOS 15.2 · arm64`）。 */
  model?: string
}

/**
 * 主机的展示名：没改过名就用远程地址（不带令牌），改过名用用户起的名字。
 * @param record 主机记录。
 */
export function displayNameOf(record: RemoteHostRecord): string {
  return record.renamedAt !== undefined && record.name !== '' ? record.name : record.origin
}

/** 持久化状态。 */
export interface PersistedRemoteHostState {
  hosts?: RemoteHostRecord[]
}

/** 持久化适配器。 */
export interface RemoteHostStorage {
  load(): PersistedRemoteHostState | null
  save(state: PersistedRemoteHostState): void
}

/** 文件存储适配器。 */
export interface RemoteHostFileStorage extends RemoteHostStorage {
  path: string
}

/**
 * 文件存储适配器（默认）：$DSH_HOME 下 0600 文件。
 * @param file 存储文件路径；默认 $DSH_HOME/storages/remote-access/remote-hosts.json
 */
export function createRemoteHostStorage(file?: string): RemoteHostFileStorage {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'remote-hosts.json')
  return {
    path: resolved,
    load() {
      try {
        return JSON.parse(fs.readFileSync(resolved, 'utf8')) as PersistedRemoteHostState
      } catch {
        return null
      }
    },
    save(state) {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, JSON.stringify(state))
        try { fs.chmodSync(resolved, 0o600); } catch { /* noop */ }
      } catch { /* 持久化失败不阻塞运行 */ }
    },
  }
}

/** 内存存储适配器（测试用）。 */
export function createMemoryRemoteHostStorage(): RemoteHostStorage {
  let mem: PersistedRemoteHostState | null = null
  return {
    load: () => mem,
    save: (state) => { mem = state },
  }
}

/** 出站主机登记表。 */
export class RemoteHostStore {
  /** 主机表（hostId → 记录）。 */
  hosts: Map<string, RemoteHostRecord>

  /** 持久化适配器（null = 不持久化）。 */
  storage: RemoteHostStorage | null

  /**
   * @param opts 构造参数
   * @param opts.storage 持久化适配器
   */
  constructor({ storage = null }: { storage?: RemoteHostStorage | null } = {}) {
    this.hosts = new Map()
    this.storage = storage
    if (storage) this._restore()
  }

  /** 从持久化状态恢复。 */
  _restore(): void {
    try {
      const state = this.storage?.load()
      if (!state || typeof state !== 'object' || !Array.isArray(state.hosts)) return
      for (const record of state.hosts) {
        if (record && typeof record.hostId === 'string' && typeof record.origin === 'string') {
          this.hosts.set(record.hostId, {
            hostId: record.hostId,
            origin: record.origin,
            deviceId: typeof record.deviceId === 'string' ? record.deviceId : '',
            cookie: typeof record.cookie === 'string' ? record.cookie : '',
            name: typeof record.name === 'string' ? record.name : record.origin,
            pairedAt: Number(record.pairedAt ?? Date.now()),
            lastSeen: Number(record.lastSeen ?? 0),
          })
        }
      }
    } catch { /* 损坏/不可读 → 按空开始 */ }
  }

  /** 落盘。 */
  _persist(): void {
    if (!this.storage) return
    try {
      this.storage.save({ hosts: [...this.hosts.values()] })
    } catch { /* noop */ }
  }

  /**
   * 落一条主机记录（同 origin + 同 deviceId 视为同一台，覆盖更新）。
   * @param record 主机记录。
   * @returns 落表后的记录。
   */
  upsert(record: RemoteHostRecord): RemoteHostRecord {
    for (const [hostId, existing] of this.hosts) {
      if (existing.origin === record.origin && existing.deviceId === record.deviceId) {
        const merged: RemoteHostRecord = { ...record, hostId }
        this.hosts.set(hostId, merged)
        this._persist()
        return merged
      }
    }
    this.hosts.set(record.hostId, record)
    this._persist()
    return record
  }

  /**
   * 按 hostId 取。
   * @param hostId 主机标识。
   */
  get(hostId: string): RemoteHostRecord | undefined {
    return this.hosts.get(hostId)
  }

  /** 全部登记。 */
  list(): RemoteHostRecord[] {
    return [...this.hosts.values()]
  }

  /**
   * 撤销一台主机。
   * @param hostId 主机标识。
   * @returns 是否真的删掉了。
   */
  remove(hostId: string): boolean {
    const deleted = this.hosts.delete(hostId)
    if (deleted) this._persist()
    return deleted
  }
}

/** 出站配对参数。 */
export interface PairWithHostOptions {
  /** 对方 lane 基地址（http/https）。 */
  origin: string
  /** 对方给出的配对令牌（配对链接里的 `token`）。 */
  token: string
  /** 本机在对方那边的展示名。 */
  name?: string | undefined
  /** fetch 实现（测试注入）。 */
  fetchImpl?: typeof fetch
  /** 本机 platform 标签（随配对上报）。 */
  platform?: string
}

/** 出站配对结果。 */
export interface PairWithHostResult {
  /** 装配好的主机记录（未落表）。 */
  record: RemoteHostRecord
}

/** 出站配对失败（带稳定 code，便于上层转 RPC 错误）。 */
export class RemoteHostPairError extends Error {
  /** 稳定错误码。 */
  code: string

  /**
   * @param code 稳定错误码
   * @param message 人类可读信息
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RemoteHostPairError'
    this.code = code
  }
}

/**
 * 规范化对方 origin：去尾斜杠、强制 http(s)。
 * @param origin 原始地址。
 */
export function normalizeHostOrigin(origin: string): string {
  const trimmed = origin.trim()
  if (trimmed === '') throw new RemoteHostPairError('bad-origin', '远程地址不能为空')
  if (!/^https?:\/\//i.test(trimmed)) throw new RemoteHostPairError('bad-origin', `远程地址必须是 http(s) URL：'${trimmed}'`)
  return trimmed.replace(/\/+$/, '')
}

/**
 * 出站配对：拿对方令牌换设备会话，返回可落表的主机记录。
 * @param opts 配对参数。
 * @returns 主机记录（调用方决定是否落表）。
 */
export async function pairWithHost(opts: PairWithHostOptions): Promise<PairWithHostResult> {
  const origin = normalizeHostOrigin(opts.origin)
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = `${origin}/__dsh-mobile/api/pair/accept`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: opts.token, name: opts.name ?? 'DSH Desktop Plus' }),
    })
  } catch (error) {
    throw new RemoteHostPairError('unreachable', `无法连接到 ${origin}：${String((error as Error)?.message ?? error)}`)
  }
  if (!response.ok) {
    throw new RemoteHostPairError(response.status === 403 ? 'invalid-token' : 'pair-failed',
      `配对失败（HTTP ${response.status}）：${await response.text().catch(() => '')}`.trim())
  }
  const body = await response.json().catch(() => ({})) as { deviceId?: unknown, model?: unknown }
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : ''
  if (deviceId === '') throw new RemoteHostPairError('pair-failed', '配对响应缺少 deviceId')
  const model = typeof body.model === 'string' ? body.model : ''
  const cookie = cookieFromSetCookie(response.headers.get('set-cookie'))
  if (cookie === '') throw new RemoteHostPairError('pair-failed', '配对响应缺少设备会话 cookie')
  const now = Date.now()
  return {
    record: {
      hostId: `${deviceId}@${origin}`,
      origin,
      deviceId,
      cookie,
      name: opts.name ?? origin,
      ...(model === '' ? {} : { model }),
      pairedAt: now,
      lastSeen: now,
    },
  }
}

/**
 * 从 Set-Cookie 头里取出 `dsh_mobile_session` 的值。
 * @param header Set-Cookie 原文。
 */
export function cookieFromSetCookie(header: string | null | undefined): string {
  if (typeof header !== 'string' || header === '') return ''
  const match = /(?:^|,)\s*dsh_mobile_session=([^;,\s]+)/.exec(header)
  return match === null ? '' : (match[1] ?? '')
}

/**
 * 以已配对主机的身份发起一次数据面请求（带设备会话 cookie）。
 * @param record 主机记录。
 * @param pathAndQuery 相对路径（以 `/` 开头）。
 * @param init 额外 fetch 选项。
 */
export async function fetchFromHost(record: RemoteHostRecord, pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {})
  headers.set('cookie', `dsh_mobile_session=${record.cookie}`)
  return await fetch(`${record.origin}${pathAndQuery}`, { ...init, headers })
}
