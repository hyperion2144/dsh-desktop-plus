// 远程访问服务装配（host 半区）：改写反代 + 配对路由(JS 回调) + SSE + 隧道启动。
// 纯 Node 可测；桌面壳集成时在 dsh 进程内作为 bundle 插件装载。
import os from 'node:os'
import http from 'node:http'
import dgram from 'node:dgram'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import {
  createRewriteProxy,
  POLYFILL,
  OWNS_HOST_PATCH,
  THEME_SYNC_PATCH,
  LOOPBACK_URL_PATCH,
  LANE_PAIRED_HEADER,
  type RewriteProxy,
  type UpstreamPort,
  accessLog,
} from './proxy.js'
import { clientIp, entryKind } from './client-info.js'
import { LANE_PREFIX, laneRoutePath } from './lane-routes.js'
import { createDshUpstreamAuth, type DshUpstreamAuth } from './dshauth.js'
import { PairingStore, createFileStorage, type PairingStorage, type PersistedPairingState } from './pairing.js'
import { selectLanIPv4, buildPairLink, buildHttpPairLink, normalizeRemote, resolveBaseCandidates, sanitizeLocalHostname, type NetworkInterfacesLike } from './links.js'
import { buildLaneServiceRecord, buildLaneTxt, createBonjourPublisher, createLaneAdvertiser, defaultServiceName, type LaneAdvertiser, type LaneServiceRecord, type Publisher } from './mdns.js'
import { readSettingsString, writeSettingsKey, readTopLevelBlockKey, readShellSetting, readRemoteSetting, writeRemoteSetting } from './settings.js'
import { setProfileScope, currentProfileScope, profileStorageDir } from './profile-scope.js'
import { laneWsTokenSecret, mintWsToken, verifyWsToken, wsTokenOf } from './ws-token.js'
import { resolveCloudflared } from './cloudflared.js'
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { RemoteHostStore, createRemoteHostStorage, displayNameOf, fetchFromHost, findHostByDeviceId, findHostByLaneDevice, pairWithHost, setRelayHook, type RemoteHostRecord } from './remote-hosts.js'
import { createRemoteShareRegistry, type RemoteShareRegistry } from './remote-share-registry.js'
import { InteractionHub, parseInteractionAnswer, type InteractionFrame } from './interaction-relay.js'
import { resolveRemoteCreateTarget, type RemoteCreateTarget } from './remote-create.js'
import { branchEvents, branchLabel, createBranchRegistry, decideTakeover, newBranchSessionId, titleFromEvents, type BranchProvenance } from './remote-takeover.js'
import { createWebuiTicketStore, WEBUI_TICKET_TTL_MS, webuiRefusalMessage } from './webui-ticket.js'
import { leaseExpiresAt, leaseRemainingMs, pruneExpiredLeases } from './remote-lease.js'
import { createPushbackRegistry, decidePushbackFromBranch, decidePushbackOnDevice, pushbackProvenanceEvent, pushbackTail } from './remote-pushback.js'
import { createIntroInbox, createIntroOutbox, INTRO_GRANT_TTL_MS, pickPeers, verifyIntro, type IntroInbox, type PeerEntry } from './remote-intro.js'
import { buildRemoteSessionSource, clampPageLimit, fetchRemoteSessionLog, fetchRemoteSessions, listSessionsUnderPath, materializeSession, normalizeCreatedAt, paginateSessionHeaders, parseAfterSeq, sameCwd, sliceEventPage, translateSessionEvents, type RemoteSessionEvent, type SessionHeaderSource, type SessionLogSource, type SessionPersistenceLike, type SessionStoreLike } from './remote-sessions.js'
import { RemoteWorkspaceStore, createRemoteWorkspaceStorage, installRemoteWorkspaceBridge, normalizeRemotePath, REMOTE_BRIDGE_UNSUPPORTED, type RemoteWorkspaceBridge, type WorkspaceRegistryLike } from './remote-workspaces.js'
import { HandoffStore, createFileHandoffStorage, decideHandoff } from './remote-handoff.js'
import { createProbeCache, probeRemoteHost, describeRemoteLink, readPluginVersion, REMOTE_PROTOCOL_VERSION } from './remote-status.js'
import { REMOTE_HANDOFF_ENABLED, REMOTE_IMPORT_ENABLED, REMOTE_PUSH_ENABLED, REMOTE_WRITES_ENABLED, remoteReadonlyRefusal } from './remote-policy.js'
import { listLocalDirectory, fetchRemoteDirectory } from './remote-fs.js'

import { createRemoteWorkspace, createRemoteSession, forkRemoteBranch, promptRemoteSession, pushRemoteBranch, requestRemoteWebuiUrl } from './remote-rpc.js'
import { isMirrorId, mirrorIdOf, remoteIdOfMirror } from './mirror-id.js'
import { createMirrorCache } from './remote-mirror-cache.js'
import { installRemoteSessionBridge, type RemoteSessionBridge } from './remote-session-bridge.js'
import { mirrorHeader, type MirrorPersistenceLike, type MirrorProjectionCacheLike } from './remote-session-sync.js'
import { createRemoteSessionRegistry } from './remote-session-registry.js'
/**
 * 原实现里 `fs` 没有 import（node:fs 未引入）：读端口文件时会抛 ReferenceError，
 * 被同行的 catch 吞掉 → 回退 3080。迁移保持同一行为（仍不引入 import），
 * 这里只用声明让类型系统接受这个未定义标识符。
 */
declare const fs: { readFileSync(path: string, encoding: string): string }

/** 读取桌面端 ui-theme.preference（'dark' | 'light' | 'system' | null），供注入脚本同步远程视觉。 */
function readUiThemePreference(): string | null {
  try {
    const raw = readTopLevelBlockKey('ui-theme', 'preference')
    if (raw == null) return null
    const m = String(raw).match(/^"(.*)"$/s)
    return (m ? JSON.parse(m[1]!) : String(raw).trim()) || null
  } catch {
    return null
  }
}

/** #175：移动端会话守卫的退避基数（桌面设置 mobile_guard_backoff_ms；缺省/非法回 10000）。
 *  随 /api/pair/info 下发，两端壳开机时读一次；改设置后重启 dsh 生效。 */
const DEFAULT_GUARD_BACKOFF_MS = 10_000
function readMobileGuardBackoff(): number {
  try {
    const raw = readShellSetting('mobile_guard_backoff_ms')
    const n = typeof raw === 'number' ? raw : NaN
    if (!Number.isFinite(n) || n < 1_000) return DEFAULT_GUARD_BACKOFF_MS
    return Math.min(600_000, Math.round(n))
  } catch {
    return DEFAULT_GUARD_BACKOFF_MS
  }
}


/**
 * 远端调用失败时的可读原因（#153）：连接层面的失败说人话，其余保留原消息。
 * `fetch failed`、`ECONNREFUSED` 这类字样对用户没有意义——入口被拒时必须看得出是「设备连不上」。
 */
function remoteFailureMessage(error: unknown): string {
  const message = String((error as Error)?.message ?? error)
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|UND_ERR|socket hang up/i.test(message)
    ? '连不上设备本机，请确认它在线后重试'
    : message
}
/** mDNS 广播的装配参数（未开启即不广播）。 */
export interface MdnsRuntimeOptions {
  enabled?: boolean
  host?: string
  name?: string
  publisher?: Publisher<LaneServiceRecord>
}

/** mDNS 广播的运行时状态。 */
export interface MdnsState {
  enabled: boolean
  running: boolean
  record: LaneServiceRecord | null
  error: string | null
}

/** cloudflared 隧道的运行时状态（服务级状态，可重启）。 */
export interface TunnelState {
  /** cloudflared 可执行文件路径（'' = 未配置）。 */
  bin: string
  /** 当前子进程（null = 未运行）。 */
  child: ChildProcessByStdio<null, Readable, Readable> | null
  /** 最近一次解析到的 trycloudflare 地址。 */
  url: string | null
  /** 启动时间戳。 */
  startedAt: number
  /** 停止中（等待子进程退出）。 */
  stopping: boolean
  /** lane 端口。 */
  port: number
  /** lane 是否真的在监听（listen 成功才置 true；端口被占时保持 false）。 */
  listening: boolean
  /** 隧道生命周期阶段（idle/resolving/downloading/starting/registering/ready/error）。 */
  phase: string
  /** 阶段详情文案。 */
  detail: string
  /** 错误文案。 */
  message: string
  /** 失败原因（由调用方写入）。 */
  reason?: string | null
  /** 第三方隧道地址（内存态）。 */
  _customUrl?: string | undefined
}

/** createRemoteAccessService 的构造参数。 */
export interface RemoteAccessServiceOptions {
  upstreamHost?: string
  upstreamPort?: UpstreamPort
  platform?: string
  pairing?: PairingStore | null
  /** 默认文件持久化设备会话（$DSH_HOME 0600）；测试注入 pairing 时可传 createMemoryStorage() */
  storage?: PairingStorage<PersistedPairingState> | null
  warn?: ((message: string) => void) | null
  fetchImpl?: typeof fetch | null
  /** (origin) => 带 process token 的根 URL | null；生产由 apply 注入 ctx.connection.authenticatedUrl */
  authenticatedUrl?: ((origin: string) => string | null) | null
  /** 设置读取器（生产由 dsh settings 服务注入）。 */
  readSetting?: ((key: string) => string | null) | null
  /** 设置写入器（生产由 dsh settings 服务注入）。 */
  writeSettings?: ((patch: Record<string, unknown>) => Promise<void>) | null
  /** WS 空闲保活 ping 注入间隔（ms；0 = 关闭）。 */
  wsPingIntervalMs?: number
  /** WS pong 判死超时（ms）。 */
  wsPongTimeoutMs?: number
  /** mDNS 广播装配参数（未传即不广播）。 */
  mdns?: MdnsRuntimeOptions | null
  /** 远端数据面来源（A 侧）：已配对设备读取本机会话时用到；缺省即不提供该能力。 */
  sessions?: (SessionHeaderSource & SessionLogSource) | null
  /**
   * 远端分支回推（#155）：已配对设备把它的本地分支尾部追加进本机会话日志，或用分支内容另起一条。
   * 缺省即不提供（对应路由回 503）。
   */
  pushback?: {
    /** 这条会话此刻是否在运行（或正开着）：是则拿不到磁盘写句柄，回推只能等。 */
    isRunning: (sessionId: string) => boolean
    /** 把一批事件追加到会话日志末尾，并写一条出处事件。 */
    append: (sessionId: string, events: readonly RemoteSessionEvent[], deviceId: string, afterSeq: number) => Promise<void>
    /** 用给定事件在本机另起一条新会话，返回新会话 id。 */
    fork: (cwd: string, events: readonly RemoteSessionEvent[], title: string) => Promise<string>
  } | null
  /**
   * 设备组网（#156）：A 当介绍人。缺省即不提供（对应路由回 503）。
   */
  mesh?: {
    /** 介绍人视角：下发给某台已配对设备的同组设备清单（含指名给它的介绍凭证）。 */
    peers: (callerDeviceId: string) => PeerEntry[]
    /** 被介绍方视角：向介绍人核实一张凭证；通过则返回发起方的身份（介绍人眼中的它）与介绍人的展示名。 */
    verify: (introducerOrigin: string, token: string) => Promise<{ deviceId: string; name: string; origin: string; introducerName: string } | null>
    /** 被介绍方视角：到达的配对请求（等本机用户审批）。 */
    inbox: IntroInbox
    /** 中转：按设备记录 id 找到本机连得上的目标。 */
    relayTarget: (deviceKey: string) => { origin: string; cookie: string } | null
  } | null
}

/** 远程访问服务（对外表面）。 */
export interface RemoteAccessService {
  store: PairingStore
  /** 本机到对端的出口地址（反向登记用）。 */
  localAddressToward: (peerOrigin: string) => Promise<string | null>
  /** 本机设备型号（配对时自报）。 */
  localModel: () => string
  /** 分享登记表（命令面读写，SSE 面据此决定推给谁）。 */
  shares: RemoteShareRegistry
  proxy: RewriteProxy
  dshAuth: DshUpstreamAuth
  routePairing: (req: http.IncomingMessage, res: http.ServerResponse) => boolean
  selectLanIPv4: typeof selectLanIPv4
  buildPairLink: typeof buildPairLink
  buildHttpPairLink: typeof buildHttpPairLink
  normalizeRemote: typeof normalizeRemote
  tunnel: TunnelState
  startTunnel: (bin: string | null, lanePort?: number) => TunnelState
  stopTunnel: () => void
  /** #167：插件入口 apply 的 RPC 分支需要探测入口（私有函数跨作用域不可见） */
  probe: (raw: string, json: (status: number, body: Record<string, unknown>) => void) => Promise<void>
  mdns: MdnsState
  startAdvertising: (port: number) => Promise<void>
  stopAdvertising: () => Promise<void>
  listen: (port?: number) => Promise<number>
  close: () => Promise<void>
  /** 把某个会话的新事件推给订阅它的设备（分享登记决定推给谁）。 */
  pushSessionEvent: (sessionId: string, events: readonly unknown[]) => void
  /** 分享关系变化时通知对应设备重新认领。 */
  pushShareChange: (deviceId: string, kind: 'added' | 'removed', sessionId: string) => void
  /** 当前有多少台设备正在订阅某个会话（A 端徽标用）。 */
  viewerCount: (sessionId: string) => number
  /** 清掉过了租约的订阅登记，返回清掉的条数（#152）。 */
  pruneShareLeases: () => number
  /** 撤销某台设备的 Web UI 票据，返回撤销的张数（#157 解除配对）。 */
  revokeWebuiTickets: (deviceId: string) => number
  /** 把一条交互（提问 / 审批 / 落定）推给订阅了该会话的设备（#151 交互中继）。 */
  pushInteraction: (sessionId: string, frame: InteractionFrame) => void
  /**
   * 交互中继（#151）：有设备订阅这条会话时，把提问 / 审批推给它们并与本地界面赛跑——先到的回答生效；
   * 落定后通知各端收起卡片。没有设备订阅时原样交给本地界面，不做任何额外的事。
   */
  relayInteraction: (kind: 'question' | 'approval', sessionId: string | undefined, body: Record<string, unknown>, signal: AbortSignal | undefined, local: () => Promise<unknown>, onRemoteWin?: () => void) => Promise<unknown>
}

