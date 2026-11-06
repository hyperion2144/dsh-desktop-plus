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
  type RewriteProxy,
  type UpstreamPort,
} from './proxy.js'
import { clientIp, entryKind } from './client-info.js'
import { LANE_PREFIX, laneRoutePath } from './lane-routes.js'
import { createDshUpstreamAuth, type DshUpstreamAuth } from './dshauth.js'
import { PairingStore, createFileStorage, type PairingStorage, type PersistedPairingState } from './pairing.js'
import { selectLanIPv4, buildPairLink, buildHttpPairLink, normalizeRemote, resolveBaseCandidates, sanitizeLocalHostname, type NetworkInterfacesLike } from './links.js'
import { buildLaneServiceRecord, buildLaneTxt, createBonjourPublisher, createLaneAdvertiser, defaultServiceName, type LaneAdvertiser, type LaneServiceRecord, type Publisher } from './mdns.js'
import { readSettingsString, writeSettingsKey, readTopLevelBlockKey, readShellSetting, writeShellSetting } from './settings.js'
import { laneWsTokenSecret, mintWsToken, verifyWsToken, wsTokenOf } from './ws-token.js'
import { resolveCloudflared } from './cloudflared.js'
import { basename } from 'node:path'
import { RemoteHostStore, createRemoteHostStorage, fetchFromHost, pairWithHost, type RemoteHostRecord } from './remote-hosts.js'
import { createRemoteShareRegistry, type RemoteShareRegistry } from './remote-share-registry.js'
import { buildRemoteSessionSource, fetchRemoteSessionLog, fetchRemoteSessions, listSessionsUnderPath, materializeSession, sameCwd, type SessionHeaderSource, type SessionLogSource, type SessionPersistenceLike, type SessionStoreLike } from './remote-sessions.js'
import { RemoteWorkspaceStore, createRemoteWorkspaceStorage, installRemoteWorkspaceBridge, normalizeRemotePath, REMOTE_BRIDGE_UNSUPPORTED, type RemoteWorkspaceBridge, type WorkspaceRegistryLike } from './remote-workspaces.js'
import { HandoffStore, createFileHandoffStorage, decideHandoff } from './remote-handoff.js'
import { probeRemoteHost, describeRemoteLink, readPluginVersion, REMOTE_PROTOCOL_VERSION } from './remote-status.js'
import { listLocalDirectory, fetchRemoteDirectory } from './remote-fs.js'

