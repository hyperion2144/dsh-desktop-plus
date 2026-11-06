//! 远端连接三态（#108）：未配对 / 离线 / 版本或协议不符。
//!
//! 职责边界：`RemoteHostStore` 只记「我配对过谁」，本模块回答「现在够不够得着」。
//! 判定只依赖对端 lane 的保留端点 `/__dsh-mobile/api/pair/info`（已配对才放行）：
//!
//!   - 网络错误 / 超时        → offline（对端关机、换网、防火墙，都是这一类）
//!   - HTTP 401 / 403         → unpaired（设备会话被撤销或对端重装，必须重新配对）
//!   - 200 且协议版本一致      → online
//!   - 200 但协议版本缺失/不同  → incompatible（半可用状态比不可用更糟，直接禁用）
//!
//! 三态互斥且都有可重试入口：界面按 `state` 渲染，不自己猜。
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { RemoteHostRecord } from './remote-hosts.js'

/** 本机的远端协议版本。对端上报的版本与它不一致即视为不兼容。 */
export const REMOTE_PROTOCOL_VERSION = 1

/** 一次探测的默认超时（毫秒）。弱网下也要能在界面上一次刷新内给出结论。 */
export const DEFAULT_PROBE_TIMEOUT_MS = 2500

/**
 * 读插件自身版本：与 lib/ 同级的 package.json 是打包后唯一可信来源，
 * 不在代码里另抄一份版本号（抄一份就一定会漂）。
 * @returns 版本串；读不到时返回空串（界面显示「未知版本」，不假装知道）。
 */
export function readPluginVersion(): string {
  try {
    // 编译产物在 lib/（上一级是包根），测试直接跑在 src/host/（上两级才是包根）：两处都试，
    // 都读不到才返回空串——宁可界面显示「未知版本」，也不编一个版本号出来。
    for (const relative of ['../package.json', '../../package.json']) {
      const file = fileURLToPath(new URL(relative, import.meta.url))
      if (!fs.existsSync(file)) continue
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: unknown }
      if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
    }
    return ''
  } catch {
    return ''
  }
}

/** 连接状态。 */
export type RemoteLinkState = 'online' | 'offline' | 'unpaired' | 'incompatible'

/** 一次探测的结论。 */
export interface RemoteLinkStatus {
  /** 被探测的主机标识。 */
  hostId: string
  /** 三态结论。 */
  state: RemoteLinkState
  /** 本次探测时间（毫秒）。 */
  checkedAt: number
  /** 最近一次确认可用的时间（来自主机记录；探测到 online 时会被刷新）。 */
  lastSeen: number
  /** 本机插件版本。 */
  localVersion: string
  /** 本机协议版本。 */
  localProtocol: number
  /** 对端插件版本（对端未上报时为 null）。 */
  remoteVersion: string | null
  /** 对端协议版本（对端未上报时为 null）。 */
  remoteProtocol: number | null
  /** 给界面直接展示的一句话说明；online 时为 null。 */
  detail: string | null
  /** 是否值得让用户点「重试」：offline/online 值得；unpaired 要给「重新配对」，incompatible 要升级。 */
  retryable: boolean
}

/** 探测参数。 */
export interface ProbeRemoteHostOptions {
  /** 本机插件版本（写进结论，界面两侧版本并排展示）。 */
  localVersion?: string
  /** 超时（毫秒）。 */
  timeoutMs?: number
  /** fetch 实现（测试注入）。 */
  fetchImpl?: typeof fetch
  /** 当前时间（测试注入）。 */
  now?: number
}

/** 对端 `/api/pair/info` 响应里本模块关心的字段。 */
export interface PairInfoPayload {
  /** 对端插件版本。 */
  version?: unknown
  /** 对端协议版本。 */
  protocolVersion?: unknown
}

/**
 * 把一次成功响应判定成三态之一（纯函数，便于单测）。
 * @param payload 响应体里本模块关心的字段。
 */
