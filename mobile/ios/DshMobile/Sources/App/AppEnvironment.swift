import Foundation

/// 壳的装配点：进程级单例都在这里建。
///
/// 依赖方向是单向的：
/// `store`（Keychain） → `host`（主机仓库） → `pair` / `connect`（配对与连接） → `ui`（界面）。
/// 界面之间不直接互相调用：管理页改「当前主机」，主界面回前台时自己发现并切代理目标。
@MainActor
final class AppEnvironment {
    /// 壳唯一的持久化面（Keychain）。
    let store: KeyValueStore
    /// 主机仓库（凭证在 Keychain 里）。
    let registry: HostRegistry
    /// 非凭证偏好（生物锁开关、更新提醒开关）。
    let preferences: ShellPreferences
    /// 壳侧 HTTP 客户端。
    let httpClient: LaneHttpClient
    /// lane 控制面客户端。
    let pairingClient: LanePairingClient
    /// 配对服务（链接 → 凭证 → 主机条目）。
    let pairingService: PairingService
    /// 引导载荷的来源。
    let payloadProvider: BootPayloadProvider
    /// 引导载荷的存放处。
    let payloadStore: BootPayloadStore
    /// 壳内自带的 upstream dist。
    let assets: DistAssetHandler
    /// 页面请求转发器。
    let forwarder: LaneRequestForwarder
    /// 连接器（候选地址重试 + 失效降级链）。
    let connector: HostConnector
    /// 主机探测（往返延迟）。
    let probe: HostProbe
    /// 生物锁状态机。
    let lock: LockController
    /// 生物识别验证的门。
    let gate: BiometricGate
    /// mDNS 发现。
    let discovery: LaneDiscovery
    /// 更新提醒（跳转形态）。
    let updateNotice: UpdateNotice

    init() {
        let store = KeychainStore()
        self.store = store
        let registry = SecureHostRegistry(store: store)
        self.registry = registry
        let preferences = ShellPreferences(store: store)
        self.preferences = preferences
        let client = LaneHttpClient()
        self.httpClient = client
        let pairing = LanePairingClient(client: client)
        self.pairingClient = pairing
        pairingService = PairingService(registry: registry, pairing: pairing)
        payloadProvider = BootPayloadProvider(client: client)
        payloadStore = BootPayloadStore()
        assets = DistAssetHandler()
        forwarder = LaneRequestForwarder(client: client)
        connector = HostConnector(
            registry: registry,
            payloadProvider: payloadProvider,
            pairing: pairing
        )
        probe = HostProbe(client: client)
        lock = LockController(preferences: preferences)
        gate = BiometricGate()
        discovery = LaneDiscovery()
        updateNotice = UpdateNotice(preferences: preferences)
        ShellLog.info(
            "壳已启动：主机 \(registry.list().count) 台，当前 \(registry.current()?.displayName ?? "无")"
        )
    }
}