import { createRemoteWorkspace, createRemoteSession, promptRemoteSession } from './remote-rpc.js'
import { mirrorRemoteSession } from './remote-session-mirror.js'
import { installRemoteSessionBridge, type RemoteSessionBridge } from './remote-session-bridge.js'
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
        return { ok: session !== null && store.isDevice(session, meta0) };
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
      const ok = cookies.some((c) => store.isDevice(c, meta));
      return { ok };
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
    const sendSessions = async (target: string) => {
      const source = opts.sessions ?? null;
      if (source === null) { json(503, { error: 'sessions-unavailable' }); return; }
      try { json(200, { sessions: await listSessionsUnderPath(source, target) }); }
      catch (error) { json(500, { error: 'read-failed', message: String((error as Error)?.message ?? error) }); }
    };
    if (path === '/api/remote/sessions' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const target = String(payload.path ?? '');
        if (target === '') { json(400, { error: 'bad-path' }); return; }
        void sendSessions(target);
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
    if (path === '/api/remote/session.read' && req.method === 'POST') {
      if (!canManage) { unpaired401(); return true; }
      readJsonBody((payload) => {
        const source = opts.sessions ?? null;
        const sessionId = String(payload.sessionId ?? '');
        if (source === null) { json(503, { error: 'sessions-unavailable' }); return; }
        if (sessionId === '') { json(400, { error: 'bad-session' }); return; }
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
      const shares = remoteShares.load().filter((entry) => entry.deviceId === deviceId)
      warn?.(`dsh-remote-access: shares 查询 device=${deviceId} path=${remoteShares.path} total=${remoteShares.load().length}`)
      res.write(`event: ready\ndata: ${JSON.stringify({ shares })}\n\n`)
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
      const devices = new Set(remoteShares.load().filter((entry) => entry.sessionId === sessionId).map((entry) => entry.deviceId))
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
    viewerCount(sessionId) {
      const devices = new Set(remoteShares.load().filter((entry) => entry.sessionId === sessionId).map((entry) => entry.deviceId))
      let count = 0
      for (const client of streamClients) if (devices.has(client.deviceId)) count += 1
      return count
    },
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
        if (addr && typeof addr === 'object') tunnel.port = addr.port;
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
export const inject = ['connection', 'settings', 'webServer'];

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
  if (process.env.DSH_REMOTE_ENABLED === '0') return;
  const lanePort = Number(process.env.DSH_REMOTE_LANE_PORT || 3091);
  // mDNS 广播：桌面场景默认开启（DSH_REMOTE_MDNS=0 可关）；测试注入假广播器。
  const mdns = opts.mdns ?? { enabled: process.env.DSH_REMOTE_MDNS !== '0' };
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
  // #116：壳专属键（tunnel_url/cloudflared_bin/ws_*）的权威落点是壳的
  // $DSH_HOME/desktop-settings.json（#95 后 dsh settings 插件命名空间与 settings.yaml 均已废除，
  // 经它们保存只会“看似成功”而无处落盘）；旧通道仅作历史数据读取兜底。
  const readSetting = (key: string): string | null => {
    const shell = readShellSetting(key)
    if (shell !== null && shell !== undefined) {
      return typeof shell === 'string' ? shell : JSON.stringify(shell)
    }
    if (settingsSvc) {
      const v = settingsSvc.get(NS)?.[key]
      if (v !== undefined && v !== null) return v as string | null
    }
    return readSettingsString(key);
  };
  const writeSettings = async (patch: Record<string, unknown>): Promise<void> => {
    // #116：只写壳设置 JSON；不再 mutate dsh settings 命名空间（已废除，勿回改）
    for (const [key, value] of Object.entries(patch)) writeShellSetting(key, value);
  };
  // 会话来源：lane 数据面读日志、命令面写日志（推送到远程）共用同一份。
  const sessionSource = buildRemoteSessionSource((name) => {
    try { return typeof ctx.get === 'function' ? ctx.get(name) : undefined; } catch { return undefined; }
  })
  const svc = createRemoteAccessService({
    upstreamHost: '127.0.0.1',
    upstreamPort,
    platform,
    readSetting,
    writeSettings,
    mdns,
    sessions: sessionSource,
    warn: (m) => { try { ctx?.logger?.warn?.(m); } catch { /* noop */ } },
    // dsh 进程内自取 process token 的通道（connection 服务公开方法；缺失则 lane 无凭证运行）
    authenticatedUrl: (origin) => {
      try { return ctx?.connection?.authenticatedUrl?.(origin) ?? null; } catch { return null; }
    },
  });

  // 远程工作区 / 出站主机：把已配对主机的目录登记成本机官方 Workspace。
  // 两份存储分开：hosts = 我要连过去的主机（出站），workspaces = 登记了哪些目录。
  const remoteHosts = new RemoteHostStore({ storage: createRemoteHostStorage() })
  const remoteWorkspaces = new RemoteWorkspaceStore({ storage: createRemoteWorkspaceStorage() })
  // 流转来源（#109）：会话被搬过来时记一条，界面据此标注来源并拒绝二次搬运。
  const handoffs = new HandoffStore({ storage: createFileHandoffStorage() })
  let remoteBridge: RemoteWorkspaceBridge | null = null
  // 远端会话镜像进度：sessionId → 已镜像到的远端 seq。进程内即可，重启后按需重建。
  const mirrorCursors = new Map<string, { seq: number }>()
  // 远程会话登记：会话 id → 主机 / 目录 / 镜像游标。落盘，重启后据此继续镜像与继续对话。
  const remoteSessionRegistry = createRemoteSessionRegistry()
  // A 侧推送：本机会话每产生一个事件，就推给订阅它的设备（分享登记决定推给谁）。
  try {
    ctx.on?.('session/event', (session: { id?: string }, event: unknown) => {
      const id = session?.id
      if (typeof id !== 'string' || id === '') return
      svc.pushSessionEvent(id, [event])
    })
  } catch { /* 事件不可用时只影响推送，不影响其它功能 */ }

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
      restore: () => remoteSessionRegistry.load(),
      persist: (entries) => remoteSessionRegistry.save(entries),
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
   * 把一台主机某个目录下的会话拉过来落盘（#107）。
   *
   * 登记远程工作区与手动「同步」走同一条路径：先向主机要该目录的会话头，再逐个取日志，
   * 经官方持久化服务落盘后在本进程登记活体镜像。重复调用是幂等的（已落盘的会话不再写）。
   * @param host 已配对的主机记录（带 cookie）。
   * @param targetPath 主机上的目录绝对路径。
   * @returns 每个会话的物化结果。
   */
  const syncRemoteSessions = async (host: RemoteHostRecord, targetPath: string): Promise<Array<{ id: string, eventCount: number, durable: boolean }>> => {
    const headers = await listSessionsUnderPath({ listHeaders: async () => await fetchRemoteSessions(host, targetPath) }, targetPath)
    const sessions = ctx.get?.('sessions') as SessionStoreLike | undefined
    if (sessions === undefined) throw new Error('no-session-store')
    // 耐久路径只能经官方持久化服务：sessions.create 只写内存日志。
    const persistence = ctx.get?.('sessionPersistence') as SessionPersistenceLike | undefined
    const materialized: Array<{ id: string, eventCount: number, durable: boolean }> = []
    for (const header of headers) {
      const log = await fetchRemoteSessionLog(host, header.id)
      materialized.push(await materializeSession(sessions, log, targetPath, persistence))
    }
    // 同步下来的会话要挂进这个工作区，否则侧栏把它们归到「未分组」：官方侧栏按
    // Workspace.sessionIds 分组，而 sessions.create 只登记会话、不登记归属。
    // 远端路径在本机不存在时官方 attachSession 会拒绝（它要 realpath + stat），
    // 这时保持未分组即可——下次启动官方 bootstrap 会按路径把它们归位。
    const registry = ensureRemoteBridge()
    const workspace = registry === null ? undefined : await registry.resolveByPath(targetPath)
    for (const session of materialized) {
      try { await workspace?.attachSession?.(session.id) }
      catch { /* 挂不上不影响落盘结果，界面按未分组展示 */ }
    }
    // 同步下来的会话同样是远程会话：登记进桥，之后在界面上发消息会转发给 A 机。
    for (const session of materialized) {
      remoteSessionBridge?.register(session.id, { hostId: host.hostId, path: targetPath })
    }
    return materialized
  }

  // 同源 RPC handler（与 client 共享通道名 /dsh-remote-access）：
  // 桌面壳 WebView 跨域 fetch 被浏览器拦截，必须走 dsh 同源 connection RPC。
  // 同源 RPC handler：connection 用 ctx.get 取（属性代理对拓扑敏感）；失败不能拖垮 lane 启动。
  const connection: ConnectionService | null = (typeof ctx.get === 'function' ? ctx.get('connection') as ConnectionService | undefined : undefined) ?? ctx.connection ?? null;

  if (connection?.rpc?.handle) {
    const ch = '/dsh-remote-access';
    const ok = (v: unknown) => ({ ok: true, value: v });
    const errRpc = (msg: string) => ({ ok: false, error: { code: 'bad-request', message: msg, details: { issues: [{ message: msg }] } } });
    try { ctx?.logger?.info?.('dsh-remote-access: 注册同源 RPC 通道 ' + ch); } catch { /* noop */ }

    // 注册同源 RPC 是可选的：cordis 的 guard 在个别拓扑下会拒绝该 fiber 的服务访问，
    // 这种失败不能拖垮整个插件——lane 反代必须照常起来（否则远程访问整块不可用）。
    // 注册走 ctx.inject(['connection'], …) 显式子 fiber：ctx.inject(deps, fn) =
    // plugin({ inject: deps, apply: fn })，子 fiber 的可见服务完全由 deps 决定（不继承
    // 父 fiber）——只声明 webServer 时 scope.connection 会被 guard 拒（实测 405 根因）。
    // /api 控制面分发器：endpoint → svc（原 connection.rpc.handle 的 switch 原样搬来）。
    const dispatch = async (endpoint: string, payload: Record<string, unknown> = {}): Promise<unknown> => {
      try {
        switch (endpoint) {
          case 'devices.list':
            return ok({ devices: svc.store.snapshotDevices(), tokenRef: svc.store.ref() });
          case 'devices.remove': {
            const id = String(payload?.deviceId ?? '');
            if (!id || !svc.store.removeDevice(id)) return errRpc('not-found');
            return ok(true);
          }
          case 'token.mint': {
            const t = svc.store.mint();
            return ok({ token: t, expiresAt: svc.store.tokenExpiresAt });
          }
          case 'token.ref':
            return ok({ ref: svc.store.ref() });
          case 'info': {
            const interfaces: NetworkInterfacesLike = os.networkInterfaces?.() ?? {}
            const lanIp = selectLanIPv4(interfaces);
            const baseCandidates = resolveBaseCandidates({ hostname: os.hostname(), interfaces, port: svc.tunnel?.port ?? 3091 });
            let customTunnelUrl = svc.tunnel && svc.tunnel._customUrl ? svc.tunnel._customUrl : '';
            if (!customTunnelUrl) {
              try { customTunnelUrl = readSetting('tunnel_url') ?? ''; } catch { /* noop */ }
            }
            return ok({
              lanePort: svc.tunnel?.port ?? 3091,
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
            const origin = String(payload?.origin ?? '');
            const token = String(payload?.token ?? '');
            try {
              const paired = await pairWithHost({
                origin,
                token,
                name: typeof payload?.name === 'string' && payload.name !== '' ? payload.name : undefined,
              });
              // 同一地址重复配对会生成新的 deviceId → 新的 hostId，先去重再落表。
              // 顺序不能反：先 upsert 再按 origin 去重会把刚写进去的那条也删掉。
              for (const existing of remoteHosts.list()) {
                if (existing.origin === paired.record.origin) remoteHosts.remove(existing.hostId)
              }
              const host = remoteHosts.upsert(paired.record)
              // 双向：把本机也登记到对端，保证两边都能发起会话。反向登记失败就回滚，
              // 反向调用带 reverse:false，否则 A→B→A→B 无限递归（实测直接挂住）。
              if (payload?.reverse !== false) {
                try {
                  const backToken = svc.store.mint()
                  const lanIp = (await svc.localAddressToward(paired.record.origin)) ?? selectLanIPv4(os.networkInterfaces() ?? {})
                  const port = svc.tunnel?.port ?? 3091
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
                } catch (error) {
                  remoteHosts.remove(host.hostId)
                  return errRpc(`reverse-failed: ${String((error as Error)?.message ?? error)}`)
                }
              }
              return ok({ host })
            } catch (error) {
              const code = (error as { code?: unknown } | null)?.code;
              return errRpc(typeof code === 'string' ? code : String((error as Error)?.message ?? error));
            }
          }
          case 'remoteHosts.remove': {
            const hostId = String(payload?.hostId ?? '');
            if (hostId === '' || !remoteHosts.remove(hostId)) return errRpc('not-found');
            // 撤销配对后，该主机名下的工作区登记一并摘掉：主机没了，这些登记再也解析不出
            // 任何端点，留着只会变成点不动的死条目（后续 sync/probe 一律 unknown-host）。
            for (const workspace of remoteWorkspaces.list()) {
              if (workspace.hostId === hostId) remoteWorkspaces.remove(hostId, workspace.path);
            }
            return ok(true);
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
              const value = await remoteSessionBridge.invokeRemote(namespace, method, args)
              if (value === undefined) return errRpc('not-found')
              return ok({ value })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteWorkspace.list': {
            // 主机归属随列表一起下发：徽标只靠这一次调用就能画出「远程 · <主机>」，
            // 不再二次拉主机表（那次调用失败会让徽标退化成只有「远程」）。
            const workspaces = remoteWorkspaces.list().map((workspace) => {
              const host = remoteHosts.get(workspace.hostId)
              const hostName = host === undefined
                ? ''
                : host.renamedAt !== undefined && host.name !== '' ? host.name : host.origin
              return { ...workspace, hostName, hostOrigin: host?.origin ?? '', streamState: remoteSessionBridge?.streamState(workspace.hostId) ?? 'disconnected' }
            })
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
            // 远端工作区必须真的建在 A 上：只在本机登记一个指向远端路径的工作区，
            // 换一台机器就立刻失效（本机没有那个目录）。这里先让 A 建出它自己的工作区，
            // 失败不阻断本机登记，但把原因带回去。
            let remoteWorkspaceId: string | null = null
            let remoteError: string | null = null
            try { remoteWorkspaceId = (await createRemoteWorkspace(host, record.path)).workspaceId }
            catch (error) { remoteError = String((error as Error)?.message ?? error) }
            // 登记完立刻同步一次：加完远程工作区就该看到那台主机的会话，
            // 而不是再去设置里点一次「同步」。同步失败不回滚登记——工作区本身已经成立，
            // 失败原因随返回值带出去，界面据此提示。
            let sessions: Array<{ id: string, eventCount: number, durable: boolean }> = [];
            let syncError: string | null = null;
            try { sessions = await syncRemoteSessions(host, record.path); }
            catch (error) { syncError = String((error as Error)?.message ?? error); }
            return ok({ workspace: { id: workspace.id, path: workspace.path, title: workspace.title }, sessions, syncError, remoteWorkspaceId, remoteError });
          }
          case 'remoteWorkspace.remove': {
            const hostId = String(payload?.hostId ?? '');
            const rawPath = String(payload?.path ?? '');
            if (hostId === '' || rawPath === '') return errRpc('bad-request');
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
            const status = await probeRemoteHost(host, { localVersion: readPluginVersion() });
            if (status.state === 'online') remoteHosts.upsert({ ...host, lastSeen: status.checkedAt });
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
            const all = svc.shares.load()
            const shares = sessionId === '' ? all : all.filter((entry) => entry.sessionId === sessionId)
            return ok({ shares: shares.map((entry) => ({ ...entry, viewers: svc.viewerCount(entry.sessionId) })) })
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
            // 把 A 机该目录下所有会话的最新内容拉到本机：新会话建成本机远程会话，
            // 已有会话交给镜像轮询补增量。
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const targetPath = String(payload?.path ?? '')
            if (targetPath === '') return errRpc('bad-path')
            const store = ctx.get?.('sessions') as SessionStoreLike | undefined
            if (store === undefined) return errRpc('no-session-store')
            const persistence = ctx.get?.('sessionPersistence') as SessionPersistenceLike | undefined
            try {
              const headers = await fetchRemoteSessions(host, targetPath)
              const workspace = remoteWorkspaces.list().find((entry) => entry.hostId === hostId && sameCwd(entry.path, targetPath))
              let created = 0
              let existing = 0
              for (const header of headers) {
                if (store.get(header.id) === undefined) {
                  const log = await fetchRemoteSessionLog(host, header.id)
                  await materializeSession(store as never, log, targetPath, persistence as never)
                  created += 1
                } else {
                  existing += 1
                }
                if (workspace !== undefined) remoteSessionBridge?.register(header.id, workspace)
              }
              return ok({ total: headers.length, created, existing })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
            }
          }
          case 'remoteSession.syncNow': {
            // 单个远程会话：立刻拉一次最新内容（远端有新消息时本机镜像不会自动知道）。
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
            const hostId = String(payload?.hostId ?? '')
            const host = remoteHosts.get(hostId)
            if (host === undefined) return errRpc('unknown-host')
            const targetPath = String(payload?.path ?? '')
            if (targetPath === '') return errRpc('bad-path')
            const store = ctx.get?.('sessions') as SessionStoreLike | undefined
            if (store === undefined) return errRpc('no-session-store')
            try {
              const remote = await createRemoteWorkspace(host, targetPath)
              const sessionId = await createRemoteSession(host, { workspaceId: remote.workspaceId })
              await mirrorRemoteSession(host, sessionId, targetPath, store as never, mirrorCursors)
              return ok({ sessionId, workspaceId: remote.workspaceId })
            } catch (error) {
              return errRpc(String((error as Error)?.message ?? error))
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
            const store = ctx.get?.('sessions') as SessionStoreLike | undefined
            if (store === undefined) return errRpc('no-session-store')
            try {
              return ok(await mirrorRemoteSession(host, sessionId, targetPath, store as never, mirrorCursors))
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
          const result = endpoint === '' ? errRpc('empty endpoint') : await dispatch(endpoint, (body?.payload ?? {}) as Record<string, unknown>);
          return Response.json({ type: 'server-response', rpcId, result });
        } catch (e) {
          return Response.json({ type: 'server-response', rpcId, result: errRpc(String((e as { message?: unknown } | null | undefined)?.message ?? e)) });
        }
      };
      // 命令表与 switch 分支必须一一对应：漏登记的命令会被 /api 直接回 404（字面 `not found`），
      // 表现为「有的命令能用、有的不能用」，而不是一个可诊断的错误。
      const commands = ['info', 'devices.list', 'devices.remove', 'token.mint', 'token.ref', 'tunnel.probe', 'tunnel.save', 'cloudflared.get', 'cloudflared.apply', 'cloudflared.stop', 'remoteHosts.list', 'remoteHosts.pair', 'remoteHosts.remove', 'remoteHosts.rename', 'remoteWorkspace.list', 'remoteWorkspace.browse', 'remoteWorkspace.add', 'remoteWorkspace.remove', 'remoteSessions.sync', 'remoteSessions.list', 'remoteSessions.read', 'remoteSessions.handoff', 'remoteStatus.probe', 'remoteSession.create', 'remoteSession.prompt', 'remoteSession.pull', 'remoteCommand.execute', 'remoteSession.invoke', 'remoteSession.push', 'remoteSession.syncNow', 'remoteWorkspace.syncNow', 'remoteShare.add', 'remoteShare.list', 'remoteShare.remove'];
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
    try { ctx?.logger?.warn?.('dsh-remote-access: connection.rpc 不可用，client 端将无法与 host 通信'); } catch { /* noop */ }
  }
  let closed = false;
  const boot = async (): Promise<void> => {
    try {
      await svc.listen(lanePort);
    } catch (e) {
      try { ctx?.logger?.error?.(`dsh-remote-access: lane ${lanePort} 启动失败: ${String(e)}`); } catch { /* noop */ }
      return;
    }
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
  const runtime = startLaneRuntime(ctx);
  if (!runtime) return;
  // ctx dispose = lane 生命周期终点：停隧道、停 mDNS 广播、关端口。
  ctx.on('dispose', runtime.dispose);
}