export function createRemoteAccessService(opts: RemoteAccessServiceOptions = {}): RemoteAccessService {
  const {
    upstreamHost = '127.0.0.1',
    upstreamPort = 3080,
    pairing = null,
    // 默认文件持久化设备会话（$DSH_HOME 0600）；测试注入 pairing 时可传 createMemoryStorage()
    storage = null,
    warn = null,
    fetchImpl = null,
    authenticatedUrl = null,  // (origin) => 带 process token 的根 URL | null；生产由 apply 注入 ctx.connection.authenticatedUrl
  } = opts
  const store = pairing ?? (storage
    ? new PairingStore({ storage })
    : new PairingStore({ storage: createFileStorage() }))
  /**
   * 本机到对端的出口地址：开一个 UDP socket「连」到对端，读内核选中的本地地址。
   * 多网卡（有线 + Wi-Fi + 虚拟网卡）时 selectLanIPv4 的首选未必是能到对端的那条，
   * 用错地址会让反向登记打到一个对端够不着的 IP 上。
   * @param peerOrigin 对端 origin。
   * @returns 本地出口 IPv4；解析不出来返回 null。
   */
  const localAddressToward = async (peerOrigin: string): Promise<string | null> => {
    try {
      const url = new URL(peerOrigin)
      const host = url.hostname
      const port = Number(url.port === '' ? '80' : url.port)
      return await new Promise<string | null>((resolve) => {
        const socket = dgram.createSocket('udp4')
        const done = (value: string | null): void => {
          try { socket.close() } catch { /* 已关闭 */ }
          resolve(value)
        }
        const timer = setTimeout(() => done(null), 600)
        if (typeof timer.unref === 'function') timer.unref()
        socket.on('error', () => { clearTimeout(timer); done(null) })
        try {
          socket.connect(port, host, () => {
            clearTimeout(timer)
            try { done(socket.address().address) } catch { done(null) }
          })
        } catch { clearTimeout(timer); done(null) }
      })
    } catch { return null }
  }
  /** 本机设备型号（配对时自报，对端据此展示）。 */
  const localModel = (): string => {
    try {
      const name = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
      return `${name} ${os.release()} · ${process.arch}`
    } catch { return '未知设备' }
  }
  // SSE 推送：每台已配对设备一条长连接（B 发起），A 有新事件就往下推。
  const streamClients = new Set<{ deviceId: string, res: http.ServerResponse }>()
  // 分享登记：本机哪个会话分享给了哪台配对设备（会话始终在本机，对端只是视图）。
  const remoteShares = createRemoteShareRegistry()
  // 回推认领（#155）：本机哪条会话已被哪台设备的分支回推过——单分支的依据，落盘。
  const pushbacks = createPushbackRegistry()
  // 中转授权（#156）：介绍人把哪台设备介绍给了哪台（发起方 → 目标，到期时刻）。只有互相介绍过的设备才能借道。
  const introGrants = new Map<string, number>()
  // 交互中继（#151）：等待已配对设备交回提问 / 审批答案的登记表。
  const interactionHub = new InteractionHub()
  // Web UI 票据（#150）：已配对设备用系统浏览器打开「这台机器的 DSH」时用，进程内、短时、一次性。
  const webuiTickets = createWebuiTicketStore()

  /**
   * 清掉过了租约的订阅登记（#152），返回清掉的条数。
   * 设备断线或关页后不再续租，到期即从这里清掉：不再向它推送，观众数随之回落。
   */
  const pruneLeases = (): number => {
    const all = remoteShares.load()
    const kept = pruneExpiredLeases(all)
    if (kept.length === all.length) return 0
    remoteShares.save(kept)
    return all.length - kept.length
  }
  // 到期清理每 30 秒一遍，不等到有人来查才清；定时器不阻止进程退出。
  const leaseTimer = setInterval(() => { try { pruneLeases() } catch { /* 登记表读不了就下一轮再看 */ } }, 30_000)
  leaseTimer.unref?.()
  /** 仍在租约内的订阅登记（内存里顺手过滤，不必等定时清理）。 */
  const leasedShares = () => pruneExpiredLeases(remoteShares.load())

  /** 当前有多少台设备正在订阅某个会话（A 端徽标用）。 */
  const viewersOf = (sessionId: string): number => {
    const devices = new Set(leasedShares().filter((entry) => entry.sessionId === sessionId).map((entry) => entry.deviceId))
    let count = 0
    for (const client of streamClients) if (devices.has(client.deviceId)) count += 1
    return count
  }

  /** 把一条交互帧推给订阅了该会话、且长连接在线的设备。 */
  const pushInteraction = (sessionId: string, frame: InteractionFrame): void => {
    if (streamClients.size === 0) return
    const devices = new Set(leasedShares().filter((entry) => entry.sessionId === sessionId).map((entry) => entry.deviceId))
    if (devices.size === 0) return
    const payload = `event: interaction\ndata: ${JSON.stringify(frame)}\n\n`
    for (const client of [...streamClients]) {
      if (!devices.has(client.deviceId)) continue
      try { client.res.write(payload) } catch { streamClients.delete(client) }
    }
  }

  /**
   * 把一次提问 / 审批交给已配对设备上的用户，与本地界面赛跑。
   * @param kind 种类。
   * @param sessionId A 上发起交互的会话。
   * @param body 随帧转发的内容（问题列表，或工具名 / 调用标识 / 原因）。
   * @param signal 这次交互的取消信号（超时、轮次被停止时落定为「已关闭」）。
   * @param local 本地界面这条回答路径（瀑布里的 next()）。
   * @returns 先到的那个回答：设备赢了是它的答案，否则是本地的结果。
   */
  const relayInteraction = async (
    kind: 'question' | 'approval',
    sessionId: string | undefined,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    local: () => Promise<unknown>,
    /** 远端赢了：调用方借此撤销本地那条回答路径（本地界面的卡片随之收起）。 */
    onRemoteWin: () => void = () => undefined,
  ): Promise<unknown> => {
    warn?.(`dsh-remote-access: ${kind === 'question' ? '提问' : '审批'}到达（会话 ${sessionId ?? '无'}，在线订阅设备 ${String(sessionId === undefined ? 0 : viewersOf(sessionId))} 台）`)
    if (sessionId === undefined) return await local()
    const viewers = viewersOf(sessionId)
    if (viewers === 0) return await local()
    const pending = interactionHub.open(kind, sessionId, body)
    let finished = false
    const settle = (reason: 'answered' | 'closed'): void => {
      if (finished) return
      finished = true
      interactionHub.close(pending.requestId)
      pushInteraction(sessionId, { type: 'settled', requestId: pending.requestId, reason })
    }
    signal?.addEventListener('abort', () => settle('closed'), { once: true })
    pushInteraction(sessionId, pending.frame)
    warn?.(`dsh-remote-access: 交互 ${pending.requestId}（${sessionId}）已推给 ${String(viewersOf(sessionId))} 台订阅设备`)
    try {
      const winner = await Promise.race([
        local().then((value: unknown) => ({ remote: false as const, value })),
        pending.answer.then((value) => ({ remote: true as const, value })),
      ])
      settle(winner.remote ? 'answered' : 'closed')
      if (!winner.remote) return winner.value
      // 先把结果交还给服务，再撤销本地那条回答路径：撤销若发生在交还之前，审批服务会按「信号已取消」落定，
      // 远端的允许就被记成取消（实测）。推迟到下一个宏任务——那时服务已拿着结果继续往下走，还在等本地界面的
      // 只剩内层链；撤销它，网关随之撤掉转发给界面的卡片。
      const answer = winner.value.type === 'question' ? winner.value.answer : winner.value.outcome
      setTimeout(() => onRemoteWin(), 0)
      return answer
    } catch (error) {
      settle('closed')
      throw error
    }
  }
  // dsh web 会话凭证（dsh 0.1.2-rc.1+ token 鉴权）：进程内自取 process token 换 cookie 存内存，
  // 反代附带上游 + 上游 401 单次重换自愈。authenticatedUrl 未提供（老版 dsh / 独立运行）→ 无凭证模式，行为不变。
  const dshAuth = createDshUpstreamAuth({
    // upstreamPort 可能是函数（apply 传 resolveUpstreamPort）：这里必须当场求值，
    // 否则模板串会把函数串进 origin，凭证交换永远打不到上游（实测 dshAuth 恒 false）。
    origin: `http://${upstreamHost}:${typeof upstreamPort === 'function' ? upstreamPort() : upstreamPort}`,
    authenticatedUrl,
    fetchImpl,
    log: warn,
  })

  // WS 空闲保活间隔（ms）：见 proxy.ts createWsKeepalivePump——手机链路中间代理（cpolar 等）
  // 对静默连接的空闲超时会掐断 dsh /api/remote.mux 复用 WebSocket（dsh 客户端无应用层心跳），
  // 手机端表现为「连接异常」重连循环；lane 空闲注入 ping 即可保活，pong 超时则主动断开触发
  // 客户端快速重连。settings 键：ws_keepalive_ms = ping 注入间隔 ms（参数 wsPingIntervalMs）、
  // ws_pong_timeout_ms = pong 判死超时 ms（参数 wsPongTimeoutMs）；优先级：opts（测试注入）>
  // settings.yaml > proxy.ts 缺省（15000/30000——默认值单一来源在 proxy 侧，此处不落地默认值）。
  // ws_keepalive_ms 0 = 关闭保活。有意不提供 env 通道（调优参数，非部署参数，区别于 lane_port）。
  // 改动需重启 lane（随 dsh 进程）生效。
  let wsPingIntervalMs = opts.wsPingIntervalMs
  // 设置读写器：生产由 apply 注入 dsh settings 服务访问器（不直接读写 settings.yaml）；
  // 未注入（测试/独立运行）时回退 legacy 行级读写。服务读返回原生类型（number/string），
  // legacy 返回 JSON 标量字符串——两边的 null/undefined 语义已对齐（缺失 = null）。
  const readSetting = opts.readSetting ?? readSettingsString
  const writeSettings = opts.writeSettings ?? (async (patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) writeSettingsKey(key, JSON.stringify(value));
  });
  if (wsPingIntervalMs === undefined) {
    try {
      // 键不存在时返 null：必须保持 undefined（用 proxy 缺省 15000），
      // 不能把 null 当空串 Number 成 0——否则保活泵被默认关闭（曾致产线零 ping）。
      const raw = readSetting('ws_keepalive_ms')
      if (raw != null) {
        const v = Number(raw)
        if (Number.isFinite(v) && v >= 0) wsPingIntervalMs = v
      }
    } catch { /* noop */ }
  }
  let wsPongTimeoutMs = opts.wsPongTimeoutMs
  if (wsPongTimeoutMs === undefined) {
    try {
      const rawPong = readSetting('ws_pong_timeout_ms')
      if (rawPong != null) {
        const v = Number(rawPong)
        if (Number.isFinite(v) && v > 0) wsPongTimeoutMs = v
      }
    } catch { /* noop */ }
  }
  const proxy = createRewriteProxy({
    // lane 自有路由**接进反代本体**（不只靠 listen 后重接 request 监听器）：
    // 配对入口在任何请求形态下都先于配对门禁被 lane 接走（实机：裸 TCP 换会话请求
    // 曾拿到门禁的 {"error":"unpaired"}）。
    laneRoutes: routePairing,
    upstreamHost,
    upstreamPort,
    upstreamAuth: dshAuth,
    ...(wsPingIntervalMs !== undefined ? { wsPingIntervalMs } : {}),
    ...(wsPongTimeoutMs !== undefined ? { wsPongTimeoutMs } : {}),
    // 注入顺序：能力位补丁先于 polyfill、先于 dsh scripts。
    // OWNS_HOST_PATCH（#145）：远程端声明「页面拥有 Host」→ 解锁服务端设置 RPC（插件设置/
    //   dsh 设置/壳的远程访问信息）；替代已失效的 hostname 伪装补丁（浏览器禁止伪造，已删除）。
    // THEME_SYNC_PATCH：主题视觉兜底（从 lane 保留命名空间读桌面端 ui-theme.preference）。
    // POLYFILL：老内核补 crypto.randomUUID。
    // desktopEnvPatchScript（强制 dsh-desktop-mode=compatibility）已删除：该补丁会让

    // LOOPBACK_URL_PATCH（#154）：远程页面上指向本机其它回环端口的绝对地址改写成映射路径
    // `/__dsh-mobile/loopback/<port>/…`（http/ws 同构），由反代转发到那个端口——于是「其它
    // 插件访问本机其它端口」在远程/手机侧也能工作（映射请求同样先过配对门禁）。
    inject: [OWNS_HOST_PATCH, THEME_SYNC_PATCH, POLYFILL, LOOPBACK_URL_PATCH],
    auth: (req) => {
      // 直连令牌（零转发）：WS 无法带请求头，页面把令牌放进路径 `/__dsh_ws/<token>/…`；
      // HTTP 直连用 `Authorization: Bearer <token>`。验签后还原会话值，仍走同一套 isDevice 判定。
      const meta0 = {
        ua: req.headers['user-agent'] ?? '',
        ip: clientIp(req),
        entry: entryKind(req),
      };
      const token = wsTokenOf(req.url ?? '');
      const bearer = String(req.headers.authorization ?? '');
      const direct = token ?? (bearer.startsWith('Bearer ') ? bearer.slice('Bearer '.length).trim() : null);
      if (direct !== null) {
        const session = verifyWsToken(laneWsTokenSecret(), direct);
        const paired = session !== null && store.isDevice(session, meta0);
        return paired ? { ok: true, session } : { ok: false };
      }
      // 配对门禁：所有到达反代本体的路径都必须是已配对设备（携带会话 cookie）。
      // lane 自有控制面住在保留命名空间（LANE_PREFIX/*，含冻结别名 /pair、/api/pair/*），
      // 由 routePairing 先于转发处理；打到这里的一律要求 cookie，杜绝「前缀豁免 +
      // 上游路径归一化」绕过。命名空间外的一切路径（含 dsh 自有路由）原样透传，不做白名单。
      // #195 延伸：重复 Cookie 头（见 parseCookies 注释）取任一命中即放行。
      const cookies = parseCookies(req.headers.cookie, 'dsh_mobile_session')
      // PWA 清单放行（精确路径）：浏览器对 <link rel=manifest> 的获取不保证携带会话 cookie，
      // 401 会把「桌面通知」等面板卡在加载中；清单非敏感，透传上游即可（#43）。
      if ((req.url ?? '').split('?')[0] === '/manifest.webmanifest') return { ok: true }
      // 顺手把该设备的最新 UA/IP/接入路径刷新下来（#145 延伸）：
      // ①已配对的老设备（早先只存了名字）不用重新配对就能被富化；
      // ②同一台设备换入口（局域网↔隧道）时面板能跟上。
      const meta = {
        ua: req.headers['user-agent'] ?? '',
        ip: clientIp(req),
        entry: entryKind(req),
      };
      // 命中即带上该会话值：反代把它写进标记头，上游 provider 据此认 owner Peer（#145）。
      const session = cookies.find((c) => store.isDevice(c, meta));
      return session === undefined ? { ok: false } : { ok: true, session };
    },
    onInjectSkip: opts.warn
      ? (p) => opts.warn!('[dsh-remote-access] 上游压缩 HTML，跳过注入（该页无 polyfill/桌面补丁）: ' + p)
      : undefined,
  })

  // 本地属主判定：桌面壳（同一台机器）经 loopback 直连 lane 端口，且无隧道加插的
  // X-Forwarded-For —— 视为属主控制台。公网/局域网设备一律经隧道（非 loopback Host
  // 或带 XFF），只能凭设备 cookie 访问控制端点。
  function isLocalOwner(req: http.IncomingMessage): boolean {
    const host = String(req.headers.host ?? '').split(':')[0]
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === ''
    return loopback && !req.headers['x-forwarded-for']
  }

  // cloudflared 隧道控制器（服务级状态，可重启）：
  //   bin    = cloudflared 可执行文件路径（'' / null = 未启用）
  //   child  = 当前子进程（null = 未运行）
  //   url    = 最近一次解析到的 trycloudflare 地址
  //   startedAt / stopAt = 状态查询用时间戳
  //   phase  = idle | resolving | downloading | starting | registering | ready | error
  //           （pocket 风格的隧道生命周期阶段，cf 卡片 UI 轮询可见）
  const tunnel: TunnelState = {
    bin: '',
    child: null,
    url: null,
    startedAt: 0,
    stopping: false,
    port: 3091,
    listening: false,
    phase: 'idle',
    detail: '',
    message: '',
  }

  // 第三方隧道地址（cpolar 等）内存态：POST /api/pair/tunnel 设置；
  // 重启后从 settings.yaml tunnel_url 恢复（info 端点兜底读取）。
  let customTunnel = ''

  // mDNS 服务广播（发现 ≠ 授权）：随 lane 监听启动、随 close/dispose 停止。
  //
  // 默认**不广播**：`mdns` 未传即关闭——库层被单测/服务器场景复用时不该在局域网上乱
  // 广播；桌面场景由插件入口 startLaneRuntime 显式开启（DSH_REMOTE_MDNS=0 可关）。
  const mdnsConfig = opts.mdns ?? null
  const mdns: MdnsState = { enabled: !!mdnsConfig?.enabled, running: false, record: null, error: null }
  let advertiser: LaneAdvertiser<LaneServiceRecord> | null = null

  /** 开始广播（幂等）：lane 端口确定后调用。记录里**没有任何令牌**。 */
  async function startAdvertising(port: number): Promise<void> {
    if (!mdns.enabled || advertiser) return;
    try {
      const host = sanitizeLocalHostname(mdnsConfig?.host ?? os.hostname()) ?? 'localhost'
      const record = buildLaneServiceRecord({
        name: mdnsConfig?.name ?? defaultServiceName(host),
        host,
        port,
        txt: buildLaneTxt({ host, port }),
      })
      const publisher = mdnsConfig?.publisher ?? createBonjourPublisher({
        onError: (e) => { try { warn?.('[dsh-remote-access] mDNS 广播错误: ' + e); } catch { /* noop */ } },
      })
      const adv = createLaneAdvertiser({ record, publisher })
      advertiser = adv
      await adv.start()
      mdns.record = record
      mdns.running = adv.state.running
      mdns.error = adv.state.error
      if (!mdns.running) warn?.('[dsh-remote-access] mDNS 广播未启动: ' + mdns.error)
    } catch (e) {
      mdns.error = String((e as { message?: unknown } | null | undefined)?.message ?? e)
      warn?.('[dsh-remote-access] mDNS 广播启动失败: ' + mdns.error)
    }
  }

  /** 停止广播（幂等）：lane 关闭/dispose 时调用。 */
  async function stopAdvertising(): Promise<void> {
    const a = advertiser
    advertiser = null
    if (!a) return;
    await a.stop()
    mdns.running = false

  }
  // 启动隧道（若已在运行则先停旧进程）。bin 为空 → 自动解析（PATH 优先，否则 $DSH_HOME/bin 缓存，
  // 否则从 GitHub/ghproxy 等多镜像下载到缓存），全过程异步，phase 字段实时同步状态供 UI 轮询。
  function startTunnel(bin: string | null, lanePort?: number): TunnelState {
    stopTunnel();
    tunnel.stopping = false;  // stopTunnel 保留 stopping=true 等子进程 exit，本轮启动需复位允许 tryParse
    tunnel.phase = 'resolving'
    tunnel.detail = bin ? `启动 ${bin}` : '正在解析 cloudflared…'
    tunnel.message = ''
    void (async () => {
      try {
        let actualBin = bin ?? ''
        if (!actualBin) {
          const result = await resolveCloudflared({
            onPhase: (phase, detail) => {
              tunnel.phase = phase
              if (detail) tunnel.detail = detail
            },
          })
          actualBin = result.path
          tunnel.bin = actualBin
          tunnel.detail = `${result.source === 'PATH' ? 'PATH 已有' : result.source === 'cache' ? '使用缓存' : '已下载'}：${actualBin}`
          // 自动解析成功后持久化解析结果：dsh 重启后 boot() 据此自动拉起隧道（常驻）
          void writeSettings({ cloudflared_bin: actualBin }).catch(() => { /* noop */ })
        } else {
          tunnel.bin = actualBin
        }
        const targetPort = lanePort ?? tunnel.port
        tunnel.phase = 'starting'
        tunnel.detail = '启动 cloudflared 子进程…'
        let child: ChildProcessByStdio<null, Readable, Readable>
        try {
          // 强制 HTTP/2（443）而非 QUIC（7844 UDP）：国内/企业网常屏蔽 UDP 7844 → tunnel error 1033，
          // 走 TCP 443 更稳。--no-autoupdate 跳过版本检查（启动更快）。
          child = spawn(actualBin, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${targetPort}`], { stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (e) {
          tunnel.phase = 'error'
          tunnel.message = String((e as { message?: unknown } | null | undefined)?.message ?? e)
          store.emit('tunnel', { url: null, reason: 'spawn-failed', message: tunnel.message })
          return
        }
        // 异步下载/解析期间用户可能已点停止 → 立即 kill 这个孤儿进程
        if (tunnel.stopping) {
          try { child.kill() } catch { /* noop */ }
          return
        }
        tunnel.child = child
        tunnel.startedAt = Date.now()
        tunnel.url = null
        tunnel.phase = 'registering'
        tunnel.detail = '连接 Cloudflare 边缘（通常 5-30 秒）…'
        let out = ''
        const timer = setTimeout(() => {
          child.emit('_cf_timeout')
        }, 45000)
        const tryParse = () => {
          const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
          if (m && !tunnel.stopping) {
            tunnel.url = m[0]
            tunnel.phase = 'ready'
            tunnel.detail = '已连接 Cloudflare 边缘'
            store.emit('tunnel', { url: tunnel.url })
          }
        }
        child.stdout.on('data', (c: Buffer) => {
          out += c.toString('utf8')
          tryParse()
        })
        child.stderr.on('data', (c: Buffer) => {
          out += c.toString('utf8')
          // cloudflared 偶发把 URL 写到 stderr
          tryParse()
        })
        child.on('error', (e) => {
          clearTimeout(timer)
          if (tunnel.child === child) tunnel.child = null
          tunnel.url = null
          tunnel.phase = 'error'
          tunnel.message = String((e as { message?: unknown } | null | undefined)?.message ?? e)
          store.emit('tunnel', { url: null, reason: 'spawn-failed', message: tunnel.message })
        })
        child.on('exit', () => {
          clearTimeout(timer)
          if (tunnel.child === child) tunnel.child = null
          // 仅在「非用户主动 stop」时把 phase 复位到 idle；stop 路径下 stopTunnel 已立刻写 idle，
          // 这里再写一次也无害（幂等），但跳过 error 状态（崩溃应保留 error 让 UI 显示诊断）
          if (tunnel.phase !== 'error') tunnel.phase = 'idle'
          if (tunnel.detail === '连接 Cloudflare 边缘（通常 5-30 秒）…') tunnel.detail = ''
          // 子进程已退出，stopping 复位允许下次 start
          tunnel.stopping = false
        })
        child.on('_cf_timeout', () => {
          clearTimeout(timer)
          if (!tunnel.url) {
            tunnel.phase = 'error'
            tunnel.message = 'cloudflared 45s 未上报 trycloudflare 地址'
            store.emit('tunnel', { url: null, reason: 'timeout' })
          }
        })
      } catch (e) {
        tunnel.phase = 'error'
        tunnel.message = String((e as { message?: unknown } | null | undefined)?.message ?? e)
        tunnel.detail = ((e as { message?: unknown } | null | undefined)?.message ?? String(e)) as string
      }
    })()
    return tunnel
  }

  // 停止隧道（kill 子进程，保留 bin 配置）。
  function stopTunnel(): void {
    const ch = tunnel.child;
    if (ch) {
      tunnel.stopping = true;
      tunnel.child = null;
      try { ch.kill(); } catch { /* noop */ }
      // SIGKILL 兜底：cloudflared 偶发不响应 SIGTERM（边缘网络残留），3s 后强杀
      const hardKill = setTimeout(() => { try { ch.kill('SIGKILL') } catch { /* noop */ } }, 3000);
      if (typeof hardKill.unref === 'function') hardKill.unref();
    }
    tunnel.startedAt = 0;
    tunnel.url = null;
    tunnel.phase = 'idle';        // 立即复位，UI 立刻不显示"运行中"
    tunnel.detail = '';
    tunnel.message = '';
    // tunnel.stopping 保持 true，由 child.on('exit') 在实际退出时复位；
    // 否则 kill→exit 之间 cloudflared 最后一帧 stdout 会触发 tryParse 把 url/phase 复活
  }

  // 配对/授权路由（先于上游转发）：
  function routePairing(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    // 路径分类：只认 lane 保留命名空间与冻结别名；返回 null 即「不归 lane 管」——
    // 包括 OPTIONS 预检与 dsh 自有路径，一律交还反代透传，lane 绝不代答（#145）。
    const path = laneRoutePath(req.url!.split('?')[0]!)
    if (path === null) return false;
    const authed = parseCookies(req.headers.cookie, 'dsh_mobile_session').some((c) => store.isDevice(c));
    const owner = isLocalOwner(req);
    const canManage = owner || authed;
    const unpaired401 = () => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unpaired' }));
    };
    // 属主控制台（同机 loopback 设置页）跨域读取配对状态：CORS 仅放行回环源
    const cors = {
      'access-control-allow-origin': allowCorsOrigin(req.headers.origin, req.headers.host) ?? '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'vary': 'Origin',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return true;
    }
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra });
      res.end(JSON.stringify(body));
    };
    // 远端数据面（#93）：已配对主机读取本机会话，用于对端渲染远端会话。只读。
    const readJsonBody = (handle: (payload: Record<string, unknown>) => void) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      req.on('end', () => {
        try { handle(JSON.parse(body || '{}') as Record<string, unknown>); }
        catch { json(400, { error: 'bad-request' }); }
      });
    };
    /** 某条会话日志的最后一条 seq；会话不存在或没有事件时为 undefined。 */
    const lastSeqOf = async (source: NonNullable<RemoteAccessServiceOptions['sessions']>, sessionId: string): Promise<number | undefined> => {
      const log = await source.readLog(sessionId);
      if (log === undefined || log.events.length === 0) return undefined;
      return log.events[log.events.length - 1]!.seq;
    };
    const sendSessions = async (target: string, offset?: unknown, limit?: unknown) => {
      const source = opts.sessions ?? null;
      if (source === null) { json(503, { error: 'sessions-unavailable' }); return; }
      try { json(200, paginateSessionHeaders(await listSessionsUnderPath(source, target), offset, limit)); }
      catch (error) { json(500, { error: 'read-failed', message: String((error as Error)?.message ?? error) }); }
    };
    if (path === '/api/remote/sessions' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const target = String(payload.path ?? '');
        if (target === '') { json(400, { error: 'bad-path' }); return; }
        void sendSessions(target, payload.offset, payload.limit);
      });
      return true;
    }
    if (path === '/api/remote/fs.list' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const target = String(payload.path ?? '');
        try { json(200, listLocalDirectory(target)); }
        catch (error) {
          // 目录不存在是正常的用户输入，不是服务端故障：回 404，界面才能提示「目录不存在」而不是「HTTP 500」。
          const code = String((error as NodeJS.ErrnoException)?.code ?? '')
          const missing = code === 'ENOENT' || code === 'ENOTDIR'
          json(missing ? 404 : 500, {
            error: missing ? 'not-found' : 'list-failed',
            message: String((error as Error)?.message ?? error),
          })
        }
      });
      return true;
    }
    // 事件分页（#107）：按 seq 游标取一页。全量 session.read 只留给旧客户端兼容。
    if (path === '/api/remote/session.page' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const sessionId = String(payload.sessionId ?? '');
        const afterSeq = parseAfterSeq(payload.afterSeq);
        // 参数非法在读日志之前就拒掉：游标错了会切出错误的一页，水位跟着错。
        if (sessionId === '' || afterSeq === undefined) { json(400, { error: 'bad-request' }); return; }
        // 镜像会话不是本机的会话（它是本机对别的设备的视图）：不对外提供，避免被再镜像一层。
        if (isMirrorId(sessionId)) { json(404, { error: 'not-found' }); return; }
        const source = opts.sessions ?? null;
        if (source === null) { json(503, { error: 'sessions-unavailable' }); return; }
        void (async () => {
          try {
            const log = await source.readLog(sessionId);
            if (log === undefined) { json(404, { error: 'not-found' }); return; }
            json(200, { header: log.header, ...sliceEventPage(log.events, afterSeq, clampPageLimit(payload.limit)) });
          } catch (error) {
            json(500, { error: 'read-failed', message: String((error as Error)?.message ?? error) });
          }
        })();
      });
      return true;
    }
    if (path === '/api/remote/session.read' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const source = opts.sessions ?? null;
        const sessionId = String(payload.sessionId ?? '');
        if (source === null) { json(503, { error: 'sessions-unavailable' }); return; }
        if (sessionId === '') { json(400, { error: 'bad-session' }); return; }
        if (isMirrorId(sessionId)) { json(404, { error: 'not-found' }); return; }
        void (async () => {
          try {
            const log = await source.readLog(sessionId);
            if (log === undefined) { json(404, { error: 'not-found' }); return; }
            json(200, log);
          } catch (error) {
            json(500, { error: 'read-failed', message: String((error as Error)?.message ?? error) });
          }
        })();
      });
      return true;
    }
    if (path === '/api/remote/stream' && req.method === 'GET') {
      if (!canManage) { unpaired401(); return true; }
      const cookie = parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? ''
      const deviceId = store.deviceIdOf(cookie)
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      // SSE：B 发起，A 保持连接往下推。首帧把当前分享列表交给 B，之后只推增量。
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const shares = leasedShares().filter((entry) => entry.deviceId === deviceId)
      warn?.(`dsh-remote-access: shares 查询 device=${deviceId} path=${remoteShares.path} total=${remoteShares.load().length}`)
      res.write(`event: ready\ndata: ${JSON.stringify({ shares })}\n\n`)
      // 设备（重）连上后内存里没有待答的卡片：把它订阅的会话上仍在等待的提问 / 审批重推一遍。
      for (const entry of shares) {
        for (const frame of interactionHub.framesOf(entry.sessionId)) {
          res.write(`event: interaction\ndata: ${JSON.stringify(frame)}\n\n`)
        }
      }
      const client = { deviceId, res }
      streamClients.add(client)
      // 心跳：15 秒一行注释，双方据此发现假活连接（不靠轮询）。
      const heartbeat = setInterval(() => {
        try { res.write(': ping\n\n') } catch { streamClients.delete(client) }
      }, 15000)
      if (typeof heartbeat.unref === 'function') heartbeat.unref()
      req.on('close', () => { clearInterval(heartbeat); streamClients.delete(client) })
      return true;
    }
    // 订阅（#151 / #152）：已配对设备登记它镜像了本机的哪条会话。之后这条会话的事件增量、提问、审批
    // 都会推给它；设备移除镜像时退订。订阅关系与旧的「分享」是同一张表：含义就是「这台设备在看这条会话」。
    if (path === '/api/remote/session.watch' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const cookie = parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? ''
      const deviceId = store.deviceIdOf(cookie)
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      readJsonBody((payload) => {
        const sessionId = String(payload.sessionId ?? '');
        if (sessionId === '') { json(400, { error: 'bad-request' }); return; }
        const others = remoteShares.load().filter((entry) => !(entry.sessionId === sessionId && entry.deviceId === deviceId));
        // 登记即续租：到期时刻随登记写入，设备定期重登记来续（#152）。
        remoteShares.save([...others, { sessionId, deviceId, path: String(payload.path ?? ''), sharedAt: Date.now(), expiresAt: leaseExpiresAt() }]);
        json(200, { ok: true, viewers: viewersOf(sessionId) });
      });
      return true;
    }
    if (path === '/api/remote/session.unwatch' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const cookie = parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? ''
      const deviceId = store.deviceIdOf(cookie)
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      readJsonBody((payload) => {
        const sessionId = String(payload.sessionId ?? '');
        remoteShares.save(remoteShares.load().filter((entry) => !(entry.sessionId === sessionId && entry.deviceId === deviceId)));
        json(200, { ok: true });
      });
      return true;
    }
    // 交互中继（#151）：设备把它用户给出的提问 / 审批答案交回来。请求号对不上或 A 这边已经落定时如实告知。
    if (path === '/api/remote/interaction.answer' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const answer = parseInteractionAnswer(payload);
        json(200, { ok: true, accepted: answer !== undefined && interactionHub.settle(answer) });
      });
      return true;
    }
    // Web UI 票据（#150）：登录地址必须由本机签发——对端自己「铸造令牌」产出的是它自己 lane 的地址。
    // 会话回推（#155）：已配对设备把它本地分支的尾部追加回本机的原会话。四个前提在这里一次查完：
    // 会话存在、没在运行、分叉点之后没有新事件、没有别的分支已回推过。先认领再写。
    if (path === '/api/remote/session.push' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const deviceId = store.deviceIdOf(parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? '')
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      readJsonBody((payload) => {
        const target = opts.pushback ?? null
        const source = opts.sessions ?? null
        if (target === null || source === null) { json(503, { error: 'pushback-unavailable' }); return }
        const sessionId = String(payload.sessionId ?? '')
        const afterSeq = Number(payload.afterSeq)
        const events = Array.isArray(payload.events) ? payload.events as RemoteSessionEvent[] : []
        if (sessionId === '' || !Number.isInteger(afterSeq) || afterSeq < 0 || events.length === 0) { json(400, { error: 'bad-request' }); return }
        // 回推的目标必须是本机自己的会话；镜像只是视图，不接受回推。
        if (isMirrorId(sessionId)) { json(200, { ok: false, reason: 'not-found', message: '设备上没有这条会话', exits: [] }); return }
        void (async () => {
          try {
            const decision = decidePushbackOnDevice({
              lastSeq: await lastSeqOf(source, sessionId),
              forkPoint: afterSeq,
              running: target.isRunning(sessionId),
              priorPush: pushbacks.load().find((record) => record.sessionId === sessionId),
            })
            if (!decision.ok) { json(200, { ok: false, reason: decision.reason, message: decision.message, exits: decision.exits }); return }
            // 先认领再写：认领落盘后别的分支一律被拒。写失败时按日志现状标注——没写进去就撤回认领让它可重试，
            // 写了一半就标 partial：拒绝再次回推，也不自动修（不留没人认领的半截）。
            pushbacks.save([...pushbacks.load().filter((record) => record.sessionId !== sessionId), { sessionId, deviceId, forkPoint: afterSeq, events: events.length, state: 'pushing', at: Date.now() }])
            try {
              await target.append(sessionId, events, deviceId, afterSeq)
            } catch (error) {
              const partial = (await lastSeqOf(source, sessionId).catch(() => undefined)) !== afterSeq
              if (partial) pushbacks.save(pushbacks.load().map((record) => record.sessionId === sessionId ? { ...record, state: 'partial' as const } : record))
              else pushbacks.save(pushbacks.load().filter((record) => record.sessionId !== sessionId))
              json(200, { ok: false, reason: 'push-failed', message: String((error as Error)?.message ?? error), partial })
              return
            }
            pushbacks.save(pushbacks.load().map((record) => record.sessionId === sessionId ? { ...record, state: 'done' as const } : record))
            json(200, { ok: true, appended: events.length })
          } catch (error) {
            json(500, { error: 'push-failed', message: String((error as Error)?.message ?? error) })
          }
        })()
      });
      return true;
    }
    // 在本机另起一条（#155 的出口之一）：用对端分支的全部内容作为种子建一条新会话，原会话不动。
    if (path === '/api/remote/session.fork' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const target = opts.pushback ?? null
        if (target === null) { json(503, { error: 'pushback-unavailable' }); return }
        const cwd = String(payload.cwd ?? '')
        const events = Array.isArray(payload.events) ? payload.events as RemoteSessionEvent[] : []
        if (cwd === '' || events.length === 0) { json(400, { error: 'bad-request' }); return }
        void (async () => {
          try { json(200, { ok: true, sessionId: await target.fork(cwd, events, String(payload.title ?? '')) }) }
          catch (error) { json(500, { error: 'fork-failed', message: String((error as Error)?.message ?? error) }) }
        })()
      });
      return true;
    }
    // 设备组网（#156）：A 当介绍人。以下几条都住在 lane 上，不经上游。
    // ① 同组设备清单：已配对设备来问，A 把「自己够得着的其它设备」连同桌指名给它的介绍凭证一起下发。
    //    顺带记下「谁被介绍给了谁」：中转（⑤）只对互相介绍过的设备开放，别的已配对设备不能借道。
    if (path === '/api/remote/peers' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const deviceId = store.deviceIdOf(parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? '')
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      if (opts.mesh === null || opts.mesh === undefined) { json(503, { error: 'mesh-unavailable' }); return true; }
      const peers = opts.mesh.peers(deviceId)
      for (const peer of peers) introGrants.set(`${deviceId}->${peer.deviceId}`, Date.now() + INTRO_GRANT_TTL_MS)
      json(200, { peers })
      return true;
    }
    // ② 核实介绍凭证：被介绍方拿着发起方出示的凭证来问 A「这是你签的吗、签给谁的」。
    //    只做签名与配对状态核查；发起方的地址与名字就在凭证里（A 签发时写进去的）。
    if (path === '/api/remote/intro.verify' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const deviceId = store.deviceIdOf(parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? '')
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      readJsonBody((payload) => {
        const intro = verifyIntro(laneWsTokenSecret(), String(payload.intro ?? ''))
        // 凭证必须是介绍给「来核实的那台设备」的；发起方此刻仍是本机的已配对设备。
        const requesterStillPaired = intro !== null && store.snapshotDevices().some((device) => device.deviceId === intro.to)
        if (intro === null || intro.peer !== deviceId || !requesterStillPaired) { json(200, { ok: false }); return }
        json(200, { ok: true, requester: { deviceId: intro.to, name: intro.toName, origin: intro.toOrigin } })
      });
      return true;
    }
    // ③ 发起方带着凭证来敲门（匿名：凭证即凭据）：被介绍方先向介绍人核实，再挂起等本机用户审批。
    //    这里绝不因为「双方都信任介绍人」就直接配对——同意与否由被介绍方的本机用户决定。
    if (path === '/api/pair/introduce' && req.method === 'POST') {
      readJsonBody((payload) => {
        const mesh = opts.mesh
        if (mesh === null || mesh === undefined) { json(503, { error: 'mesh-unavailable' }); return }
        const token = String(payload.intro ?? '')
        const introducer = payload.introducer as { origin?: unknown } | undefined
        const from = payload.from as { origin?: unknown; name?: unknown; model?: unknown } | undefined
        const introducerOrigin = typeof introducer?.origin === 'string' ? introducer.origin : ''
        const fromOrigin = typeof from?.origin === 'string' ? from.origin : ''
        if (token === '' || introducerOrigin === '' || fromOrigin === '') { json(400, { error: 'bad-request' }); return }
        void (async () => {
          let requester: Awaited<ReturnType<typeof mesh.verify>>
          try { requester = await mesh.verify(introducerOrigin, token) }
          catch { json(502, { error: 'introducer-unreachable', message: '连不上介绍人，无法核实这张介绍凭证' }); return }
          if (requester === null) { json(403, { error: 'intro-invalid', message: '介绍凭证无效或已过期' }); return }
          mesh.inbox.prune()
          const request = mesh.inbox.open({
            from: { origin: fromOrigin, name: typeof from?.name === 'string' && from.name !== '' ? from.name : requester.name, model: typeof from?.model === 'string' ? from.model : '' },
            introducer: { origin: introducerOrigin, name: requester.introducerName, deviceId: requester.deviceId },
          })
          json(200, { ok: true, pending: true, id: request.id })
        })()
      });
      return true;
    }
    // ④ 发起方轮询结果（匿名：请求号即凭据）：同意后拿到一次性配对令牌，走正常配对。
    if (path === '/api/pair/introduce.status' && req.method === 'POST') {
      readJsonBody((payload) => {
        const mesh = opts.mesh
        if (mesh === null || mesh === undefined) { json(503, { error: 'mesh-unavailable' }); return }
        const record = mesh.inbox.get(String(payload.id ?? ''))
        if (record === undefined) { json(200, { state: 'expired' }); return }
        if (record.state === 'pending') { json(200, { state: 'pending' }); return }
        if (record.state === 'rejected') { json(200, { state: 'rejected' }); return }
        const token = record.pairToken
        json(200, token === undefined ? { state: 'expired' } : { state: 'approved', token })
      });
      return true;
    }
    // ⑤ 中转（#156 的兜底）：已配对设备直连不上「介绍人介绍给它的另一台设备」时，请本机代为转发一次。
    if (path === '/api/remote/relay' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const deviceId = store.deviceIdOf(parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? '')
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      readJsonBody((payload) => {
        const mesh = opts.mesh
        if (mesh === null || mesh === undefined) { json(503, { error: 'mesh-unavailable' }); return }
        const deviceKey = String(payload.device ?? '')
        const target = mesh.relayTarget(deviceKey)
        const pathAndQuery = String(payload.target ?? '')
        if (target === null || !pathAndQuery.startsWith('/')) { json(404, { error: 'unknown-device' }); return }
        if ((introGrants.get(`${deviceId}->${deviceKey}`) ?? 0) <= Date.now()) { json(403, { error: 'not-introduced', message: '本机没有把你介绍给这台设备，不能借道' }); return }
        // 审计只记设备、目标与路径：转发的正文里可能是会话内容，不进日志。
        accessLog(['AUDIT relay', `device=${deviceId}`, `target=${deviceKey}`, `path=${pathAndQuery.split('?')[0] ?? ''}`]);
        const method = String(payload.method ?? 'POST')
        if (method !== 'GET' && method !== 'POST') { json(400, { error: 'bad-request' }); return }
        void (async () => {
          try {
            const response = await fetch(`${target.origin}${pathAndQuery}`, {
              method,
              headers: { 'content-type': 'application/json', cookie: `dsh_mobile_session=${target.cookie}` },
              ...(method === 'POST' ? { body: typeof payload.body === 'string' ? payload.body : '{}' } : {}),
              signal: AbortSignal.timeout(20_000),
            })
            json(200, { status: response.status, contentType: response.headers.get('content-type') ?? 'application/json', body: await response.text() })
          } catch (error) {
            json(502, { error: 'relay-failed', message: String((error as Error)?.message ?? error) })
          }
        })()
      });
      return true;
    }
    // 这里只签一张一次性、短时有效的票据；浏览器拿着它到下面的 /webui 兑换。
    if (path === '/api/remote/webui-ticket' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      const deviceId = store.deviceIdOf(parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? '')
      if (deviceId === null) { json(401, { error: 'unpaired' }); return true; }
      const record = webuiTickets.issue(deviceId)
      const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0]?.trim() || 'http'
      // 审计只记设备与结果：票据就在 URL 里，不记 URL。
      accessLog(['AUDIT webui-ticket.issue', `device=${deviceId}`, 'result=issued']);
      json(200, { url: `${proto}://${String(req.headers.host ?? '')}${LANE_PREFIX}/webui?ticket=${encodeURIComponent(record.ticket)}`, expiresInMs: WEBUI_TICKET_TTL_MS });
      return true;
    }
    if (path === '/webui' && req.method === 'GET') {
      // 浏览器凭票据来兑。兑成就把该设备的会话种进浏览器再跳进应用——门禁只认配对会话，
      // 匿名请求连 ?token= 都过不了。被拒时给一页能照着做的说明，绝不回显票据。
      const ticket = new URL(req.url ?? '/', 'http://x').searchParams.get('ticket') ?? ''
      const redeemed = webuiTickets.redeem(ticket)
      accessLog(['AUDIT webui-ticket.redeem', `device=${redeemed.ok ? redeemed.deviceId : '-'}`, `result=${redeemed.ok ? 'ok' : redeemed.reason}`]);
      const refuse = (status: number, reason: 'invalid' | 'used' | 'expired'): boolean => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><title>打不开设备</title><body style="font-family:sans-serif;padding:32px;background:#f5f5f7;color:#1d1d1f"><h2>打不开这台设备的 DSH</h2><p>${webuiRefusalMessage(reason)}</p></body>`);
        return true;
      }
      if (!redeemed.ok) return refuse(redeemed.reason === 'expired' ? 410 : 403, redeemed.reason)
      const session = store.renew(redeemed.deviceId, null)
      if (session === null) return refuse(403, 'invalid')
      res.writeHead(302, {
        location: '/',
        'set-cookie': 'dsh_mobile_session=' + session.cookie + '; HttpOnly; Path=/; SameSite=Lax',
        'cache-control': 'no-store',
      });
      res.end();
      return true;
    }
    if (path === '/api/remote/shares' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      // 对端凭自己的设备 cookie 认领分享：只返回分享给这台设备的会话。
      const cookie = parseCookies(req.headers.cookie, 'dsh_mobile_session')[0] ?? ''
      const deviceId = store.deviceIdOf(cookie)
      json(200, { shares: remoteShares.load().filter((entry) => entry.deviceId === deviceId) })
      return true;
    }
    if (path === '/api/remote/session.import' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      // 对端往本机会话存储里写属于旧的推送流程，已被「回推（#155）」取代，对应票落地前不开放。
      if (!REMOTE_IMPORT_ENABLED) { json(403, { error: 'remote-readonly', message: remoteReadonlyRefusal('session/import') }); return true; }
      readJsonBody((payload) => {
        const source = opts.sessions ?? null;
        const log = payload.log as { header?: { id?: unknown }, events?: unknown } | undefined
        const cwd = String(payload.cwd ?? '')
        if (source === null || typeof source.writeLog !== 'function') { json(503, { error: 'sessions-unavailable' }); return; }
        if (log === undefined || typeof log.header?.id !== 'string' || !Array.isArray(log.events)) { json(400, { error: 'bad-log' }); return; }
        if (cwd === '') { json(400, { error: 'bad-cwd' }); return; }
        void (async () => {
          try {
            const written = await source.writeLog!(log as never, cwd)
            json(200, { ok: true, sessionId: log.header!.id, events: written })
          } catch (error) {
            json(500, { error: 'import-failed', message: String((error as Error)?.message ?? error) });
          }
        })();
      });
      return true;
    }
    if (path === '/pair') {
      const token = new URL(req.url!, 'http://x').searchParams.get('token') ?? '';
      // 浏览器配对：Accept 含 text/html → 自动接受 + 种 cookie + 302 进应用；
      // API 探活 / 属主状态（无 token）→ 保持 JSON 状态。
      const wantsHtml = String(req.headers.accept ?? '').includes('text/html');
      if (token) {
        const session = store.accept(token, {
          ua: req.headers['user-agent'] ?? '',
          ip: clientIp(req),
          entry: entryKind(req),
        });
        if (session) {
          res.writeHead(302, {
            'location': '/',
            'set-cookie': 'dsh_mobile_session=' + session.cookie + '; HttpOnly; Path=/; SameSite=Lax',
          });
          res.end();
          return true;
        }
        // token 无效或已作废：API 返回 403 JSON；浏览器渲染简短提示页。
        if (wantsHtml) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<!doctype html><meta charset="utf-8"><title>配对失败</title><body style="font-family:sans-serif;padding:32px;background:#f5f5f7;color:#1d1d1f"><h2>配对失败</h2><p>链接无效或令牌已过期。请在桌面「远程访问」设置中重新铸造令牌。</p></body>');
          return true;
        }
        json(403, { error: 'invalid-token' });
        return true;
      }
      json(200, { ok: true, mode: store.token ? 'await-token' : 'no-token', tokenLen: 0 });
      return true;
    }
    if (path === '/api/pair/info' && req.method === 'GET') {
      // 属主 + 已配对设备：配对候选地址（二维码/链接用）；已配对设备需要 uiTheme
      // 让注入脚本同步桌面主题偏好（视觉一致，§2.2）。
      if (!canManage) { unpaired401(); return true; }
      const interfaces: NetworkInterfacesLike = os.networkInterfaces?.() ?? {}
      const lanIp = selectLanIPv4(interfaces);
      // 地址候选：`.local` 主机名 + 多网卡 IP 并存（手机端按平台择优；无候选回环）。
      const baseCandidates = resolveBaseCandidates({ hostname: os.hostname(), interfaces, port: tunnel.port });
      let customTunnelUrl = customTunnel;
      if (!customTunnelUrl) {
        try { customTunnelUrl = readSetting('tunnel_url') ?? ''; } catch { /* noop */ }
      }
      json(200, {
        lanePort: tunnel.port,
        // #145：状态按 profile 隔离，把当前 profile 与落点报出来方便排查。
        profile: currentProfileScope(),
        storageDir: profileStorageDir(),
        lanIp,
        baseCandidates,
        tunnelUrl: tunnel.url,
        customTunnelUrl,
        uiTheme: readUiThemePreference(),
        dshAuth: dshAuth.hasCredential(),
        // #175：会话守卫的退避基数（移动端壳开机读；缺省 10s，原硬编码 2s 弱网抖动大）。
        guard: { backoffBaseMs: readMobileGuardBackoff() },
        // #108：两侧版本与协议版本随配对信息一起下发，对端据此判三态；
        // 字段只增不改，旧客户端忽略它们即可。
        version: readPluginVersion(),
        protocolVersion: REMOTE_PROTOCOL_VERSION,
      });
      return true;
    }
    if (path === '/api/pair/ws-token' && req.method === 'POST') {
      // 直连令牌：把会话换成一个 URL 可携带的签名令牌（WS 不能带请求头），
      // 之后 WS（路径前缀）与 HTTP（Bearer）都直连 lane，壳不再转发。
      if (!canManage) { unpaired401(); return true; }
      const meta = { ua: req.headers['user-agent'] ?? '', ip: clientIp(req), entry: entryKind(req) };
      const session = parseCookies(req.headers.cookie, 'dsh_mobile_session').find((c) => store.isDevice(c, meta));
      if (session === undefined) { unpaired401(); return true; }
      json(200, { token: mintWsToken(laneWsTokenSecret(), session) });
      return true;
    }
    if (path === '/api/pair/tunnel' && req.method === 'POST') {
      // 保存第三方隧道地址（cpolar 等）用于生成配对二维码；空串清除。
      // 作用域两级（#145）：已配对设备＝完整访问（管理动作不再限属主）；匿名/未配对 401。
      if (!canManage) { unpaired401(); return true; }
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        try {
          const { url } = JSON.parse(body || '{}') as { url?: unknown }
          if (typeof url !== 'string') { json(400, { error: 'bad-request' }); return; }
          const trimmed = url.trim();
          if (trimmed && !/^https?:\/\//.test(trimmed)) { json(400, { error: 'bad-request' }); return; }
          customTunnel = trimmed; // 内存态立即生效（重启后从 settings.yaml 恢复）
          void writeSettings({ tunnel_url: trimmed }).catch((e) => {
            try { warn?.('[dsh-remote-access] 隧道地址持久化失败: ' + e); } catch { /* noop */ }
          })
          json(200, { ok: true, url: trimmed });
        } catch (e) {
          json(400, { error: 'bad-request' });
        }
      });
      return true;
    }
    if (path === '/api/pair/mint' && req.method === 'POST') {
      // 铸造新令牌（旧令牌自动作废）
      // 作用域两级（#145）：已配对设备也可铸造令牌（管理＝完整访问）。
      if (!canManage) { unpaired401(); return true; }
      const token = store.mint();
      json(200, { ok: true, token, expiresAt: store.tokenExpiresAt });
      return true;
    }
    if (path === '/api/pair/probe' && req.method === 'GET') {
      // 校验第三方隧道地址（cpolar 等）：要求 http(s) URL，探测其配对入口路由
      // 可达（改写反代放行）；loopback 与 tauri.localhost 拒绝。
      // 作用域两级（#145）：已配对设备同样可探测隧道地址。
      if (!canManage) { unpaired401(); return true; }
      const raw = new URL(req.url!, 'http://x').searchParams.get('url') ?? '';
      void runProbe(raw, json);
      return true;
    }
    if (path === '/api/pair/accept' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        try {
          const { token, name } = JSON.parse(body || '{}') as { token?: unknown; name?: unknown }
          const session = store.accept(token as string, {
            name: name as string | undefined,
            ua: req.headers['user-agent'] ?? '',
            ip: clientIp(req),
            entry: entryKind(req),
          })
          if (!session) {
            json(403, { error: 'invalid-token' });
            return;
          }
          json(200, { ok: true, deviceId: session.deviceId, model: localModel() }, {
            'set-cookie': 'dsh_mobile_session=' + session.cookie + '; HttpOnly; Path=/; SameSite=Lax',
          });
        } catch (e) {
          json(400, { error: 'bad-request' });
        }
      });
      return true;
    }
    if (path === '/api/pair/renew' && req.method === 'POST') {
      // 设备 cookie 续取：凭持久化的 deviceId 取回会话 cookie（客户端 cookie 丢失时
      // 的恢复通道，桌面壳与手机共用）。未知设备 403，客户端重新铸造令牌配对。
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        try {
          const { deviceId } = JSON.parse(body || '{}') as { deviceId?: unknown }
          const session = typeof deviceId === 'string' ? store.renew(deviceId, {
            ua: req.headers['user-agent'] ?? '',
            ip: clientIp(req),
            entry: entryKind(req),
          }) : null;
          if (!session) {
            json(403, { error: 'unknown-device' });
            return;
          }
          json(200, { ok: true, deviceId: session.deviceId }, {
            'set-cookie': 'dsh_mobile_session=' + session.cookie + '; HttpOnly; Path=/; SameSite=Lax',
          });
        } catch (e) {
          json(400, { error: 'bad-request' });
        }
      });
      return true;
    }
    if (path === '/api/pair/devices' && req.method === 'GET') {
      if (!canManage) { unpaired401(); return true; }
      json(200, { devices: store.snapshotDevices(), tokenRef: store.ref() });
      return true;
    }
    if (path === '/api/pair/remove' && req.method === 'POST') {
      // 移除单个设备配对（属主控制台与已配对设备同级，作用域两级，#145）。
      if (!canManage) { unpaired401(); return true; }
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        try {
          const { deviceId } = JSON.parse(body || '{}') as { deviceId?: unknown }
          if (typeof deviceId !== 'string' || !store.removeDevice(deviceId)) {
            json(404, { error: 'not-found' });
            return;
          }
          json(200, { ok: true });
        } catch (e) {
          json(400, { error: 'bad-request' });
        }
      });
      return true;
    }
    if (path === '/api/pair/stop' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      store.stopAll();
      json(200, { ok: true });
      return true;
    }
    if (path === '/api/pair/events') {
      if (!canManage) { unpaired401(); return true; }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        ...cors,
      });
      res.write(':ok\n\n');
      const off = store.on((event, data) => res.write(store.sse(event, data)));
      req.on('close', off);
      return true;
    }
    if (path === '/api/pair/cloudflared' && req.method === 'GET') {
      // 查询隧道配置与运行状态（已配对设备可读，#145 完整访问）。
      if (!canManage) { unpaired401(); return true; }
      json(200, {
        bin: tunnel.bin,
        url: tunnel.url,
        running: !!tunnel.child,
        startedAt: tunnel.startedAt,
      });
      return true;
    }
    if (path === '/api/pair/cloudflared' && req.method === 'POST') {
      // 设置 cloudflared 路径（应用并持久化）或停止隧道（已配对设备可管，#145）。
      if (!canManage) { unpaired401(); return true; }
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', async () => {
        try {
          const { bin, action } = JSON.parse(body || '{}') as { bin?: unknown; action?: unknown }
          if (action === 'stop') {
            stopTunnel();
            json(200, { ok: true, running: false });
            return;
          }
          if (typeof bin !== 'string') {
            json(400, { error: 'bad-request' });
            return;
          }
          const trimmed = bin.trim();
          if (trimmed && !/^[^\0]+$/.test(trimmed)) {
            json(400, { error: 'bad-request' });
            return;
          }
          // 持久化经 dsh settings 服务；空串 = 进入 auto 模式（不固化路径）。
          let saved = true;
          if (trimmed) {
            try {
              await writeSettings({ cloudflared_bin: trimmed });
              const persisted = readSetting('cloudflared_bin');
              if (persisted !== trimmed) saved = false;
            } catch (e) {
              saved = false;
              try { warn?.('[dsh-remote-access] cloudflared 配置持久化失败: ' + e); } catch { /* noop */ }
            }
          } else {
            try { await writeSettings({ cloudflared_bin: '' }); } catch { /* 忽略 */ }
          }
          startTunnel(trimmed || null, tunnel.port);
          json(200, { ok: true, running: !!tunnel.child, bin: trimmed || null, phase: tunnel.phase, persisted: saved });
        } catch (e) {
          json(400, { error: 'bad-request' });
        }
      });
      return true;
    }
    return false;
  }

  // 第三方隧道地址探测（异步；结果经 json 回调写出）。
  async function runProbe(raw: string, json: (status: number, body: Record<string, unknown>) => void): Promise<void> {
    const verdict: { ok: boolean; reason: string; status?: number } = { ok: false, reason: 'invalid-url' };
    const m = String(raw).match(/^(https?):\/\/([^/]+)(\/.*)?$/)
    if (m) {
      const scheme = m[1] ?? ''
      const host = m[2] ?? ''
      const isLoopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || /^\[::1\]/.test(host)
      const isTuna = /tauri\.localhost$/i.test(host)
      if (!isLoopback && !isTuna) {
        try {
          const doFetch = fetchImpl ?? ((u: string, o?: RequestInit) => fetch(u, o))
          const ctrl = new AbortController()
          const timer = setTimeout(() => ctrl.abort(), 5000)
          const r = await doFetch(scheme + '://' + host + '/pair', { signal: ctrl.signal, headers: { Connection: 'close' } });
          clearTimeout(timer)
          verdict.ok = r.ok || r.status === 404
          verdict.status = r.status
          verdict.reason = verdict.ok ? 'reachable' : 'http-' + r.status
        } catch {
          verdict.reason = 'unreachable'
        }
      } else {
        verdict.reason = 'loopback-or-tuna-not-allowed'
      }
    }
    json(200, verdict);
  }

  // 包裹 server 的 request 处理：优先路由，其次反代。
  const originalHandler = proxy.server.listeners('request')[0] as (req: http.IncomingMessage, res: http.ServerResponse) => void
  proxy.server.removeAllListeners('request');
  proxy.server.on('request', (req, res) => {
    if (routePairing(req, res)) return;
    originalHandler(req, res);
  });

  return {
    store,
    localAddressToward,
    localModel,
    shares: remoteShares,
    proxy,
    dshAuth,
    routePairing,
    selectLanIPv4,
    buildPairLink,
    buildHttpPairLink,
    normalizeRemote,
    tunnel,
    startTunnel,
    stopTunnel,
    pushSessionEvent(sessionId, events) {
      if (streamClients.size === 0) return
      const devices = new Set(leasedShares().filter((entry) => entry.sessionId === sessionId).map((entry) => entry.deviceId))
      if (devices.size === 0) return
      const payload = `event: session/events\ndata: ${JSON.stringify({ sessionId, events })}\n\n`
      for (const client of [...streamClients]) {
        if (!devices.has(client.deviceId)) continue
        try { client.res.write(payload) } catch { streamClients.delete(client) }
      }
    },
    pushShareChange(deviceId, kind, sessionId) {
      const payload = `event: share/${kind}\ndata: ${JSON.stringify({ sessionId })}\n\n`
      for (const client of [...streamClients]) {
        if (client.deviceId !== deviceId) continue
        try { client.res.write(payload) } catch { streamClients.delete(client) }
      }
    },
    viewerCount: viewersOf,
    pruneShareLeases: pruneLeases,
    pushInteraction,
    relayInteraction,
    revokeWebuiTickets: (deviceId: string): number => webuiTickets.revokeDevice(deviceId),
    probe: runProbe, // #167：插件入口 apply 的 RPC 分支需要探测入口（私有函数跨作用域不可见）
    mdns,
    startAdvertising,
    stopAdvertising,
    listen: (port = 0) => new Promise<number>((res, rej) => {
      // 0.0.0.0：局域网设备直连（配对门禁保护未配对路径；宿主 dsh 仍只面 loopback）。
      // 端口被占（EADDRINUSE）必须走 rej 让 boot 优雅降级——server 的 'error' 事件
      // 若无人接会成为未捕获异常，直接带崩 dsh 宿主进程（实测 3091 冲突致整包闪退）。
      const onErr = (e: Error) => {
        proxy.server.removeListener('listening', onOk);
        rej(e);
      };
      const onOk = async () => {
        proxy.server.removeListener('error', onErr);
        const addr = proxy.server.address();
        if (addr && typeof addr === 'object') { tunnel.port = addr.port; tunnel.listening = true }
        proxy.server.on('error', (e) => { try { warn?.('[dsh-remote-access] lane server error: ' + (e?.message ?? e)); } catch { /* noop */ } });
        // 端口确定后开始广播（发现 ≠ 授权：记录里没有任何令牌）。
        await startAdvertising(tunnel.port);
        res(tunnel.port);
      };
      proxy.server.once('error', onErr);
      proxy.server.listen(port, '0.0.0.0', onOk);
    }),
    close: async () => {
      await stopAdvertising();
      await new Promise<void>((res) => proxy.server.close(() => res()));
    },
  };
}

/**
 * 取某个 cookie 的**全部**候选值（#195 延伸）：RFC 6265 允许客户端重复发 Cookie 头，
 * Node 会把重复头用逗号并成一条；iOS 的 NSURLSession 还会把 Cookie 存储里的值再补一份。
 * 单值解析遇到「A,A」会整体比对失败，这里按 `;` 与 `,` 切开逐条返回，交给调用方任一命中即通过。
 */
export function parseCookies(header: string | undefined | null, name: string): string[] {
  const out: string[] = []
  if (!header) return out;
  for (const part of header.split(/[;,]/)) {
    const i = part.indexOf('=')
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== name) continue;
    const v = part.slice(i + 1).trim()
    if (v) out.push(v)
  }
  return out;
}

/** 取某个 cookie 的首个候选值（无则空串）。 */
export function parseCookie(header: string | undefined | null, name: string): string {
  return parseCookies(header, name)[0] ?? '';
}

// CORS 源白名单：仅放行来自回环（本机 dsh 设置页）与壳协议页（#154）的跨域读取；其它 Origin 一律不回显。
// #154：桌面壳页面 origin 是壳自己的协议（dshapp://localhost / http://dshapp.localhost），
// 设置面板的 lane 请求从那个页面上发出，白名单同步放行（仍是本机，非远程源）。
export function allowCorsOrigin(origin: string | undefined | null, _hostHeader?: string | undefined | null): string | null {
  if (!origin) return null;
  const o = String(origin);
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(o)) return o;
  if (/^dshapp:\/\/localhost$/.test(o)) return o;
  if (/^https?:\/\/dshapp\.localhost$/.test(o)) return o;
  return null;
}

/** dsh settings 服务（本包只用到注册与读命名空间两件事）。 */
export interface SettingsService {
  register(namespace: string, schema: unknown): void
  get(namespace: string): Record<string, unknown> | undefined
}

/** dsh connection 服务（本包用到 authenticatedUrl 与控制面 fetch 注册）。 */
export interface ConnectionService {
  authenticatedUrl?: (origin: string) => string | null
  rpc?: { handle?: unknown }
  /**
   * 官方凭据注册点（#145）：lane 把已配对设备的会话 cookie 接进官方鉴权链，
   * 让远端请求在官方语义里成为一个真正的 owner Peer，而不是靠反代伪装。
   */
  authentication?: {
    register?: (provider: { authenticate: (request: { headers: Record<string, string | string[] | undefined> }) => unknown }) => () => Promise<void>
  }
  /** 官方 Peer 工厂：provider 自己创建并持有 Peer。 */
  createPeer?: (options: { principal: { kind: 'owner' } }) => unknown
  fetch?: {
    register?: (route: {
      path: string
      methods: string[]
      requestBody: string
      fetch: (request: Request) => Promise<Response>
    }) => void
  }
}

/** cordis 插件上下文（本包只用到其中几个能力面）。 */
export interface LaneRuntimeContext {
  on(event: string, listener: (...args: never[]) => void): void
  get?(service: string): unknown
  inject?(deps: string[], fn: (scope: LaneRuntimeContext) => void): void
  logger?: {
    info?: (message: string) => void
    warn?: (message: string) => void
    error?: (message: string) => void
  }
  webServer?: { port?: number }
  settings?: SettingsService | null
  connection?: ConnectionService | null
}

/** lane 运行时（插件入口与单测共用）。 */
export interface LaneRuntime {
  svc: RemoteAccessService
  ready: Promise<void>
  dispose: () => Promise<unknown>
}

/**
 * dsh bundle 插件 host 半区入口：随 dsh web 进程装载时启动 lane 改写反代与配对服务。
 * 配置走环境变量（桌面壳 spawn 时注入）：
 *   DSH_REMOTE_ENABLED        = '0' 关闭（默认开）
 *   DSH_REMOTE_LANE_PORT      = lane 端口（默认 3091）
 *   DSH_DESKTOP_PORT          = 上游 dsh web 端口（默认 3080）
 *   DSH_CLOUDFLARED_BIN       = cloudflared 可执行文件路径（设置后自动起隧道）
 * 生命周期：ctx dispose 时关闭 lane 并回收 cloudflared 子进程。
 * 注：桌面壳插件的 host 半区若无需启动服务（如 dsh-desktop-plus 仅技能）可留空 apply。
 *
 * 硬依赖：connection（ctx.connection.rpc.handle）—— 同源 RPC 通道是 client/host 通讯的
 * 唯一途径，无 connection 即无法响应桌面壳 WebView 的端点请求，必须声明 inject。
 * settings（ctx.settings）—— 远程访问设置项（cloudflared_bin/tunnel_url/ws_*）经
 * dsh settings 服务持久化（namespace: dsh-desktop-plus，与桌面壳共用，透传型 schema
 * 由桌面壳插件或本插件兜底注册），不再直接读写 settings.yaml。
 * Cordis 的 Guard 会拒绝任何未声明的 ctx.<service> 访问并让整个 plugin tree 装载失败
 * （下游所有插件如 dsh-session-log-export 也会被级联报 "failed to load"）。
 */
// 可选服务用 ctx.get，必需服务走 required：property 代理对拓扑敏感（见 upstream packages/AGENTS.md）。
// sessionPersistence / sessions 必须声明：镜像会话要落盘，官方 resume / commands.list 才找得到它。
// 之前只用 ctx.get 松散取，取不到时镜像就退化成内存态，命令面板与权限切换随之失效。
// connection.authentication 必须声明：startLaneRuntime 直接读这个官方子服务（#145 把配对身份接进鉴权链），
// Cordis 守卫对未声明的子服务属性直接抛错，整个 apply 失败——lane 不启动、控制面不注册，界面上没有任何提示。
export const inject = ['connection', 'connection.authentication', 'settings', 'webServer', 'sessionPersistence', 'sessions'];

// 设置访问器：优先 dsh settings 服务（namespace 注册由桌面壳插件或本插件兜底），
// 服务不可用时回退 legacy 行级读写（独立运行/老版 dsh）。
const NS = 'dsh-desktop-plus';



/**
 * 启动 lane 运行时（插件入口与单测共用）：监听端口 → 广播 mDNS → 就绪。
 *
 * 与 apply 的区别只在于「可测」：这里返回 `{ svc, ready, dispose }`，调用方自己决定何时
 * dispose；apply 只是它的薄包装（cordis 插件入口约定：apply(ctx) 无返回值）。
 *
 * @param ctx cordis 插件上下文
 * @param opts 覆盖项（测试注入假广播器等）
 * @returns 未启用时返回 null
 */
export function startLaneRuntime(ctx: LaneRuntimeContext, opts: { mdns?: MdnsRuntimeOptions } = {}): LaneRuntime | undefined {
  const platform = typeof process !== 'undefined' ? process.platform : ''
  if (!platform || !ctx || typeof ctx.on !== 'function') return;
  // 配置优先级（#145 独立发布）：插件设置 > 环境变量 > 缺省。
  //
  // 环境变量是桌面壳 spawn 时注入的旧通道，现在降为兼容层：不设任何 DSH_* 也能起 lane，
  // 设置从 $DSH_HOME/storages/remote-access/ 读（与 pairing.json 同一落点）。
  // 这样插件装进任意 profile 都能用，不依赖桌面壳。
  const readConfig = (key: string): string | null => {
    const fromStore = readRemoteSetting(key)
    if (fromStore !== null) return fromStore
    const fromEnv = process.env[key]
    return fromEnv === undefined || fromEnv === '' ? null : fromEnv
  }
  if (readConfig('DSH_REMOTE_ENABLED') === '0') return;
  // let：端口被占时会改取空闲端口（见 boot）。
  let lanePort = Number(readConfig('DSH_REMOTE_LANE_PORT') ?? 3091);
  // lane 彻底起不来时的原因；mint 据此直接失败，不再发出指向别人 lane 的链接。
  let laneFailure: string | null = null
  // mDNS 广播：默认开启（DSH_REMOTE_MDNS=0 可关）；测试注入假广播器。
  const mdns = opts.mdns ?? { enabled: readConfig('DSH_REMOTE_MDNS') !== '0' };
  // 事件通道：host 侧一有变更就把事件推给页面，客户端据此立刻重画徽标，不再轮询。
  // 轮询只能兜底「上次拉取之后变了什么」，具体事件（配对、认领、分享、工作区增删）都是明确的，
  // 发生后立即推送，界面就是秒级。
  const eventClients = new Set<import('node:http').ServerResponse>()
  // 长轮询等待者：页面调 remoteEvents.wait 后挂起，事件一到立刻返回。
  // 这比定时轮询准——请求不会平白醒来，只有真正发生变化才回。
  const eventWaiters = new Set<(events: string[]) => void>()
  const pendingEvents: string[] = []
  const broadcastEvent = (type: string, detail: Record<string, unknown> = {}): void => {
    const payload = JSON.stringify({ type, ...detail })
    if (eventWaiters.size > 0) {
      const waiters = [...eventWaiters]
      eventWaiters.clear()
      for (const resolve of waiters) resolve([payload])
    } else if (pendingEvents.length < 32) {
      // 没有等待者时先攒着：下一次 wait 立刻拿到，不丢事件。
      pendingEvents.push(payload)
    }
    if (eventClients.size === 0) return
    const frame = `data: ${payload}\n\n`
    for (const client of [...eventClients]) {
      try { client.write(frame) } catch { eventClients.delete(client) }
    }
  }
  // upstream 端口：显式 env 优先；否则端口文件（壳在 dsh web ready 后写入，端口动态时用）；最后回退 3080。
  const resolveUpstreamPort = () => {
    // 本插件就跑在 dsh web 的宿主进程里：webServer 就是上游本体，端口最准；
    // env 与端口文件是壳侧注入的备援（宿主重建窗口等场景），最后才回退 3080。
    const viaWebServer = Number(ctx?.webServer?.port || 0);
    if (viaWebServer > 0) return viaWebServer;
    const explicit = Number(process.env.DSH_DESKTOP_PORT || 0);
    if (explicit > 0) return explicit;
    const file = process.env.DSH_DESKTOP_PORT_FILE;
    if (file) { try { const v = Number(fs.readFileSync(file, 'utf8').trim()); if (v > 0) return v; } catch { /* not written yet */ } }
    return 3080;
  };
  const upstreamPort = resolveUpstreamPort;
  // 设置访问器：优先 dsh settings 服务（不直接读写 settings.yaml），服务不可用时回退 legacy 行级读写。
  const settingsSvc: SettingsService | null = (typeof ctx.get === 'function' ? ctx.get('settings') as SettingsService | undefined : undefined) ?? ctx.settings ?? null;
  // 兜底注册（桌面壳插件缺失时）：与 dsh-settings 契约对齐的最小 schema——
  // 可调用归一 + toJSON 序列化（缺 toJSON 会让 describe() 报错，连带其它命名空间读链路）。
  if (settingsSvc) {
    try {
      const passthrough = Object.assign(
        (raw: unknown): Record<string, unknown> => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}),
        { type: 'object', dict: {}, toJSON: () => ({ type: 'object', dict: {} }) },
      )
      settingsSvc.register(NS, passthrough)
    } catch { /* 已注册（桌面壳插件先注册） */ }
  }
  // #145 独立发布：设置权威落点是插件自己的 $DSH_HOME/storages/remote-access/settings.json。
  // 壳的 desktop-settings.json 与 dsh settings 命名空间降为旧数据读取兜底（读一次，下次写入
  // 就落到插件自己的文件）——插件装进任意 profile 都能用，不依赖桌面壳。
  const readSetting = (key: string): string | null => {
    const own = readRemoteSetting(key)
    if (own !== null) return own
    if (settingsSvc) {
      const v = settingsSvc.get(NS)?.[key]
      if (v !== undefined && v !== null) return v as string | null
    }
    return readSettingsString(key);
  };
  const writeSettings = async (patch: Record<string, unknown>): Promise<void> => {
    // #145：写插件自己的设置文件（与 pairing.json 同一目录），不再依赖壳的 desktop-settings.json。
    for (const [key, value] of Object.entries(patch)) writeRemoteSetting(key, value);
  };
  // 会话来源：lane 数据面读日志、命令面写日志（推送到远程）共用同一份。
  const sessionSource = buildRemoteSessionSource((name) => {
    try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined; } catch { return undefined; }
  })
  /**
   * 远端分支回推（#155）在设备侧的落点：把分支尾部追加进本机的一条会话日志，或用分支内容另起一条。
   * 都走官方持久化的写句柄（与镜像同步同一条路），校验与原子性由官方 append 保证。
   */
  const refreshProjectionOf = async (sessionId: string): Promise<void> => {
    try {
      const log = await sessionSource.readLog(sessionId)
      if (log === undefined) return
      const projection = (typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : undefined) as MirrorProjectionCacheLike | undefined
      projection?.coldSnapshot(mirrorHeader(sessionId, log.header.cwd, normalizeCreatedAt(log.header.createdAt)), 0, log.events)
    } catch { /* 投影写不进去只是列表晚一点更新 */ }
  }
  const pushbackHooks = {
    isRunning: (sessionId: string): boolean => {
      try {
        // 「在运行」只看官方代理的状态：会话对象在一轮结束后还会在内存里待很久，那不是在运行。
        const agents = typeof ctx.get === 'function' ? (ctx.get('agents') as { get?: (sessionId: string) => { status?: unknown } | undefined } | undefined) : undefined
        return agents?.get?.(sessionId)?.status === 'running'
      } catch { return false }
    },
    append: async (sessionId: string, events: readonly RemoteSessionEvent[], deviceId: string, afterSeq: number): Promise<void> => {
      const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as MirrorPersistenceLike | undefined
      if (persistence?.open === undefined) throw new Error('本机不支持向已有会话追加事件')
      const handle = await persistence.open(sessionId, 'write')
      if (handle === undefined) throw new Error('会话不存在')
      try { await handle.append?.(events); await handle.flush?.() } finally { await handle.close?.() }
      // 出处事件：官方校验若不认这个类型就不写进日志（登记表里仍有出处），不让它拖垮整次回推。
      try {
        const again = await persistence.open(sessionId, 'write')
        if (again !== undefined) {
          try { await again.append?.([pushbackProvenanceEvent(afterSeq + events.length, Date.now(), deviceId, afterSeq, events.length)]); await again.flush?.() }
          finally { await again.close?.() }
        }
      } catch { /* 出处只留在登记表 */ }
      await refreshProjectionOf(sessionId)
    },
    fork: async (cwd: string, events: readonly RemoteSessionEvent[], _title: string): Promise<string> => {
      const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as SessionPersistenceLike | undefined
      if (persistence === undefined) throw new Error('本机不支持新建会话')
      const newId = newBranchSessionId()
      const createdAt = Date.now()
      const seeded = translateSessionEvents(events, 0, newId)
      const handle = await persistence.create(mirrorHeader(newId, cwd, createdAt))
      try { await handle.append(seeded); await handle.flush() } finally { await handle.close() }
      const projection = (typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : undefined) as MirrorProjectionCacheLike | undefined
      try { projection?.coldSnapshot(mirrorHeader(newId, cwd, createdAt), 0, seeded) } catch { /* 投影写不进去只是列表晚一点才有标题 */ }
      return newId
    },
  }
  // 设备组网（#156）：A 当介绍人；被介绍方必须经本机用户审批；直连不上时经介绍人中转。
  const introInbox = createIntroInbox()
  const introOutbox = createIntroOutbox()
  const meshHooks: NonNullable<RemoteAccessServiceOptions['mesh']> = {
    peers: (callerDeviceId) => pickPeers(remoteHosts.list(), callerDeviceId, laneWsTokenSecret()),
    verify: async (introducerOrigin, token) => {
      // 只向本机已配对的介绍人核实：按地址找到本机对它的记录，用本机在它那边的身份去问。
      const introducer = remoteHosts.list().find((entry) => entry.origin === introducerOrigin)
      if (introducer === undefined) return null
      const response = await fetchFromHost(introducer, `${LANE_PREFIX}/api/remote/intro.verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intro: token }) })
      if (!response.ok) return null
      const reply = await response.json().catch(() => null) as { ok?: boolean; requester?: { deviceId: string; name: string; origin: string } } | null
      if (reply?.ok !== true || reply.requester === undefined) return null
      return { ...reply.requester, introducerName: displayNameOf(introducer) }
    },
    inbox: introInbox,
    relayTarget: (deviceKey) => {
      const record = remoteHosts.list().find((entry) => entry.laneDeviceId === deviceKey)
      return record === undefined ? null : { origin: record.origin, cookie: record.cookie }
    },
  }
  const svc = createRemoteAccessService({
    upstreamHost: '127.0.0.1',
    upstreamPort,
    platform,
    readSetting,
    writeSettings,
    mdns,
    sessions: sessionSource,
    pushback: pushbackHooks,
    mesh: meshHooks,
    // 宿主日志：优先走插件的 logger；这个上下文上拿不到 logger 时退回 console，否则宿主侧的告警会无声丢失。
    warn: (m) => {
      try {
        // 两路都写：dsh 的 logger 在开发实例里不落到任何可见的文件，只靠它会变成「无声失败」。
        if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(m)
        console.info(`[dsh-remote-access] ${m}`)
      } catch { /* noop */ }
    },
    // dsh 进程内自取 process token 的通道（connection 服务公开方法；缺失则 lane 无凭证运行）
    authenticatedUrl: (origin) => {
      try { return ctx?.connection?.authenticatedUrl?.(origin) ?? null; } catch { return null; }
    },
  });

  // 远程工作区 / 出站主机：把已配对主机的目录登记成本机官方 Workspace。
  // 两份存储分开：hosts = 我要连过去的主机（出站），workspaces = 登记了哪些目录。
  const remoteHosts = new RemoteHostStore({ storage: createRemoteHostStorage() })
  // 排障开关：DSH_REMOTE_TRACE_HOSTS=1 时，每次写主机表都打出调用栈（查「记录为什么还在 / 为什么回来」）。
  if (process.env.DSH_REMOTE_TRACE_HOSTS === '1') {
    const upsertTraced = remoteHosts.upsert.bind(remoteHosts)
    remoteHosts.upsert = (record) => {
      console.info(`[dsh-remote-access] trace-hosts upsert ${record.hostId.slice(0, 12)}… ${new Error('trace').stack?.split('\n').slice(2, 7).join(' <- ') ?? ''}`)
      return upsertTraced(record)
    }
  }
  // 中转兜底（#156）：直连不上一台「经介绍人介绍来」的设备时，请介绍人代为转发一次。
  setRelayHook(async (record, target, init) => {
    const introducer = record.introducedBy === undefined ? undefined : remoteHosts.get(record.introducedBy)
    if (introducer === undefined || introducer.introducedBy !== undefined) {
      throw new Error(`连不上 ${record.origin}；它是经介绍人介绍来的，需要经介绍人中转，但本机已没有介绍人的记录`)
    }
    // 向介绍人发一次中转请求。
    const relayOnce = async (): Promise<Response> => fetch(`${introducer.origin}${LANE_PREFIX}/api/remote/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `dsh_mobile_session=${introducer.cookie}` },
      body: JSON.stringify({ device: record.introducedAs ?? '', target, method: init.method ?? 'POST', body: typeof init.body === 'string' ? init.body : undefined }),
      signal: AbortSignal.timeout(30_000),
    })
    let response: Response
    try {
      response = await relayOnce()
      // 介绍人只对「互相介绍过」的设备开放中转，而介绍是有有效期的：过期被拒（403）就重新要一次同组清单把介绍续上，再试一次。
      if (response.status === 403) {
        await fetch(`${introducer.origin}${LANE_PREFIX}/api/remote/peers`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: `dsh_mobile_session=${introducer.cookie}` }, body: '{}', signal: AbortSignal.timeout(15_000) })
        response = await relayOnce()
      }
    } catch {
      // 介绍人也不可用：把话说清楚，而不是只报一个连接错误。
      throw new Error(`连不上 ${record.origin}，需要经介绍人 ${introducer.origin} 中转，但介绍人不可用`)
    }
    if (!response.ok) throw new Error(`经介绍人中转失败：HTTP ${String(response.status)}`)
    const relayed = await response.json().catch(() => ({})) as { status?: number; contentType?: string; body?: string }
    return new Response(relayed.body ?? '', { status: relayed.status ?? 502, headers: { 'content-type': relayed.contentType ?? 'application/json' } })
  })
  const remoteWorkspaces = new RemoteWorkspaceStore({ storage: createRemoteWorkspaceStorage() })
  // 被别的设备使用中的本机目录（对端 remoteWorkspace.claim 写入）：本机徽标据此显示连接数。
  const claimsFile = join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'remote-claims.json')
  const readClaims = (): Array<{ path: string, deviceId: string, deviceName: string, at: number }> => {
    try {
      const raw = JSON.parse(readFileSync(claimsFile, 'utf8')) as { claims?: Array<{ path?: unknown, deviceId?: unknown, deviceName?: unknown, at?: unknown }> }
      return (raw.claims ?? []).map((claim) => ({
        path: typeof claim.path === 'string' ? claim.path : '',
        deviceId: typeof claim.deviceId === 'string' ? claim.deviceId : '',
        deviceName: typeof claim.deviceName === 'string' ? claim.deviceName : '',
        at: typeof claim.at === 'number' ? claim.at : 0,
      })).filter((claim) => claim.path !== '')
    } catch { return [] }
  }
  const writeClaims = (claims: Array<{ path: string, deviceId: string, deviceName: string, at: number }>): void => {
    try {
      mkdirSync(dirname(claimsFile), { recursive: true })
      writeFileSync(claimsFile, `${JSON.stringify({ claims }, undefined, 2)}\n`)
    } catch { /* 落盘失败不影响内存态 */ }
  }
  // 流转来源（#109）：会话被搬过来时记一条，界面据此标注来源并拒绝二次搬运。
  const handoffs = new HandoffStore({ storage: createFileHandoffStorage() })
  let remoteBridge: RemoteWorkspaceBridge | null = null
  // 远端会话镜像进度：本机镜像会话 id → 已拉到的远端 seq（水位）。与下面的事件数一起由登记表恢复。
  const mirrorCursors = new Map<string, { seq: number }>()
  // 已写进官方镜像会话的远端事件数；磁盘与缓存两处落点的进度各记一笔，崩溃后才能各自补齐。
  const mirrorMaterialized = new Map<string, number>()
  // 远程会话登记：会话 id → 主机 / 目录 / 镜像游标。落盘，重启后据此继续镜像与继续对话。
  const remoteSessionRegistry = createRemoteSessionRegistry()
  // 本地分支的出处（#154）：哪条会话从哪台设备的哪条会话、在哪个水位分出来；落盘，重启后仍在。
  const branchRegistry = createBranchRegistry()
  // 镜像缓存（#107）：远端事件按 profile 隔离落盘，带 seq 水位；重启后从这里续传，也是离线阅读与接管的种子。
  const mirrorCache = createMirrorCache(profileStorageDir())
  // A 侧推送：本机会话每产生一个事件，就推给订阅它的设备（分享登记决定推给谁）。
  try {
    ctx.on?.('session/event', (session: { id?: string }, event: unknown) => {
      const id = session?.id
      if (typeof id !== 'string' || id === '') return
      svc.pushSessionEvent(id, [event])
    })
  } catch { /* 事件不可用时只影响推送，不影响其它功能 */ }

  // 交互中继（#151）：提问 / 审批到来时交给服务推给订阅设备、与本地界面赛跑；逻辑在服务里，这里只做接线。
  // 瀑布是链式的：排在前面的回答者不调 next()，后面的就永远轮不到——官方的界面转发器先注册，
  // 把提问转给界面后就一直占着外层等用户。所以这里把自己插到最外层（prepend），
  // 由自己发起「next()（界面这条路径）对远端回答」的赛跑。
  // 另外，实测直接挂在插件自己的上下文上时监听器收不到分发。提问与审批是「按范围分发」的事件，官方只把
  // 不带范围标记的上下文视为全局可达；所以挂到一个不带标记的子上下文上——ctx.plugin() 新建的上下文从根
  // 派生（官方 createScope 取未标记基底用的就是这一招）。拿不到就退回原上下文：至多是设备收不到提问，本地界面照常。
  type RelayEvents = { on?: (name: string, listener: (request: Record<string, unknown>, next: () => Promise<unknown>) => Promise<unknown>, prepend?: boolean) => unknown }
  const relayContext = (): RelayEvents => {
    const plugin = (ctx as unknown as { plugin?: (plugin: () => void) => { ctx?: unknown } | undefined }).plugin
    if (typeof plugin !== 'function') return ctx as RelayEvents
    try {
      const fiber = plugin.call(ctx, function interactionRelayScope(): void {})
      return (fiber?.ctx ?? ctx) as RelayEvents
    } catch {
      return ctx as RelayEvents
    }
  }
  const interactionEvents = relayContext()
  const sessionKeyOf = (agent: unknown): string | undefined => {
    const id = (agent as { session?: { id?: unknown } } | null | undefined)?.session?.id
    return typeof id === 'string' && id !== '' ? id : undefined
  }
  const signalOf = (request: Record<string, unknown>): AbortSignal | undefined =>
    request['signal'] instanceof AbortSignal ? request['signal'] : undefined

  // 远端先答时收起本地界面那张卡（#151）：官方只认「请求被取消」，而取消信号握在调用方（工具）手里。
  // 所以在提问 / 审批服务的入口，把调用方信号和我们自己的一股合成后再交给瀑布；远端赢了就撤销我们那一股，
  // 网关随之撤销转发给界面的提问 / 审批，卡片收起。两个服务都是可选依赖，就绪后再包，且只包一次。
  // 撤销控制器按请求对象记住，不往请求上挂属性：网关要求转发给界面的请求是干净的 JSON，多一个属性都会被拒。
  const relayAborts = new WeakMap<object, AbortController>()
  const abortRelay = (request: unknown): void => {
    const controller = typeof request === 'object' && request !== null ? relayAborts.get(request) : undefined
    if (controller !== undefined && !controller.signal.aborted) controller.abort(new Error('远端设备已经回答'))
  }
  const armRelayAbort = (request: Record<string, unknown> | null | undefined): Record<string, unknown> => {
    const source = request ?? {}
    const controller = new AbortController()
    const signal = source['signal'] instanceof AbortSignal ? AbortSignal.any([source['signal'], controller.signal]) : controller.signal
    const armed: Record<string, unknown> = { ...source, signal }
    relayAborts.set(armed, controller)
    return armed
  }
  const patchedServices = new WeakSet<object>()
  const armService = (service: unknown, method: 'ask' | 'request'): void => {
    if (service === null || typeof service !== 'object' || patchedServices.has(service)) return
    const holder = service as Record<string, unknown>
    const original = holder[method]
    if (typeof original !== 'function') return
    patchedServices.add(service)
    holder[method] = (request: Record<string, unknown>) => original.call(service, armRelayAbort(request))
  }
  if (typeof ctx.inject === 'function') {
    ctx.inject(['userQuestions'], (scope: LaneRuntimeContext) => armService(scope.get?.('userQuestions'), 'ask'))
    ctx.inject(['approval'], (scope: LaneRuntimeContext) => armService(scope.get?.('approval'), 'request'))
  }
  try {
    interactionEvents.on?.('user-questions/request', (request, next) =>
      svc.relayInteraction('question', sessionKeyOf(request['agent']), { questions: request['questions'] }, signalOf(request), next, () => abortRelay(request)), true)
    interactionEvents.on?.('approval/request', (request, next) => {
      const body: Record<string, unknown> = { toolName: request['toolName'] }
      if (typeof request['callId'] === 'string') body['callId'] = request['callId']
      if (typeof request['reason'] === 'string') body['reason'] = request['reason']
      return svc.relayInteraction('approval', sessionKeyOf(request['agent']), body, signalOf(request), next, () => abortRelay(request))
    }, true)
  } catch (error) {
    // 挂不上就只走本地界面；但要说出来，否则提问会无声地到不了设备上。
    console.warn(`[dsh-remote-access] 交互中继未能挂上提问与审批事件（${String(error)}）`);
  }

  // 远端会话桥：远程工作区里的会话，建/发/取消都转发给 A 机，本机只镜像事件。
  // sessionController 由另一个插件提供，用 ctx.inject 等它就绪再装（子 fiber 只做时序门，
  // 桥接本身用父 ctx 的 get 取服务，避免子 fiber 的可见性限制）。
  let remoteSessionBridge: RemoteSessionBridge | null = null
  const installSessionBridge = (): void => {
    if (remoteSessionBridge !== null) return
    remoteSessionBridge = installRemoteSessionBridge({
      ctx,
      hosts: remoteHosts,
      workspaces: () => remoteWorkspaces.list(),
      cursors: mirrorCursors,
      materialized: mirrorMaterialized,
      cache: mirrorCache,
      restore: () => remoteSessionRegistry.load(),
      persist: (entries) => remoteSessionRegistry.save(entries),
      // 退役镜像（#154）：被接管成本地分支的镜像，回推成功前不再登记、不再订阅。
      isRetired: (sessionId) => branchRegistry.load().some((record) => record.mirrorSessionId === sessionId && record.pushedAt === undefined),
    })
    if (remoteSessionBridge !== null) void remoteSessionBridge.hydrate()
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['sessionController'], installSessionBridge)
    else installSessionBridge()
  } catch { installSessionBridge() }

  /** 取官方 workspace registry（可选服务；取不到返回 null，绝不抛）。 */
  const remoteRegistry = (): WorkspaceRegistryLike | null => {
    try {
      const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
      return (registry as WorkspaceRegistryLike | undefined) ?? null
    } catch { return null }
  }

  /** 懒装远程分支：只有真要登记远程路径时才给 registry 包一层。 */
  const ensureRemoteBridge = (): WorkspaceRegistryLike | null => {
    const registry = remoteRegistry()
    if (registry === null) return null
    if (remoteBridge === null) {
      remoteBridge = installRemoteWorkspaceBridge({ registry, store: remoteWorkspaces, platform: process.platform })
    }
    return remoteBridge.installed ? registry : null
  }

  /**
  /**
   * 把一台主机某个目录下的会话同步到本机（#107）。
   *
   * 登记远程工作区与手动「同步」走同一条路径：向主机要该目录的会话头，逐条交给会话桥同步到水位——
   * 按 seq 游标分页，先进镜像缓存，再进官方存储里的镜像会话（id 带 `remote-` 前缀）。重复调用是幂等的。
   * @param host 已配对的主机记录（带 cookie）。
   * @param targetPath 主机上的目录绝对路径。
   * @returns 每个会话本次新写进镜像的事件数，以及镜像是否已落盘。
   */
  const syncRemoteSessions = async (host: RemoteHostRecord, targetPath: string): Promise<Array<{ id: string, eventCount: number, durable: boolean }>> => {
    const headers = await fetchRemoteSessions(host, targetPath)
    if (remoteSessionBridge === null) installSessionBridge()
    const bridge = remoteSessionBridge
    if (bridge === null) throw new Error('会话桥尚未就绪：请在设备管理里对这台设备点一次「同步」')
    const ref = { hostId: host.hostId, path: targetPath }
    const synced: Array<{ id: string, eventCount: number, durable: boolean }> = []
    for (const header of headers) {
      // 远端会话在本机的镜像 id 由主机与远端会话 id 确定；旧版镜像（id 不带前缀）不再续用。
      const localId = mirrorIdOf(host.hostId, header.id)
      bridge.register(localId, ref)
      const result = await bridge.pullOne(localId, ref)
      if (result === undefined) continue
      synced.push({ id: localId, eventCount: result.appended, durable: result.durable })
    }
    // 同步下来的会话要挂进这个工作区，否则侧栏把它们归到「未分组」：官方侧栏按
    // Workspace.sessionIds 分组，而镜像只写会话日志、不登记归属。
    // 远端路径在本机不存在时官方 attachSession 会拒绝（它要 realpath + stat），
    // 这时保持未分组即可——下次启动官方 bootstrap 会按路径把它们归位。
    const registry = ensureRemoteBridge()
    const workspace = registry === null ? undefined : await registry.resolveByPath(targetPath)
    for (const session of synced) {
      try { await workspace?.attachSession?.(session.id) }
      catch { /* 挂不上不影响镜像结果，界面按未分组展示 */ }
    }
    return synced
  }

  // 同源 RPC handler（与 client 共享通道名 /dsh-remote-access）：
  // 桌面壳 WebView 跨域 fetch 被浏览器拦截，必须走 dsh 同源 connection RPC。
  // 同源 RPC handler：connection 用 ctx.get 取（属性代理对拓扑敏感）；失败不能拖垮 lane 启动。
  const connection: ConnectionService | null = (typeof ctx.get === 'function' ? ctx.get('connection') as ConnectionService | undefined : undefined) ?? ctx.connection ?? null;

  // #145：把 lane 的配对身份接进官方鉴权链。
  //
  // lane 转发时把 Host 改写成 loopback（官方 Host fence 只认 loopback，不改写就是 403）。
  // 改写后 dsh 用 loopback 算会话 cookie 名（cookieName = sha256(Host)），与浏览器持有的
  // 外部 Host cookie 对不上——所以远端身份**不靠 dsh 的 cookie**，而是：
  //   1. lane 的配对闸先准入（未配对请求根本到不了上游）；
  //   2. 这个 provider 把已配对请求在官方语义里认成 owner Peer。
  //
  // 安全红线：没有我们凭据的请求必须返回 undefined，交给官方回 401。
  // 判据是「lane 的配对闸已放行」——lane 在转发前把已配对设备的会话值写进
  // `x-dsh-lane-paired` 头（外部无法伪造：lane 先删掉客户端自带的同名头）。
  if (connection?.authentication?.register && connection.createPeer) {
    const createPeer = connection.createPeer.bind(connection);
    try {
      connection.authentication.register({
        authenticate: (request) => {
          // 判据：lane 在转发前注入的标记头。lane 先删掉客户端自带的同名头，
          // 所以外部无法伪造；没有这个头就说明请求没经过 lane 的配对闸。
          const marker = request.headers instanceof Headers
            ? request.headers.get(LANE_PAIRED_HEADER) ?? undefined
            : request.headers[LANE_PAIRED_HEADER];
          const session = typeof marker === 'string' ? marker : Array.isArray(marker) ? marker[0] : undefined;
          if (session === undefined || session === '') return undefined;
          // 会话值必须仍对应一个未吊销的设备（吊销后立即失效）。
          const meta = { ua: '', ip: '', entry: 'remote' };
          if (!svc.store.isDevice(session, meta)) return undefined;
          // 已配对：在官方语义里就是一个 owner Peer（与官方「配对浏览器 = owner」一致）。
          return createPeer({ principal: { kind: 'owner' } });
        },
      });
      try { ctx?.logger?.info?.('dsh-remote-access: 已注册官方鉴权 provider'); } catch { /* noop */ }
    } catch (error) {
      // 注册失败不能拖垮 lane：反代照常起来，只是远端请求仍由官方回 401。
      try { ctx?.logger?.warn?.('dsh-remote-access: 注册官方鉴权 provider 失败: ' + String((error as { message?: unknown } | null | undefined)?.message ?? error)); } catch { /* noop */ }
    }
  }

  if (connection?.rpc?.handle) {
    const ch = '/dsh-remote-access';
    const ok = (v: unknown) => ({ ok: true, value: v });
    const errRpc = (msg: string) => ({ ok: false, error: { code: 'bad-request', message: msg, details: { issues: [{ message: msg }] } } });
    try { ctx?.logger?.info?.('dsh-remote-access: 注册同源 RPC 通道 ' + ch); } catch { /* noop */ }

    // 注册同源 RPC 是可选的：cordis 的 guard 在个别拓扑下会拒绝该 fiber 的服务访问，
    // 这种失败不能拖垮整个插件——lane 反代必须照常起来（否则远程访问整块不可用）。
    // 注册走 ctx.inject(['connection'], …) 显式子 fiber：ctx.inject(deps, fn) =
    // plugin({ inject: deps, apply: fn })，子 fiber 的可见服务完全由 deps 决定（不继承
  /**
   * 清掉本机对某台主机的全部记录与派生物（#157）：主机记录、工作区登记、镜像登记与缓存、
   * 给它的订阅、它的 Web UI 票据、它访问本机的会话。不通知对端。
   * @param host 要清掉的对端记录。
   * @returns 归档的镜像会话数。
   */
  const revokeLocal = async (host: RemoteHostRecord): Promise<number> => {
    remoteHosts.remove(host.hostId)
    // 主机没了，它名下的工作区登记再也解析不出端点，留着只会变成点不动的死条目。
    for (const workspace of remoteWorkspaces.list()) {
      if (workspace.hostId === host.hostId) remoteWorkspaces.remove(host.hostId, workspace.path)
    }
    const forgotten = remoteSessionBridge?.forgetHost(host.hostId) ?? []
    // 已落盘的镜像会话归档为只读历史：不再出现在列表里，也不删用户看过的内容。
    const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') as { archiveSession?: (sessionId: string) => Promise<void> } | undefined : undefined
    for (const sessionId of forgotten) {
      try { await registry?.archiveSession?.(sessionId) } catch { /* 归档不了只是还留在列表里 */ }
    }
    svc.shares.save(svc.shares.load().filter((entry) => entry.deviceId !== host.deviceId))
    svc.revokeWebuiTickets(host.deviceId)
    if (typeof host.laneDeviceId === 'string' && host.laneDeviceId !== '') svc.store.removeDevice(host.laneDeviceId)
    return forgotten.length
  }
  /**
   * 撤销配对（#157，任一端发起都对称）：先尽力通知对端清它那边的记录与派生物，再清本机的。
   * 对端离线通知不到时，它下次探测会得到「未配对」，远程入口随之禁用并说明原因。
   * @param host 要撤销的对端记录。
   * @param notifyPeer 是否通知对端；对端发来的撤销通知带 false，避免来回。
   * @returns 对端是否通知到（及其答复）、本机归档的镜像会话数。
   */
  const revokePairing = async (host: RemoteHostRecord, notifyPeer: boolean): Promise<Record<string, unknown>> => {
    let peer: 'notified' | 'unreachable' | 'skipped' = notifyPeer ? 'unreachable' : 'skipped'
    let peerDetail = ''
    if (notifyPeer) {
      try {
        // 必须赶在清本机之前发：请求要带本机在对端的 cookie。
        // 指认对端的记录要两个 id 都带：`deviceId` 是对端在自己表里的 id（对端在本机 lane 上的记录 id），
        // `laneDeviceId` 是本机在对端的 id（对端记在它记录里的 laneDeviceId）。任一端还停留在没记关联的旧版本时，
        // 总有一个能对上。对端回「没有这条记录」说明它那边本来就是干净的，同样算通知到了。
        const response = await fetchFromHost(host, '/api/remote-access.remoteHosts.remove', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request', rpcId: 'revoke', method: 'remote-access.remoteHosts.remove',
            payload: { deviceId: host.laneDeviceId ?? '', laneDeviceId: host.deviceId, notify: false },
          }),
        })
        const body = await response.json().catch(() => ({})) as { result?: { ok?: boolean, error?: { code?: string, message?: string } } }
        // 对端回「没有这条记录」或「不认这台设备」（401）都说明它那边已经干净，同样算通知到了。
        const clean = response.ok && (body?.result?.ok !== false || body?.result?.error?.code === 'bad-request' && body.result.error.message === 'not-found') || response.status === 401
        if (clean) peer = 'notified'
        else peerDetail = body?.result?.error?.message ?? `HTTP ${String(response.status)}`
      } catch (error) {
        // 对端不可达：本机照常清；对端下次探测得到「未配对」。
        peerDetail = remoteFailureMessage(error)
      }
    }
    const archived = await revokeLocal(host)
    return { peer, peerDetail, archived }
    }

    /** 读写分支的出处登记：按分支会话 id 覆盖。 */
    const saveBranch = (record: BranchProvenance): void => {
      branchRegistry.save(branchRegistry.load().map((entry) => (entry.sessionId === record.sessionId ? record : entry)))
    }
    /** 读出本机某条会话落盘的全部事件（回推时取分支内容）。 */
    const readLocalLog = async (sessionId: string): Promise<RemoteSessionEvent[]> => {
      const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as MirrorPersistenceLike | undefined
      const handle = await persistence?.open?.(sessionId, 'read')
      if (handle === undefined) throw new Error('这条分支的日志读不出来')
      try { return [...((await handle.read?.())?.events ?? [])] as RemoteSessionEvent[] } finally { await handle.close?.() }
    }
    /**
     * 回到远程（#155）：原镜像取消归档并同步到最新，分支归档为历史。
     * @param record 分支出处。
     * @param remoteSessionId 要回到的那条设备会话（回推成功是原会话；另起一条是设备上的新会话）。
     * @returns 本机的镜像会话 id。
     */
    const returnToRemote = async (record: BranchProvenance, remoteSessionId: string): Promise<string> => {
      const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') as { archiveSession?: (sessionId: string) => Promise<void>, unarchiveSession?: (sessionId: string) => Promise<void> } | undefined : undefined
      const mirrorId = remoteSessionId === record.remoteSessionId ? record.mirrorSessionId : mirrorIdOf(record.hostId, remoteSessionId)
      try { await registry?.unarchiveSession?.(mirrorId) } catch { /* 本来就没归档 */ }
      try { await registry?.archiveSession?.(record.sessionId) } catch { /* 归档不了只是还留在列表里 */ }
      if (remoteSessionBridge !== null) {
        remoteSessionBridge.registerMirror(mirrorId, { hostId: record.hostId, path: record.path ?? '' })
        await remoteSessionBridge.pullOne(mirrorId, { hostId: record.hostId, path: record.path ?? '' })
      }
      return mirrorId
    }
    /**
     * 配对并双向登记（#157）：扫码 / 令牌配对与经介绍人介绍的配对（#156）走同一条路。
     * @param origin 对端地址。
     * @param token 对端签发的一次性配对令牌。
     * @param name 对端展示名（可选）。
     * @param reverse 是否把本机也登记到对端；对端发来的反向登记带 false，避免来回。
     * @param callerLaneDeviceId 经本机门禁进来的调用方在本机 lane 上的设备记录 id（反向登记时才有）。
     * @returns 落表后的主机记录。
     */
    const pairAndRegister = async (origin: string, token: string, name: string | undefined, reverse: boolean, callerLaneDeviceId: string | undefined): Promise<RemoteHostRecord> => {
      // 说明：对端发来的反向登记一定要真的再配一次。那一次的 accept 发生在**本机** lane 上，是给对端开它访问
      // 本机用的设备会话（每边恰好一个），不是在对端上重复开。沿用本机已有的旧记录看似省一次配对，但重新配对时
      // 旧记录对应的设备已被收回，对端从此够不着本机（实测：对端既不能反向操作，也无法替第三方中转）。
      const paired = await pairWithHost({ origin, token, name })
      // 同一地址重复配对会生成新的 deviceId → 新的 hostId，先去重再落表。
      // 顺序不能反：先 upsert 再按 origin 去重会把刚写进去的那条也删掉。
      // 被替换的旧记录按解除配对同样清理（#157）：它名下的工作区登记、镜像、它在本机的设备记录
      // 一并收走，不然会留下一串点不动的孤儿条目（镜像 id 编码了旧 hostId，续不上）。
      for (const existing of remoteHosts.list()) {
        if (existing.origin === paired.record.origin) await revokeLocal(existing)
      }
      const host = remoteHosts.upsert(paired.record)
      // 对称撤销要用（#157）：记下对端在本机 lane 上的设备记录 id，撤销时据此收回它访问本机的会话。
      // 被反向登记时，调用方就是经本机门禁进来的那台设备，lane 转发时带了它的会话值。
      if (!reverse && callerLaneDeviceId !== undefined) remoteHosts.upsert({ ...host, laneDeviceId: callerLaneDeviceId })
      // 双向：把本机也登记到对端，保证两边都能发起会话。反向登记失败就回滚，
      // 反向调用带 reverse:false，否则 A→B→A→B 无限递归（实测直接挂住）。
      if (reverse) {
        try {
          const backToken = svc.store.mint()
          const lanIp = (await svc.localAddressToward(paired.record.origin)) ?? selectLanIPv4(os.networkInterfaces() ?? {})
          // 必须用**实际监听**的端口：tunnel.port 的初值是配置默认值 3091，
          // 端口被占时 listen 失败它仍是 3091，反向登记就会打到别人的 lane 上（invalid-token）。
          if (!svc.tunnel.listening) throw new Error('本机 lane 未监听（端口被占用？），无法反向登记')
          const port = svc.tunnel.port
          const selfOrigin = `http://${lanIp}:${port}`
          const response = await fetchFromHost(paired.record, '/api/remote-access.remoteHosts.pair', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: 'pair-back',
              method: 'remote-access.remoteHosts.pair',
              payload: { origin: selfOrigin, token: backToken, name: svc.localModel(), reverse: false },
            }),
          })
          if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
          // 业务错误也是 HTTP 200（body 里 result.ok=false），必须读 body 才算数。
          const body = await response.json().catch(() => ({})) as { result?: { ok?: boolean, error?: { message?: string } } }
          if (body?.result?.ok === false) throw new Error(body.result.error?.message ?? 'reverse rejected')
          // 发起方在这里才知道对端给本机分配的设备 id（它在对端 lane 上代表本机）：
          // 对端在应答里带回了它的记录，deviceId 就是这个 id。
          const linked = (body as { result?: { value?: { host?: { deviceId?: unknown } } } }).result?.value?.host?.deviceId
          // 反向登记等网络的那一会儿记录可能已被撤销：只在它还在时补记，不把撤销掉的配对写回来。
          const current = remoteHosts.get(host.hostId)
          if (typeof linked === 'string' && linked !== '' && current !== undefined) {
            remoteHosts.upsert({ ...current, laneDeviceId: linked })
          }
        } catch (error) {
          remoteHosts.remove(host.hostId)
          throw new Error(`reverse-failed: ${String((error as Error)?.message ?? error)}`)
        }
      }
      return remoteHosts.get(host.hostId) ?? host
    }
    /** 三态探测：经介绍人介绍来的设备直连不上时走中转，探测结果才与实际可用性一致。 */
    const PROBE_CACHE_MS = 3_000
    // 结果按主机缓存 3 秒：界面上分支列表、设备状态各自轮询，一次轮询里同一个主机会被探测很多次；
    // 设备只能经介绍人中转时，这些探测全压在介绍人身上（实测 11 分钟一万次）。
    const probeHost = createProbeCache((hostId: string): ReturnType<typeof probeRemoteHost> => {
      const host = remoteHosts.get(hostId)
      if (host === undefined) throw new Error('这台设备已不在配对表里，先重新配对')
      const url = new URL(`${host.origin}/__dsh-mobile/api/pair/info`)
      return probeRemoteHost(host, {
        localVersion: readPluginVersion(),
        fetchImpl: (_input, init) => fetchFromHost(host, `${url.pathname}${url.search}`, { method: init?.method ?? 'GET', headers: { accept: 'application/json' }, ...(init?.signal === undefined ? {} : { signal: init.signal }) }),
      })
    }, PROBE_CACHE_MS)
    /** 向介绍人要同组设备清单（含指名给本机的介绍凭证）。 */
    const fetchPeers = async (introducer: RemoteHostRecord): Promise<PeerEntry[]> => {
      const response = await fetchFromHost(introducer, `${LANE_PREFIX}/api/remote/peers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const reply = await response.json().catch(() => null) as { peers?: PeerEntry[] } | null
      return Array.isArray(reply?.peers) ? reply.peers : []
    }

    // 父 fiber）——只声明 webServer 时 scope.connection 会被 guard 拒（实测 405 根因）。
    // /api 控制面分发器：endpoint → svc（原 connection.rpc.handle 的 switch 原样搬来）。
    const dispatch = async (endpoint: string, payload: Record<string, unknown> = {}, caller: { laneDeviceId?: string } = {}): Promise<unknown> => {
      try {
        switch (endpoint) {
          case 'devices.list':
            return ok({ devices: svc.store.snapshotDevices(), tokenRef: svc.store.ref() });
          case 'devices.remove': {
            const id = String(payload?.deviceId ?? '');
            if (!id || !svc.store.removeDevice(id)) return errRpc('not-found');
            // 从本机门禁里删掉一台设备，就是解除与它的配对（#157 撤销对称）：本机对它的记录与派生物一并清，并通知它。
            const linked = findHostByLaneDevice(remoteHosts.list(), id)
            if (linked !== null) return ok(await revokePairing(linked, true))
            return ok(true);
          }
          case 'token.mint': {
            // lane 没起来时直接失败：否则用户拿到的是指向别人 lane 的链接，
            // 表现为「令牌无效或已过期」（#145）。
            if (laneFailure !== null) return errRpc(laneFailure);
            const t = svc.store.mint();
            return ok({ token: t, expiresAt: svc.store.tokenExpiresAt });
          }
          case 'token.ref':
            return ok({ ref: svc.store.ref() });
          case 'info': {
            const interfaces: NetworkInterfacesLike = os.networkInterfaces?.() ?? {}
            const lanIp = selectLanIPv4(interfaces);
            // 用实际绑定的端口（可能因占用而改取空闲端口），不能写死 3091。
            const baseCandidates = resolveBaseCandidates({ hostname: os.hostname(), interfaces, port: svc.tunnel?.port ?? lanePort });
            let customTunnelUrl = svc.tunnel && svc.tunnel._customUrl ? svc.tunnel._customUrl : '';
            if (!customTunnelUrl) {
              try { customTunnelUrl = readSetting('tunnel_url') ?? ''; } catch { /* noop */ }
            }
            return ok({
              lanePort: svc.tunnel?.port ?? lanePort,
              // #145：状态按 profile 隔离，把当前 profile 与落点报出来方便排查。
              profile: currentProfileScope(),
              storageDir: profileStorageDir(),
              lanIp,
              baseCandidates,
              tunnelUrl: svc.tunnel?.url ?? null,
              customTunnelUrl,
              dshAuth: svc.dshAuth?.hasCredential() ?? false,
            });
          }
          case 'tunnel.probe': {
            const url = String(payload?.url ?? '');
            if (!url) return errRpc('bad-url');
            // 同源调用方已信任（仅属主 + 同源 channel），直接调内部 probe
            const verdict = await new Promise<Record<string, unknown>>((resolve) => {
              const json = (status: number, body: Record<string, unknown>) => resolve({ _status: status, ...body });
              svc.probe(url, json); // #167：runProbe 是 service 私有函数，须经 svc 调用
            });
            return ok(verdict);
          }
          case 'tunnel.save': {
            const url = String(payload?.url ?? '').trim();
            if (url && !/^https?:\/\//.test(url)) return errRpc('bad-url');
            try { await writeSettings({ tunnel_url: url }); } catch { /* noop */ }
            if (svc.tunnel) svc.tunnel._customUrl = url;
            return ok({ url });
          }
          case 'cloudflared.get':
            return ok({
              bin: svc.tunnel?.bin ?? '',
              url: svc.tunnel?.url ?? null,
              running: !!svc.tunnel?.child,
              reason: svc.tunnel?.reason ?? null,
              phase: svc.tunnel?.phase ?? 'idle',
              detail: svc.tunnel?.detail ?? '',
              message: svc.tunnel?.message ?? '',
            });
          case 'cloudflared.apply': {
            // 空 bin = 自动解析（PATH 优先 → ~/.dsh/bin 缓存 → 多镜像下载），适合"一键启动"。
            // 解析/下载是 async，phase 字段会从 'resolving' → 'downloading' → 'starting' → 'ready' 演进。
            const bin = String(payload?.bin ?? '').trim();
            const t = svc.startTunnel(bin || null, svc.tunnel?.port ?? 3091);
            // 仅在用户显式给了 bin 时持久化（auto 模式每次启动自动解析，不要把缓存路径写死）。
            if (bin) { try { await writeSettings({ cloudflared_bin: bin }); } catch { /* noop */ } }
            return ok({ bin: t.bin || null, running: !!t.child, phase: t.phase ?? 'resolving' });
          }
          case 'cloudflared.stop':
            // 显式停止 = 同时清掉持久化 bin：重启后不再自动拉起（保留「停止」的语义）
            try { await writeSettings({ cloudflared_bin: '' }); } catch { /* noop */ }
            svc.stopTunnel();
            // 原实现落到 default 分支返回 unknown-endpoint（保持同一返回）。
            return errRpc('unknown-endpoint')
          case 'remoteHosts.list':
            return ok({ hosts: remoteHosts.list() });
          case 'remoteHosts.pair': {
            try {
              return ok({ host: await pairAndRegister(String(payload?.origin ?? ''), String(payload?.token ?? ''), typeof payload?.name === 'string' && payload.name !== '' ? payload.name : undefined, payload?.reverse !== false, caller.laneDeviceId) })
            } catch (error) {
              const code = (error as { code?: unknown } | null)?.code;
              return errRpc(typeof code === 'string' ? code : String((error as Error)?.message ?? error));
            }
          }
          case 'remoteHosts.remove': {
            // 撤销可以按主机 id（本机界面）；对端发来的撤销通知带两个 id，任一能对上即可：
            // `deviceId` 是本机在自己表里的 id（对端在本机 lane 上的记录 id），`laneDeviceId` 是对端在本机的 id。
            const hostId = String(payload?.hostId ?? '');
            const deviceId = String(payload?.deviceId ?? '');
            const laneDeviceId = String(payload?.laneDeviceId ?? '');
            const host = hostId !== ''
              ? remoteHosts.get(hostId)
              : (findHostByDeviceId(remoteHosts.list(), deviceId) ?? findHostByLaneDevice(remoteHosts.list(), laneDeviceId) ?? undefined);
            if (host === null || host === undefined) return errRpc('not-found');
            return ok(await revokePairing(host, payload?.notify !== false));
          }
          case 'remoteHosts.rename': {
            const hostId = String(payload?.hostId ?? '');
            const name = String(payload?.name ?? '').trim();
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('not-found');
            if (name === '') return errRpc('bad-request');
            return ok({ host: remoteHosts.upsert({ ...host, name, renamedAt: Date.now() }) });
          }
          case 'remoteCommand.execute': {
            // 远程会话的命令（/permission 等）必须在 A 机上执行：本地没有 agent，
            // 走官方 commands/execute 会在网关解析 agent 时就撞 already exists。
            const sessionId = String(payload?.sessionId ?? '')
            const line = String(payload?.line ?? '')
            if (sessionId === '' || line === '') return errRpc('bad-request')
            if (remoteSessionBridge === null) return errRpc('unsupported')
            try {
              const value = await remoteSessionBridge.executeCommand(sessionId, line)
              if (value === undefined) return errRpc('not-found')
              return ok({ value })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSession.invoke': {
            // 会话级远端调用的通用转发：客户端把 (namespace, method, args) 原样送来，
            // 宿主按会话归属转给 A 机。读/流类调用不走这里（本地镜像已经提供）。
            const namespace = String(payload?.namespace ?? '')
            const method = String(payload?.method ?? '')
            const args = (payload?.args ?? {}) as Record<string, unknown>
            if (namespace === '' || method === '') return errRpc('bad-request')
            if (remoteSessionBridge === null) return errRpc('unsupported')
            try {
              const hit = await remoteSessionBridge.invokeRemote(namespace, method, args)
              if (hit === undefined) return errRpc('not-found')
              return ok({ value: hit.value })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteWorkspace.list': {
            // 主机归属随列表一起下发：徽标只靠这一次调用就能画出「远程 · <主机>」，
            // 不再二次拉主机表（那次调用失败会让徽标退化）。
            // id 用官方工作区 id：侧栏行是 data-row-key="workspace:<官方 id>"，徽标靠它认行。
            const workspaces: Array<Record<string, unknown>> = remoteWorkspaces.list().map((workspace) => {
            // 工作区记录会跟着配对一起落盘：重新配对后 deviceId 变了，记录里还是旧的。
            // 同一台机器的 origin 不变，所以按 origin 兜底找一次主机，徽标与探测才不会全落空。
            const hostByOrigin = (hostId: string): ReturnType<typeof remoteHosts.get> => {
              const direct = remoteHosts.get(hostId)
              if (direct !== undefined) return direct
              const at = hostId.lastIndexOf('@')
              if (at < 0) return undefined
              const origin = hostId.slice(at + 1)
              return remoteHosts.list().find((entry) => entry.origin === origin)
            }
              const host = hostByOrigin(workspace.hostId)
              const hostName = host === undefined
                ? ''
                : host.renamedAt !== undefined && host.name !== '' ? host.name : host.origin
              // sessionIds 必须带上：client 靠它认出「哪些会话是远程的」，转发才敢接管
              // （终端、权限、+ 面板这些都要转发到远端）。缺了整块远程会话能力就退化成本地。
              const sessionIds = remoteSessionBridge === null ? [] : [...remoteSessionBridge.sessions.entries()]
                .filter(([, ref]) => ref.path === workspace.path)
                .map(([sessionId]) => sessionId)
              // id 必须解析出真实值：老记录里没存 workspaceId，徽标按 id 匹配就画不出来。
              // 每次都按路径反查一次，命中就顺手落盘回填，从此不依赖记录里有没有。
              let resolvedId = workspace.workspaceId ?? ''
              if (resolvedId === '') {
                const local = ensureRemoteBridge()?.list?.().find((entry) => entry.path === workspace.path)
                if (local !== undefined) {
                  resolvedId = local.id
                  remoteWorkspaces.setWorkspaceId(workspace.hostId, workspace.path, local.id)
                }
              }
              // localDirectory：本机也有这个目录。同路径的本地与远程工作区在官方里并成同一个，新建会话默认建在本机（见 remote-gate）。
              return { ...workspace, id: resolvedId, sessionIds, hostName, hostOrigin: host?.origin ?? '', streamState: remoteSessionBridge?.streamState(workspace.hostId) ?? 'disconnected', localDirectory: existsSync(workspace.path) }
            })
            // 被别的设备使用中的本机工作区：对端添加本机目录时会调 remoteWorkspace.claim，
            // 这里按路径解析成本机工作区 id，徽标据此显示「N 台设备」。
            const claimed = new Map<string, { count: number, names: string[] }>()
            for (const claim of readClaims()) {
              const local = ensureRemoteBridge()?.list?.().find((entry) => entry.path === claim.path)
              if (local === undefined) continue
              const bucket = claimed.get(local.id) ?? { count: 0, names: [] }
              bucket.count += 1
              if (claim.deviceName !== '') bucket.names.push(claim.deviceName)
              claimed.set(local.id, bucket)
            }
            for (const [id, bucket] of claimed) {
              // title 必须带上：client 侧按 title 非空过滤，缺了整条会被跳过。
              const localTitle = ensureRemoteBridge()?.list?.().find((entry) => entry.id === id)?.title ?? ''
              workspaces.push({ id, title: localTitle, hostId: '', hostName: bucket.names.join('、'), hostOrigin: '', streamState: 'connected', claimed: true, claimCount: bucket.count })
            }
            return ok({ workspaces })
          }
          case 'remoteWorkspace.browse': {
            const hostId = String(payload?.hostId ?? '');
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('unknown-host');
            try {
              return ok(await fetchRemoteDirectory(host, String(payload?.path ?? '')));
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error));
            }
          }
          case 'remoteWorkspace.add': {
            const hostId = String(payload?.hostId ?? '');
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('unknown-host');
            let canonical = '';
            try { canonical = normalizeRemotePath(String(payload?.path ?? ''), process.platform); }
            catch (error) { return errRpc(String((error as Error)?.message ?? error)); }
            const registry = ensureRemoteBridge();
            if (registry === null) return errRpc(REMOTE_BRIDGE_UNSUPPORTED);
            // P0：不在 A 上登记工作区——那是 P1「在远端创建」（#153）。B 只登记一条指向 A 现有目录的引用，
            // 会话同步按路径读 A 的会话，不依赖 A 的工作区表。写开关打开后才先在远端建（远端确认成功再在本机登记）。
            let remoteWorkspaceId = ''
            if (REMOTE_WRITES_ENABLED) {
              try { remoteWorkspaceId = (await createRemoteWorkspace(host, canonical)).workspaceId }
              catch (error) {
                return errRpc(`remote-workspace-failed: ${remoteFailureMessage(error)}`)
              }
            }
            // 告诉对端「这台设备在用这个目录」：对端徽标据此显示连接数。失败不影响主流程。
            try {
              await fetchFromHost(host, '/api/remote-access.remoteWorkspace.claim', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  type: 'client-request',
                  rpcId: 'claim',
                  method: 'remote-access.remoteWorkspace.claim',
                  payload: { path: canonical, deviceId: host.deviceId, deviceName: svc.localModel() },
                }),
              })
            } catch { /* 对端没升级或不可达：只是少一个连接数标记 */ }
            const record = remoteWorkspaces.add({
              hostId,
              path: canonical,
              // 侧栏的工作区行只渲染 Workspace.title（官方 tree.ts 用 workspace.title 当分组标签），
              // 没有独立的徽标槽位；来源标记由 client 半区的 workspace-badge 补，标题只放目录名。
              // 标题里绝不能拼主机名：主机改名后旧标题会留下一个再也对不上的名字。
              title: basename(canonical) || canonical,
              addedAt: Date.now(),
            });
            const workspace = await registry.create(record.path, record.title);
            // 回填官方工作区 id：侧栏行是 data-row-key="workspace:<官方 id>"，徽标靠它认行。
            remoteWorkspaces.setWorkspaceId(hostId, record.path, workspace.id)
            // 登记完立刻同步一次：加完远程工作区就该看到那台主机的会话，
            // 而不是再去设置里点一次「同步」。同步失败不回滚登记——工作区本身已经成立，
            // 失败原因随返回值带出去，界面据此提示。
            let sessions: Array<{ id: string, eventCount: number, durable: boolean }> = [];
            let syncError: string | null = null;
            try { sessions = await syncRemoteSessions(host, record.path); }
            catch (error) { syncError = String((error as Error)?.message ?? error); }
            return ok({ workspace: { id: workspace.id, path: workspace.path, title: workspace.title }, sessions, syncError, remoteWorkspaceId, remoteError: null });
          }
          case 'remoteEvents.wait': {
            // 事件长轮询：没有事件就挂起最多 20 秒；事件一到立刻返回。
            // 页面据此重画徽标——不是定时轮询，只在真正发生变化时醒来。
            const queued = pendingEvents.splice(0, pendingEvents.length)
            if (queued.length > 0) return ok({ events: queued })
            const events = await new Promise<string[]>((resolve) => {
              eventWaiters.add(resolve)
              const timer = setTimeout(() => {
                eventWaiters.delete(resolve)
                resolve([])
              }, 20_000)
              if (typeof timer.unref === 'function') timer.unref()
            })
            return ok({ events })
          }
          case 'remoteWorkspace.claim': {
            // 对端添加本机目录时调用：记下「哪台设备在用这个目录」，本机徽标据此显示连接数。
            const claimPath = String(payload?.path ?? '')
            if (claimPath === '') return errRpc('bad-request')
            const deviceId = String(payload?.deviceId ?? '')
            const deviceName = String(payload?.deviceName ?? '')
            const claims = readClaims().filter((claim) => !(claim.path === claimPath && claim.deviceId === deviceId))
            claims.push({ path: claimPath, deviceId, deviceName, at: Date.now() })
            writeClaims(claims)
            return ok({ claims: claims.length })
          }
          case 'remoteWorkspace.remove': {
            const hostId = String(payload?.hostId ?? '');
            const rawPath = String(payload?.path ?? '');
            const byWorkspaceId = String(payload?.workspaceId ?? '');
            if (hostId === '' || rawPath === '') {
              // 只给官方工作区 id 也能移除：侧栏删除条目时客户端手里只有它。
              const byId = byWorkspaceId === '' ? undefined : remoteWorkspaces.list().find((entry) => entry.workspaceId === byWorkspaceId)
              if (byId === undefined) return errRpc('not-found');
              remoteWorkspaces.remove(byId.hostId, byId.path);
              return ok(true);
            }
            let canonical = '';
            try { canonical = normalizeRemotePath(rawPath, process.platform); }
            catch (error) { return errRpc(String((error as Error)?.message ?? error)); }
            if (!remoteWorkspaces.remove(hostId, canonical)) return errRpc('not-found');
            // 只摘掉本机的登记与投影：官方 registry 里的条目若还在，交给用户在自己的
            // 工作区列表里删（那是本机真实存在的条目，插件不替用户做删除决定）。
            return ok(true);
          }
          case 'remoteStatus.probe': {
            // #108：三态探测。online 顺手刷新 lastSeen（界面显示「上次可见」用）。
            const hostId = String(payload?.hostId ?? '');
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('unknown-host');
            const status = await probeHost(host.hostId);
            // 写回前必须重新取记录：探测等网络的那一会儿可能正好被撤销配对删掉了，
            // 拿手里那份旧记录写回去等于把已解除的配对又救活（实测：设备窗口开着时撤销，记录总回来）。
            const current = remoteHosts.get(hostId);
            if (status.state === 'online' && current !== undefined) remoteHosts.upsert({ ...current, lastSeen: status.checkedAt });
            return ok({ status, description: describeRemoteLink(status) });
          }
          case 'remoteSessions.sync': {
            const hostId = String(payload?.hostId ?? '');
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('unknown-host');
            const targetPath = String(payload?.path ?? '');
            if (targetPath === '') return errRpc('bad-path');
            try {
              return ok({ sessions: await syncRemoteSessions(host, targetPath) });
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error));
            }
          }
          case 'remoteShare.add': {
            // 分享：会话留在本机，只登记「这台设备可以订阅它」。
            const sessionId = String(payload?.sessionId ?? '')
            const deviceId = String(payload?.deviceId ?? '')
            const sharePath = String(payload?.path ?? '')
            if (sessionId === '' || deviceId === '') return errRpc('bad-request')
            const entries = svc.shares.load().filter((entry) => !(entry.sessionId === sessionId && entry.deviceId === deviceId))
            entries.push({ sessionId, deviceId, path: sharePath, sharedAt: Date.now() })
            svc.shares.save(entries)
            svc.pushShareChange(deviceId, 'added', sessionId)
            return ok({ shares: entries.filter((entry) => entry.sessionId === sessionId) })
          }
          case 'remoteShare.list': {
            const sessionId = String(payload?.sessionId ?? '')
            svc.pruneShareLeases()
            const all = svc.shares.load()
            const shares = sessionId === '' ? all : all.filter((entry) => entry.sessionId === sessionId)
            return ok({ shares: shares.map((entry) => ({ ...entry, viewers: svc.viewerCount(entry.sessionId), leaseMs: leaseRemainingMs(entry.expiresAt) })) })
          }
          case 'remoteShare.remove': {
            const sessionId = String(payload?.sessionId ?? '')
            const deviceId = String(payload?.deviceId ?? '')
            const entries = svc.shares.load().filter((entry) => !(entry.sessionId === sessionId && entry.deviceId === deviceId))
            svc.shares.save(entries)
            svc.pushShareChange(deviceId, 'removed', sessionId)
            return ok({ shares: entries.filter((entry) => entry.sessionId === sessionId) })
          }
          case 'remoteSession.push': {
            // 把本机会话推到 A 机：先确保远端有对应工作区，再把日志写进 A 的会话存储，
            // 最后在本机登记成远程会话——之后它和「在远端建的会话」走同一套双向同步。
            // 把本机会话写到 A 的存储属于旧的分享流程，已被「接管 / 回推」取代，对应票落地前不开放。
            if (!REMOTE_PUSH_ENABLED) return errRpc('会话推送已由「接管 / 回推」取代，当前阶段不提供');
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const sessionId = String(payload?.sessionId ?? '')
            if (sessionId === '') return errRpc('bad-session')
            const targetPath = String(payload?.path ?? '')
            if (targetPath === '') return errRpc('bad-path')
            const source = sessionSource
            if (source === undefined || typeof source.readLog !== 'function') return errRpc('sessions-unavailable')
            try {
              const log = await source.readLog(sessionId)
              if (log === undefined) return errRpc('not-found')
              const remote = await createRemoteWorkspace(host, targetPath)
              const response = await fetchFromHost(host, '/__dsh-mobile/api/remote/session.import', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ log, cwd: targetPath }),
              })
              // 远端已有同名会话时视为已推送（幂等）：重复点推送不该报错。
              if (!response.ok && response.status !== 500) return errRpc(`import-failed: HTTP ${String(response.status)}`)
              if (!response.ok) {
                const detail = await response.text()
                if (!detail.includes('already exists')) return errRpc(`import-failed: ${detail.slice(0, 200)}`)
              }
              const workspace = remoteWorkspaces.list().find((entry) => entry.hostId === hostId && sameCwd(entry.path, targetPath))
              if (workspace !== undefined) remoteSessionBridge?.register(sessionId, workspace)
              return ok({ sessionId, workspaceId: remote.workspaceId })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteWorkspace.syncNow': {
            // 把 A 机该目录下所有会话同步到水位：新会话建出镜像，已有会话只补增量。
            // 走与登记远程工作区同一条路径，重复调用是幂等的。
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const targetPath = String(payload?.path ?? '')
            if (targetPath === '') return errRpc('bad-path')
            try {
              const synced = await syncRemoteSessions(host, targetPath)
              return ok({ total: synced.length, created: synced.filter((session) => session.eventCount > 0).length, existing: synced.filter((session) => session.eventCount === 0).length })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSession.syncNow': {
            // 单个远程会话：立刻同步一次到水位（远端有新消息而推送还没到时手动触发）。
            const sessionId = String(payload?.sessionId ?? '')
            if (sessionId === '') return errRpc('bad-session')
            if (remoteSessionBridge === null) return errRpc('bridge-unavailable')
            try {
              const ref = remoteSessionBridge.sessions.get(sessionId)
              if (ref === undefined) return errRpc('not-remote-session')
              await remoteSessionBridge.pullOne(sessionId, ref)
              return ok({ sessionId })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSession.create': {
            // 在远端建会话，再把它镜像到本机：会话身份、事件、后续对话都在 A 上，
            // 本机只是同一份日志的渲染副本。
            // 在远端创建（#153）：写开关关闭（只读镜像模式）时，落到任何远端调用之前就拒绝。
            if (!REMOTE_WRITES_ENABLED) return errRpc(remoteReadonlyRefusal('session/create'));
            // 目标可以是目录，也可以是本机的远程工作区 id（界面的「新会话」多半带它）；主机可带可不带。
            // 解析不出、或目标根本不是远程工作区时给出稳定错误码——客户端据 not-remote-workspace 落回本机新建。
            const target: RemoteCreateTarget = {}
            if (typeof payload?.hostId === 'string') target.hostId = payload.hostId
            if (typeof payload?.workspaceId === 'string') target.workspaceId = payload.workspaceId
            if (typeof payload?.path === 'string') target.path = payload.path
            const resolved = resolveRemoteCreateTarget(target, remoteWorkspaces.list(), (hostId) => remoteHosts.get(hostId) !== undefined)
            if (!resolved.ok) return errRpc(resolved.code)
            const { hostId, path: targetPath } = resolved
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            try {
              const remote = await createRemoteWorkspace(host, targetPath)
              const remoteSessionId = await createRemoteSession(host, { workspaceId: remote.workspaceId })
              // 本机看到的是镜像会话：id 带 remote- 前缀，界面上的后续操作都落在它上面，再由桥接转回 A。
              const sessionId = mirrorIdOf(hostId, remoteSessionId)
              // 镜像经会话桥同步进官方存储（带持久化服务：只建内存会话时官方 resume / commands.list
              // 找不到它，命令面板与权限切换会报 SessionPersistenceNotFoundError）。
              const bridge = remoteSessionBridge
              if (bridge === null) throw new Error('bridge-unavailable')
              bridge.register(sessionId, { hostId, path: targetPath })
              await bridge.pullOne(sessionId, { hostId, path: targetPath })
              // 挂进工作区分组：官方侧栏按 Workspace.sessionIds 分组，不挂就落到「未分组」，
              // 看起来像是会话没同步过来。
              try {
                const registry = ensureRemoteBridge()
                const workspace = registry === null ? undefined : await registry.resolveByPath(targetPath)
                if (workspace === undefined) throw new Error('no-local-workspace-for-path')
                if (typeof workspace.attachSession !== 'function') throw new Error('attachSession-missing')
                await workspace.attachSession(sessionId)
              } catch (error) {
                try { ctx.logger?.warn?.(`dsh-remote-access: 会话 ${sessionId} 未能挂进工作区 ${targetPath}：${String((error as Error)?.message ?? error)}`) } catch { /* noop */ }
              }
              return ok({ sessionId, workspaceId: remote.workspaceId })
            } catch (error) {
              return errRpc(remoteFailureMessage(error))
            }
          }
          case 'remoteSession.prompt': {
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const sessionId = String(payload?.sessionId ?? '')
            const text = String(payload?.text ?? '')
            const requestId = String(payload?.requestId ?? '')
            if (sessionId === '' || text === '' || requestId === '') return errRpc('bad-request')
            try {
              return ok({ accepted: await promptRemoteSession(host, sessionId, text, requestId) })
            } catch (error) {
              return errRpc(remoteFailureMessage(error))
            }
          }
          case 'remoteWebui.open': {
            // 「在浏览器打开该设备的 DSH」（#150）：地址由对方签发（一次性、短时有效的票据），本机只负责转交。
            const host = remoteHosts.get(String(payload?.hostId ?? ''))
            if (host === undefined) return errRpc('unknown-host')
            try {
              return ok({ url: await requestRemoteWebuiUrl(host) })
            } catch (error) {
              return errRpc(remoteFailureMessage(error))
            }
          }
          case 'remoteSession.takeover': {
            // 会话接管（#154）：只在设备离线时允许。用镜像缓存里到水位为止的事件生成一条本机分支，
            // 原镜像停止订阅设备本机并归档为只读历史。接管本身不依赖网络。
            const mirrorId = String(payload?.sessionId ?? '')
            if (mirrorId === '') return errRpc('bad-request')
            const ref = remoteSessionBridge?.sessions.get(mirrorId)
            const remoteSessionId = ref === undefined ? undefined : remoteIdOfMirror(mirrorId, ref.hostId)
            if (ref === undefined || remoteSessionId === undefined) return errRpc('not-mirror')
            const host = remoteHosts.get(ref.hostId)
            if (host === undefined) return errRpc('unknown-host')
            const status = await probeHost(host.hostId)
            const decision = decideTakeover(status.state)
            if (!decision.ok) return errRpc(decision.message)
            const snapshot = mirrorCache.read(host.hostId, remoteSessionId)
            if (snapshot === undefined || snapshot.events.length === 0) return errRpc('这条会话还没有同步到任何内容，没有可以接管的种子')
            const persistence = (typeof ctx.get === 'function' ? ctx.get('sessionPersistence') : undefined) as SessionPersistenceLike | undefined
            if (persistence === undefined) return errRpc('unsupported')
            const branchId = newBranchSessionId()
            const events = branchEvents(snapshot, branchId)
            const createdAt = Date.now()
            const handle = await persistence.create(mirrorHeader(branchId, ref.path, createdAt))
            try {
              await handle.append(events)
              await handle.flush()
            } finally {
              await handle.close()
            }
            // 分支不在内存里：把日志折一遍投影，侧栏才读得到标题与列表元数据（与镜像同步同一条路）。
            const projectionCache = (typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : undefined) as MirrorProjectionCacheLike | undefined
            try { projectionCache?.coldSnapshot(mirrorHeader(branchId, ref.path, createdAt), 0, events) } catch { /* 投影写不进去只是列表晚一点才有标题 */ }
            const headers = await sessionSource.listHeaders().catch(() => [])
            const provenance: BranchProvenance = {
              kind: 'remote-branch', sessionId: branchId, hostId: host.hostId, remoteSessionId, mirrorSessionId: mirrorId,
              forkPoint: snapshot.watermark, takenAt: createdAt,
              title: headers.find((header) => header.id === mirrorId)?.title || titleFromEvents(snapshot.events),
              hostName: displayNameOf(host), path: ref.path,
            }
            branchRegistry.save([...branchRegistry.load(), provenance])
            // 单写者：原镜像不再订阅设备本机（设备侧的订阅记录随租约到期清除），降为归档的只读历史。
            // 登记表是磁盘上的事实来源：除了让桥接清掉内存里的那一份，这里再按镜像 id 直接摘一遍——
            // 桥接若被重建过，旧实例手里的表可能把这条又写回来（实测：接管后对账把镜像登记了回去）。
            remoteSessionBridge?.forgetSession(mirrorId)
            remoteSessionRegistry.save(remoteSessionRegistry.load().filter((entry) => entry.sessionId !== mirrorId))
            const workspaces = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') as { archiveSession?: (sessionId: string) => Promise<void> } | undefined : undefined
            try { await workspaces?.archiveSession?.(mirrorId) } catch (error) { ctx?.logger?.warn?.(`dsh-remote-access: 接管后归档原镜像失败（${mirrorId}）：${String((error as Error)?.message ?? error)}`) }
            return ok({ branch: provenance, label: branchLabel(provenance) })
          }
          case 'remoteBranch.list':
            return ok({ branches: branchRegistry.load() })
          case 'remoteBranch.push': {
            // 回推（#155）：把分支在分叉点之后的增量追加回设备上的原会话。前提不满足就拒绝，并带回出口。
            const record = branchRegistry.load().find((entry) => entry.sessionId === String(payload?.sessionId ?? ''))
            if (record === undefined) return errRpc('not-branch')
            const host = remoteHosts.get(record.hostId)
            if (host === undefined) return errRpc('unknown-host')
            const status = await probeHost(host.hostId)
            const decision = decidePushbackFromBranch(record, status.state)
            if (!decision.ok) return ok({ ok: false, reason: decision.reason, message: decision.message, exits: decision.exits })
            let tail
            try { tail = pushbackTail(await readLocalLog(record.sessionId), record.forkPoint, record.remoteSessionId) }
            catch (error) { return errRpc(String((error as Error)?.message ?? error)) }
            if (tail.length === 0) return ok({ ok: false, reason: 'empty', message: '分支在分叉点之后没有新内容，不需要回推', exits: [] })
            // 先记意图再发：失败后可据水位重试；设备侧的认领保证同一条会话不会被写两次。
            saveBranch({ ...record, pushIntentAt: Date.now() })
            let reply
            try { reply = await pushRemoteBranch(host, { sessionId: record.remoteSessionId, afterSeq: record.forkPoint, events: tail }) }
            catch (error) { return ok({ ok: false, reason: 'unreachable', message: remoteFailureMessage(error), exits: [] }) }
            if (!reply.ok) return ok({ ok: false, reason: reply.reason, message: reply.message ?? '设备没有收下这次回推', exits: reply.exits ?? [] })
            // 先记「已回推」再回到远程：镜像的退役标记据此解除，桥接才会重新登记它。
            saveBranch({ ...record, pushedAt: Date.now() })
            const mirrorId = await returnToRemote(record, record.remoteSessionId)
            return ok({ ok: true, appended: reply.appended ?? tail.length, mirrorSessionId: mirrorId })
          }
          case 'remoteBranch.keep': {
            const record = branchRegistry.load().find((entry) => entry.sessionId === String(payload?.sessionId ?? ''))
            if (record === undefined) return errRpc('not-branch')
            saveBranch({ ...record, keptAt: Date.now() })
            return ok(true)
          }
          case 'remoteBranch.fork': {
            // 出口之二：不合并，用分支的全部内容在设备上另起一条新会话，本机镜像它；分支归档为历史。
            const record = branchRegistry.load().find((entry) => entry.sessionId === String(payload?.sessionId ?? ''))
            if (record === undefined) return errRpc('not-branch')
            const host = remoteHosts.get(record.hostId)
            if (host === undefined) return errRpc('unknown-host')
            const status = await probeHost(host.hostId)
            if (status.state !== 'online') return ok({ ok: false, reason: 'unreachable', message: '设备不可达，另起一条要等它恢复后进行', exits: [] })
            let events: RemoteSessionEvent[]
            try { events = await readLocalLog(record.sessionId) } catch (error) { return errRpc(String((error as Error)?.message ?? error)) }
            let created
            try { created = await forkRemoteBranch(host, { cwd: record.path ?? '', events, title: record.title }) }
            catch (error) { return ok({ ok: false, reason: 'fork-failed', message: remoteFailureMessage(error), exits: [] }) }
            const mirrorId = await returnToRemote(record, created)
            saveBranch({ ...record, forkedTo: created, keptAt: record.keptAt ?? Date.now() })
            return ok({ ok: true, sessionId: created, mirrorSessionId: mirrorId })
          }
          case 'remotePeer.pending': {
            // 被介绍方（#156）：等本机用户决定的配对请求，界面轮询后渲染审批卡。
            introInbox.prune()
            return ok({ requests: introInbox.pending().map((record) => ({ id: record.id, from: record.from, introducer: record.introducer, openedAt: record.openedAt })) })
          }
          case 'remotePeer.decide': {
            // 同意时发一张一次性配对令牌；拒绝后这张请求不能再改。
            const record = introInbox.decide(String(payload?.id ?? ''), payload?.approve === true, payload?.approve === true ? svc.store.mint() : undefined)
            if (record === undefined) return errRpc('not-found')
            return ok({ state: record.state })
          }
          case 'remotePeers.list': {
            // 发起方（#156）：经某台介绍人能看到的同组设备。已配对的标出来；被拒过的不再列。
            const host = remoteHosts.get(String(payload?.hostId ?? ''))
            if (host === undefined) return errRpc('unknown-host')
            let peers: PeerEntry[]
            try { peers = await fetchPeers(host) } catch (error) { return errRpc(remoteFailureMessage(error)) }
            const mine = remoteHosts.list()
            const progressOf = (deviceKey: string) => introOutbox.byDevice(deviceKey)
            return ok({
              peers: peers
                .filter((peer) => progressOf(peer.deviceId)?.state !== 'rejected')
                .map((peer) => ({
                  deviceId: peer.deviceId, name: peer.name, origin: peer.origin, lastSeen: peer.lastSeen,
                  paired: mine.some((record) => record.origin === peer.origin),
                  request: progressOf(peer.deviceId)?.state ?? null,
                  detail: progressOf(peer.deviceId)?.detail,
                })),
            })
          }
          case 'remotePeers.request': {
            // 发起方（#156）：拿介绍人指名给本机的凭证，向目标设备敲门；对方先核实再审批。
            const host = remoteHosts.get(String(payload?.hostId ?? ''))
            if (host === undefined) return errRpc('unknown-host')
            const deviceKey = String(payload?.deviceId ?? '')
            let peer: PeerEntry | undefined
            try { peer = (await fetchPeers(host)).find((entry) => entry.deviceId === deviceKey) } catch (error) { return errRpc(remoteFailureMessage(error)) }
            if (peer === undefined) return errRpc('not-found')
            introOutbox.open(deviceKey, peer.origin, peer.name)
            if (!svc.tunnel.listening) return errRpc('本机 lane 未监听（端口被占用？），无法接受对方的反向登记')
            const lanIp = (await svc.localAddressToward(peer.origin)) ?? selectLanIPv4(os.networkInterfaces() ?? {})
            const selfOrigin = `http://${lanIp}:${String(svc.tunnel.port)}`
            let reply: { ok?: boolean; id?: string; message?: string }
            try {
              const response = await fetch(`${peer.origin}${LANE_PREFIX}/api/pair/introduce`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ intro: peer.intro, introducer: { origin: host.origin }, from: { origin: selfOrigin, name: os.hostname(), model: svc.localModel() } }),
                signal: AbortSignal.timeout(15_000),
              })
              reply = await response.json().catch(() => ({})) as typeof reply
              if (!response.ok || reply?.ok !== true) {
                const message = reply?.message ?? `HTTP ${String(response.status)}`
                introOutbox.set(deviceKey, 'failed', message)
                return ok({ state: 'failed', message })
              }
            } catch (error) {
              const message = `连不上 ${peer.name}（${peer.origin}）：${String((error as Error)?.message ?? error)}`
              introOutbox.set(deviceKey, 'failed', message)
              return ok({ state: 'failed', message })
            }
            introOutbox.note(deviceKey, String(reply.id))
            return ok({ state: 'pending' })
          }
          case 'remotePeers.status': {
            // 发起方（#156）：轮询对方对这次请求的决定；同意后走正常的双向配对，并记下「经谁介绍」以备中转兜底。
            const host = remoteHosts.get(String(payload?.hostId ?? ''))
            if (host === undefined) return errRpc('unknown-host')
            const deviceKey = String(payload?.deviceId ?? '')
            const entry = introOutbox.byDevice(deviceKey)
            if (entry === undefined) return errRpc('not-found')
            if (entry.state !== 'pending') return ok({ state: entry.state, detail: entry.detail })
            const requestId = entry.requestIds[entry.requestIds.length - 1]
            if (requestId === undefined) return ok({ state: 'pending' })
            let reply: { state?: string; token?: string }
            try {
              const response = await fetch(`${entry.origin}${LANE_PREFIX}/api/pair/introduce.status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: requestId }), signal: AbortSignal.timeout(15_000) })
              reply = await response.json().catch(() => ({})) as typeof reply
            } catch (error) { return ok({ state: 'pending', detail: `暂时问不到 ${entry.name}：${String((error as Error)?.message ?? error)}` }) }
            if (reply?.state === 'approved' && typeof reply.token === 'string' && reply.token !== '') {
              try {
                const paired = await pairAndRegister(entry.origin, reply.token, entry.name, true, undefined)
                const recorded = remoteHosts.upsert({ ...paired, introducedBy: host.hostId, introducedAs: deviceKey })
                introOutbox.set(deviceKey, 'paired')
                return ok({ state: 'paired', host: recorded })
              } catch (error) {
                const message = String((error as Error)?.message ?? error)
                introOutbox.set(deviceKey, 'failed', message)
                return ok({ state: 'failed', message })
              }
            }
            if (reply?.state === 'rejected') {
              introOutbox.set(deviceKey, 'rejected', `${entry.name} 拒绝了这次配对请求`)
              return ok({ state: 'rejected', message: `${entry.name} 拒绝了这次配对请求` })
            }
            if (reply?.state === 'expired') {
              introOutbox.set(deviceKey, 'expired', '对方的审批已过期，可以重新请求')
              return ok({ state: 'expired', message: '对方的审批已过期，可以重新请求' })
            }
            return ok({ state: 'pending' })
          }
          case 'remoteBranch.status': {
            // 界面用（#154）：当前打开的会话若是分支，给出出处说法；若是镜像，给出设备状态与能不能接管。
            const sessionId = String(payload?.sessionId ?? '')
            const branch = branchRegistry.load().find((record) => record.sessionId === sessionId)
            if (branch !== undefined) {
              // 分支：给出处说法，并说明现在能不能回推（设备恢复后可以；已保持本地或已回推过就不再提）。
              const owner = remoteHosts.get(branch.hostId)
              const state = owner === undefined ? 'unpaired' : (await probeHost(owner.hostId)).state
              const decision = decidePushbackFromBranch(branch, state)
              return ok({ kind: 'branch', label: branchLabel(branch), push: decision.ok ? { state: 'ready' } : { state: decision.reason, message: decision.message } })
            }
            const ref = remoteSessionBridge?.sessions.get(sessionId)
            if (sessionId === '' || ref === undefined || remoteIdOfMirror(sessionId, ref.hostId) === undefined) return ok(null)
            const host = remoteHosts.get(ref.hostId)
            if (host === undefined) return ok({ kind: 'mirror', state: 'unpaired', reason: '设备未配对', canTakeover: false, message: '设备未配对，先重新配对' })
            const status = await probeHost(host.hostId)
            const decision = decideTakeover(status.state)
            return ok({ kind: 'mirror', state: status.state, reason: describeRemoteLink(status), canTakeover: decision.ok, message: decision.ok ? '' : decision.message })
          }
          case 'remoteInteraction.pending': {
            // 交互中继（#151）：客户端插件取走等本机用户回答的提问 / 审批，渲染成卡片。
            const sessionId = String(payload?.sessionId ?? '')
            if (remoteSessionBridge === null) return ok({ interactions: [] })
            return ok({ interactions: remoteSessionBridge.pendingInteractions(sessionId === '' ? undefined : sessionId) })
          }
          case 'remoteInteraction.answer': {
            // 交互中继（#151）：把本机用户的回答交回 A。没被收下时如实返回，客户端据此提示。
            if (remoteSessionBridge === null) return errRpc('bridge-unavailable')
            try {
              return ok({ accepted: await remoteSessionBridge.answerInteraction(payload?.answer) })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSession.pull': {
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const sessionId = String(payload?.sessionId ?? '')
            const targetPath = String(payload?.path ?? '')
            if (sessionId === '' || targetPath === '') return errRpc('bad-request')
            const bridge = remoteSessionBridge
            if (bridge === null) return errRpc('bridge-unavailable')
            try {
              // 入参是远端会话 id；本机看到的是带 remote- 前缀的镜像会话 id。
              const localId = mirrorIdOf(hostId, sessionId)
              bridge.register(localId, { hostId, path: targetPath })
              const result = await bridge.pullOne(localId, { hostId, path: targetPath })
              return ok({ sessionId: localId, appended: result?.appended ?? 0, watermark: result?.watermark ?? -1 })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSessions.list': {
            // #107：列出某个远端工作区在本机已落盘的会话 + 流转来源（#109）。
            const hostId = String(payload?.hostId ?? '');
            const targetPath = String(payload?.path ?? '');
            if (hostId === '' || targetPath === '') return errRpc('bad-request');
            const local = buildRemoteSessionSource((name) => {
              try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined; } catch { return undefined; }
            });
            try {
              const headers = await listSessionsUnderPath(local, targetPath);
              return ok({
                sessions: headers.map((header) => {
                  const record = handoffs.get(header.id);
                  return {
                    id: header.id,
                    cwd: header.cwd,
                    createdAt: header.createdAt ?? null,
                    handedOff: record ?? null,
                    writable: record !== undefined,
                  };
                }),
              });
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error));
            }
          }
          case 'remoteSessions.read': {
            // #107：只读视图——按事件顺序交给界面；写入走官方会话，不经这里。
            const sessionId = String(payload?.sessionId ?? '');
            if (sessionId === '') return errRpc('bad-request');
            const query = ctx.get?.('sessionQuery') as
              | { readSession?: (id: string) => Promise<{ session: { id?: unknown, cwd?: unknown, createdAt?: unknown }, events: unknown[] }> }
              | undefined;
            const snapshot = await query?.readSession?.(sessionId);
            if (snapshot === undefined) return errRpc('not-found');
            return ok({
              session: {
                id: String(snapshot.session.id ?? sessionId),
                cwd: typeof snapshot.session.cwd === 'string' ? snapshot.session.cwd : '',
                createdAt: snapshot.session.createdAt ?? null,
              },
              events: snapshot.events,
              handedOff: handoffs.get(sessionId) ?? null,
            });
          }
          case 'remoteSessions.handoff': {
            // #109：单向搬运一次；是否放行由 decideHandoff（纯函数）判定，第二次一律拒绝。
            // 单向搬运（#109）已被「接管 / 回推」（#154 / #155）取代，对应票落地前不开放。
            if (!REMOTE_HANDOFF_ENABLED) return errRpc('会话搬运已由「接管 / 回推」取代，当前阶段不提供');
            const hostId = String(payload?.hostId ?? '');
            const targetPath = String(payload?.path ?? '');
            const sessionId = String(payload?.sessionId ?? '');
            const host = remoteHosts.get(hostId);
            if (host === undefined) return errRpc('unknown-host');
            if (targetPath === '' || sessionId === '') return errRpc('bad-request');
            try {
              const log = await fetchRemoteSessionLog(host, sessionId);
              const decision = decideHandoff(handoffs.get(sessionId), log.events.length);
              if (decision.action === 'refuse') {
                return ok({ handedOff: false, reason: decision.reason, record: handoffs.get(sessionId) ?? null });
              }
              const sessions = ctx.get?.('sessions') as SessionStoreLike | undefined;
              if (sessions === undefined) return errRpc('no-session-store');
              const persistence = ctx.get?.('sessionPersistence') as SessionPersistenceLike | undefined;
              const materialized = await materializeSession(sessions, log, targetPath, persistence);
              const record = handoffs.upsert({
                sessionId: materialized.id,
                hostId,
                hostName: host.name || host.origin,
                originSessionId: sessionId,
                path: targetPath,
                handedOffAt: Date.now(),
                eventCount: materialized.eventCount,
              });
              return ok({ handedOff: true, reason: null, record, session: materialized });
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error));
            }
          }
          default:
            return errRpc('unknown-endpoint');
        }
      } catch (e) {
        return errRpc(String((e as { message?: unknown } | null | undefined)?.message ?? e));
      }
    };
    // 控制面注册：官方业务插件模式（session-controller 的 media-references 同款）——
    // ctx.connection.fetch.register 每命令一条 exact 路径（/api/remote-access.<命令>）。
    // fetch.register 只写连接服务的内存路由表，不触碰 webServer（rpc.handle 那条会
    // 被 guard 拒）；认证与 wire 由官方 /api 路由承载；client 半区
    // rpc.call('/api', 'remote-access.<命令>', payload)。
    const registerControlPlane = (scope: LaneRuntimeContext) => {
      const connection = scope?.connection;
      if (connection?.fetch?.register === undefined) {
        ctx?.logger?.warn?.('dsh-remote-access: connection.fetch 不可用，控制面未注册（面板将不可用）');
        return;
      }
      const serve = async (request: Request): Promise<Response> => {
        let rpcId = ''
        try {
          const body = await request.json() as { rpcId?: unknown; method?: unknown; payload?: unknown }
          rpcId = String(body?.rpcId ?? '');
          const endpoint = String(body?.method ?? '').replace(/^remote-access\./, '');
          // 调用方若经本机 lane 的配对门禁进来，lane 转发时带了它的会话值：据此认出是哪台已配对设备在调用。
          const laneSession = request.headers.get(LANE_PAIRED_HEADER)
          const laneDeviceId = laneSession === null ? undefined : (svc.store.deviceIdOf(laneSession) ?? undefined)
          const caller: { laneDeviceId?: string } = laneDeviceId === undefined ? {} : { laneDeviceId }
          const result = endpoint === '' ? errRpc('empty endpoint') : await dispatch(endpoint, (body?.payload ?? {}) as Record<string, unknown>, caller);
          // 变更类命令成功后立刻推一条事件：页面收到就重画，不用等轮询。
          if ((result as { ok?: boolean } | null | undefined)?.ok === true) {
            if (endpoint.startsWith('remoteWorkspace.')) broadcastEvent('workspaces')
            else if (endpoint.startsWith('remoteHosts.')) broadcastEvent('hosts')
            else if (endpoint.startsWith('remoteShare.')) broadcastEvent('shares')
            else if (endpoint.startsWith('remoteSession')) broadcastEvent('sessions')
          }
          return Response.json({ type: 'server-response', rpcId, result });
        } catch (e) {
          return Response.json({ type: 'server-response', rpcId, result: errRpc(String((e as { message?: unknown } | null | undefined)?.message ?? e)) });
        }
      };
      // 命令表与 switch 分支必须一一对应：漏登记的命令会被 /api 直接回 404（字面 `not found`），
      // 表现为「有的命令能用、有的不能用」，而不是一个可诊断的错误。
      const commands = ['info', 'devices.list', 'devices.remove', 'token.mint', 'token.ref', 'tunnel.probe', 'tunnel.save', 'cloudflared.get', 'cloudflared.apply', 'cloudflared.stop', 'remoteHosts.list', 'remoteHosts.pair', 'remoteHosts.remove', 'remoteHosts.rename', 'remoteWorkspace.list', 'remoteWorkspace.browse', 'remoteWorkspace.add', 'remoteWorkspace.remove', 'remoteWorkspace.claim', 'remoteEvents.wait', 'remoteSessions.sync', 'remoteSessions.list', 'remoteSessions.read', 'remoteSessions.handoff', 'remoteStatus.probe', 'remoteSession.create', 'remoteSession.prompt', 'remoteSession.pull', 'remoteCommand.execute', 'remoteSession.invoke', 'remoteSession.push', 'remoteSession.syncNow', 'remoteSession.takeover', 'remoteBranch.list', 'remoteBranch.status', 'remoteBranch.push', 'remoteBranch.keep', 'remoteBranch.fork', 'remotePeer.pending', 'remotePeer.decide', 'remotePeers.list', 'remotePeers.request', 'remotePeers.status', 'remoteInteraction.pending', 'remoteInteraction.answer', 'remoteWebui.open', 'remoteWorkspace.syncNow', 'remoteShare.add', 'remoteShare.list', 'remoteShare.remove'];
      for (const cmd of commands) {
        connection.fetch.register({
          path: `/api/remote-access.${cmd}`,
          methods: ['POST'],
          requestBody: 'buffered',
          fetch: serve,
        });
      }
      ctx?.logger?.info?.(`dsh-remote-access: 控制面已注册（/api/remote-access.*，共 ${commands.length} 条）`);
    };
    try {
      if (typeof ctx.inject === 'function') ctx.inject(['connection'], registerControlPlane)
      else registerControlPlane(ctx)
    } catch (error) {
      try { ctx?.logger?.warn?.(`dsh-remote-access: 同源 RPC 未注册（${String(error)}），lane 仍会启动`) } catch { /* noop */ }
    }
  } else {
    // SSE 事件通道：页面打开后连一次，host 侧任何变更都推过去。
    const installEventStream = (scope: unknown): void => {
      const webServer = (scope as { webServer?: { register?: (route: unknown) => unknown } } | undefined)?.webServer
      if (webServer === undefined || typeof webServer.register !== 'function') return
      try {
        webServer.register({
          kind: 'exact',
          path: '/api/remote-access.events',
          handler: (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => {
            response.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
              'x-accel-buffering': 'no',
            })
            response.write('retry: 3000\n\n')
            eventClients.add(response)
            const timer = setInterval(() => { try { response.write(': ping\n\n') } catch { /* 已断开 */ } }, 25_000)
            const done = (): void => {
              clearInterval(timer)
              eventClients.delete(response)
            }
            request.on('close', done)
            response.on('close', done)
          },
        })
      } catch (error) {
        try { ctx?.logger?.warn?.(`dsh-remote-access: 事件通道未注册（${String(error)}）`) } catch { /* noop */ }
      }
    }
    try {
      if (typeof ctx.inject === 'function') ctx.inject(['webServer'], installEventStream)
      else installEventStream(ctx)
    } catch { /* webServer 不可用：事件通道缺失，页面退回手动刷新 */ }
    try { ctx?.logger?.warn?.('dsh-remote-access: connection.rpc 不可用，client 端将无法与 host 通信'); } catch { /* noop */ }
  }
  let closed = false;
  const boot = async (): Promise<void> => {
    // 端口被占时自动取空闲端口（#145）：桌面宿主常占着 3091，独立 profile 的 lane
    // 如果静默失败，mint 照常成功、链接却指向别人的 lane，用户看到的是「令牌无效」。
    let boundPort = lanePort
    try {
      boundPort = await svc.listen(lanePort)
    } catch (e) {
      try { ctx?.logger?.warn?.(`dsh-remote-access: lane ${lanePort} 不可用（${String(e)}），改取空闲端口`); } catch { /* noop */ }
      try {
        boundPort = await svc.listen(0)
      } catch (e2) {
        // 连空闲端口都拿不到：lane 彻底不可用，记下原因让 mint 直接失败。
        laneFailure = `lane 启动失败: ${String(e2)}`
        try { ctx?.logger?.error?.(`dsh-remote-access: ${laneFailure}`); } catch { /* noop */ }
        return;
      }
    }
    lanePort = boundPort
    // 启动横幅：报出上游与自有控制面的保留命名空间——命名空间外的一切路径原样透传（#145）。
    try { ctx?.logger?.info?.(`dsh-remote-access: lane 改写反代已监听 127.0.0.1:${lanePort} → ${svc.proxy.upstream}（控制面 ${LANE_PREFIX}/，其余全量透传）`); } catch { /* noop */ }
    // 预热 dsh 会话凭证（异步，失败不阻塞：首个上游 401 会触发自动重换）
    void svc.dshAuth?.ensure?.();
    // 启动时按 env（桌面壳 spawn 注入）优先，其次 settings.yaml 持久化值；
    // 运行期变更走 POST /api/pair/cloudflared（立即生效 + 持久化）。
    let bin = process.env.DSH_CLOUDFLARED_BIN || '';
    if (!bin) {
      try { bin = readSetting('cloudflared_bin') ?? ''; } catch { bin = ''; }
    }
    if (bin) {
      svc.startTunnel(bin, lanePort);
      try {
        if (closed) return;
        if (svc.tunnel.url) ctx?.logger?.info?.(`dsh-remote-access: cloudflared 隧道 ${svc.tunnel.url}`);
        else ctx?.logger?.info?.('dsh-remote-access: cloudflared 已启动，等待隧道地址');
      } catch { /* noop */ }
    }
  };

  const ready = boot();
  const dispose = () => {
    closed = true;
    remoteSessionBridge?.dispose()
    svc.stopTunnel();
    // 先停广播（发告别包）再关端口：顺序反了手机端会缓存旧记录。
    return Promise.all([svc.stopAdvertising(), svc.close()]);
  };
  return { svc, ready, dispose };
}

/** dsh bundle 插件入口：cordis-plugin-loader 会同时读取 apply + inject。 */
export function apply(ctx: LaneRuntimeContext): void {
  // #145：所有状态（配对设备、会话 cookie、隧道地址、调优参数、访问日志）按 profile 隔离。
  // profile 名来自官方 profileContext；拿不到时回退 default（单 profile 场景行为不变）。
  // 必须在 startLaneRuntime 之前设好——存储路径在构造时就要确定。
  try {
    const profile = (typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined) as { name?: unknown } | undefined
    setProfileScope(typeof profile?.name === 'string' ? profile.name : null)
  } catch { /* 服务不可用：保持回退值 */ }
  const runtime = startLaneRuntime(ctx);
  if (!runtime) return;
  // ctx dispose = lane 生命周期终点：停隧道、停 mDNS 广播、关端口。
  ctx.on('dispose', runtime.dispose);
}