export function classifyPairInfo(payload: PairInfoPayload): Pick<RemoteLinkStatus, 'state' | 'remoteVersion' | 'remoteProtocol' | 'detail' | 'retryable'> {
  const remoteVersion = typeof payload.version === 'string' && payload.version !== '' ? payload.version : null
  const remoteProtocol = typeof payload.protocolVersion === 'number' ? payload.protocolVersion : null
  if (remoteProtocol === null) {
    return {
      state: 'incompatible',
      remoteVersion,
      remoteProtocol,
      detail: `对端没有上报协议版本（版本 ${remoteVersion ?? '未知'}），无法确认兼容，请把对端升级到同一版本线`,
      retryable: false,
    }
  }
  if (remoteProtocol !== REMOTE_PROTOCOL_VERSION) {
    return {
      state: 'incompatible',
      remoteVersion,
      remoteProtocol,
      detail: `协议版本不一致：本机 ${REMOTE_PROTOCOL_VERSION}，对端 ${remoteProtocol}（版本 ${remoteVersion ?? '未知'}）。两侧必须同版本线，远端能力已停用`,
      retryable: false,
    }
  }
  return { state: 'online', remoteVersion, remoteProtocol, detail: null, retryable: true }
}

/**
 * 探测一台已配对主机当前的连接状态。
 * @param record 主机记录（含 origin 与设备会话 cookie）。
 * @param options 探测参数。
 */
export async function probeRemoteHost(record: RemoteHostRecord, options: ProbeRemoteHostOptions = {}): Promise<RemoteLinkStatus> {
  const now = options.now ?? Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const localVersion = options.localVersion ?? ''
  const base: RemoteLinkStatus = {
    hostId: record.hostId,
    state: 'offline',
    checkedAt: now,
    lastSeen: record.lastSeen,
    localVersion,
    localProtocol: REMOTE_PROTOCOL_VERSION,
    remoteVersion: null,
    remoteProtocol: null,
    detail: null,
    retryable: true,
  }

  let response: Response
  try {
    response = await fetchImpl(`${record.origin}/__dsh-mobile/api/pair/info`, {
      method: 'GET',
      headers: { accept: 'application/json', cookie: `dsh_mobile_session=${record.cookie}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const reason = String((error as Error)?.message ?? error)
    return { ...base, state: 'offline', detail: `连不上 ${record.origin}：${reason}` }
  }

  if (response.status === 401 || response.status === 403) {
    return { ...base, state: 'unpaired', retryable: false, detail: '对端已经不认这台设备（配对被撤销或对端重装），需要重新配对' }
  }
  if (!response.ok) {
    return { ...base, state: 'offline', detail: `对端异常（HTTP ${response.status}），稍后重试` }
  }

  let payload: PairInfoPayload
  try {
    payload = (await response.json()) as PairInfoPayload
  } catch {
    return { ...base, state: 'incompatible', retryable: false, detail: '对端返回的不是配对信息（可能是旧版或别的服务占用了该端口）' }
  }

  const verdict = classifyPairInfo(payload)
  return { ...base, ...verdict, lastSeen: verdict.state === 'online' ? now : record.lastSeen }
}

/**
 * 把状态翻成界面文案（三态互不混淆，各带下一步动作）。
 * @param status 探测结论。
 */
export function describeRemoteLink(status: RemoteLinkStatus): string {
  switch (status.state) {
    case 'online':
      return `在线（对端 ${status.remoteVersion ?? '未知版本'}）`
    case 'offline':
      return `离线 · 上次可见 ${formatLastSeen(status.lastSeen)}，可重试`
    case 'unpaired':
      return '未配对：对端已撤销这台设备，请重新配对'
    case 'incompatible':
      return status.detail ?? '版本不符，远端能力停用'
  }
}

/**
 * 把「上次可见」格式化成界面可读的相对时间。
 * @param lastSeen 时间戳（毫秒）；0 表示从未见过。
 */
export function formatLastSeen(lastSeen: number): string {
  if (!Number.isFinite(lastSeen) || lastSeen <= 0) return '从未'
  const deltaMs = Date.now() - lastSeen
  if (deltaMs < 60_000) return '刚刚'
  const minutes = Math.floor(deltaMs / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
