import Foundation
import Darwin

// 壳的数据面自检（票 #64）。
//
// 为什么需要它：这台机器上**没有安装任何 iOS 模拟器运行时**
// （`/Library/Developer/CoreSimulator/Profiles/Runtimes` 为空，CoreSimulator 报
// "Simulator device support disabled"），所以「模拟器安装启动 → 连真实 lane」这条
// 验证路径在本机跑不起来。本自检把**壳的原生数据面**（HTTP 客户端 / 引导载荷 /
// 直连令牌 / 降级链 / Keychain / 配对链接解析）在 macOS 上直接跑起来：
//
// - 编译的是**壳的真实源码**（DshMobile/Sources/Shell/**），不是复制品；
// - 假 lane 由 tools/mock-lane.py 起（同一份 lane 契约）；
// - 真实 lane 用本机 3093（若在跑）。
//
// 覆盖不到的：WKWebView 渲染、SwiftUI 界面、相机扫码、Face ID、.local 真机出站、
// 侧载安装——这些只能等有模拟器运行时 / 真机的环境。

// MARK: - 断言

var failures: [String] = []
var passes = 0

func check(_ name: String, _ condition: Bool, _ detail: String = "") {
    if condition {
        passes += 1
        print("PASS  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    } else {
        failures.append(name)
        print("FAIL  \(name)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}

func section(_ title: String) {
    print("")
    print("── \(title)")
}

// MARK: - 运行环境

let environment = CommandLine.arguments
guard environment.count >= 3 else {
    print("用法：selftest <mock lane 端口> [真实 lane 端口]")
    exit(2)
}
guard let mockPort = UInt16(environment[1]) else {
    print("mock lane 端口不是数字")
    exit(2)
}
let realPort = environment.count >= 3 ? (UInt16(environment[2]) ?? 0) : 0
let mockOrigin = "http://127.0.0.1:\(mockPort)"
let realOrigin = realPort > 0 ? "http://127.0.0.1:\(realPort)" : ""

print("DSH iOS 壳数据面自检")
print("假 lane：\(mockOrigin)")
print("真实 lane：\(realOrigin.isEmpty ? "（未启用）" : realOrigin)")

// MARK: - 内存主机仓库（自检用替身：不碰用户钥匙串）

final class MemoryRegistry: HostRegistry {
    private var hosts: [String: HostEntry] = [:]
    private var order: [String] = []
    private var currentId: String?

    func list() -> [HostEntry] { order.compactMap { hosts[$0] } }
    func current() -> HostEntry? {
        if let currentId, let host = hosts[currentId] { return host }
        return order.first.flatMap { hosts[$0] }
    }
    func find(id: String) -> HostEntry? { hosts[id] }
    func setCurrent(id: String) { if hosts[id] != nil { currentId = id } }
    func upsert(_ host: HostEntry) {
        if hosts[host.id] == nil { order.append(host.id) }
        hosts[host.id] = host
        if currentId == nil { currentId = host.id }
    }
    func remove(id: String) {
        hosts.removeValue(forKey: id)
        order.removeAll { $0 == id }
        if currentId == id { currentId = order.first }
    }
    func markStatus(id: String, status: HostStatus, reason: String?) {
        guard var host = hosts[id] else { return }
        host.status = status
        host.statusReason = reason
        hosts[id] = host
    }
    func markLatency(id: String, latencyMs: Int?) {
        guard var host = hosts[id] else { return }
        host.latencyMs = latencyMs
        hosts[id] = host
    }
}

/// 内存键值存储（自检用替身：不碰用户钥匙串）。
final class MemoryKeyValueStore: KeyValueStore {
    private var values: [String: String] = [:]

    func string(forKey key: String) -> String? { values[key] }

    func setString(_ value: String?, forKey key: String) {
        if let value {
            values[key] = value
        } else {
            values.removeValue(forKey: key)
        }
    }

    func bool(forKey key: String, default fallback: Bool) -> Bool {
        guard let raw = values[key] else { return fallback }
        return raw == "true"
    }

    func setBool(_ value: Bool, forKey key: String) {
        values[key] = value ? "true" : "false"
    }
}

/// 记录 accept 调用次数的配对客户端（自检用替身）。
///
/// 契约（code-review P6）：**配对前先探测，不把凭证发给不可达目标**——
/// 所以「目标不可达」时 accept 一次都不该被调用。
final class SpyPairingClient: LanePairingClient {
    /// accept 被调用的次数。
    private(set) var acceptCalls = 0
    /// accept 被调用时收到的令牌（用来核对凭证有没有外流）。
    private(set) var acceptedTokens: [String] = []

    init() {
        super.init(client: LaneHttpClient())
    }

    override func accept(
        origin: String,
        token: String,
        deviceName: String
    ) async -> LanePairingClient.AcceptOutcome {
        acceptCalls += 1
        acceptedTokens.append(token)
        return .unreachable("不应被调用")
    }
}

/// 找一个当前没人监听的本地端口（先占再放）。
func closedLocalPort() -> UInt16 {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    guard descriptor >= 0 else { return 1 }
    defer { close(descriptor) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr = in_addr(s_addr: INADDR_ANY)
    let bound = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bound == 0 else { return 1 }
    var actual = sockaddr_in()
    var length = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &actual) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getsockname(descriptor, $0, &length)
        }
    }
    return UInt16(bigEndian: actual.sin_port)
}

// MARK: - 用例

section("引导载荷（注入行 + 传输配置）")

let http = LaneHttpClient()
let payloadProvider = BootPayloadProvider(client: http)

do {
    let host = HostEntry(
        id: "mock",
        label: "假桌面",
        laneOrigin: mockOrigin,
        sessionCookie: "dsh_mobile_session=mock-session-token"
    )
    let payload = try await payloadProvider.load(
        host: host,
        socketBaseUrl: "ws://127.0.0.1:\(mockPort)/__dsh_ws/mock-ws-token/"
    )
    let json = payload.toJson()
    let parsed = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
    let transport = parsed?["transport"] as? [String: Any]
    let rows = parsed?["rows"] as? [[String: Any]] ?? []
    check("引导载荷：注入行至少三行（facade / 启动图 / bootstrap）", rows.count >= 3, "rows=\(rows.count)")
    check("引导载荷：ownsHost=true", transport?["ownsHost"] as? Bool == true)
    check(
        "引导载荷：streamBaseUrl 指向直连 lane 的 WS base（带令牌段与末尾斜杠）",
        transport?["streamBaseUrl"] as? String == "ws://127.0.0.1:\(mockPort)/__dsh_ws/mock-ws-token/",
        transport?["streamBaseUrl"] as? String ?? "(缺)"
    )
    check(
        "引导载荷：pageOrigin 是自定义 scheme（等价特权 origin）",
        transport?["pageOrigin"] as? String == "dsh-shell://app.dsh.local",
        transport?["pageOrigin"] as? String ?? "(缺)"
    )
    check(
        "引导载荷：注入行含模块加载 facade",
        rows.contains { (($0["text"] as? String) ?? "").contains("__ModuleLoader__") }
    )
    check(
        "引导载荷：注入行含启动图",
        rows.contains { (($0["text"] as? String) ?? "").contains("__DSH_BOOT__") }
    )
} catch {
    check("引导载荷：装载", false, error.localizedDescription)
}

section("配对门禁（未配对 → 401 unpaired）")

do {
    let host = HostEntry(id: "gated", label: "未配对桌面", laneOrigin: mockOrigin)
    _ = try await payloadProvider.load(
        host: host,
        socketBaseUrl: "ws://127.0.0.1:\(mockPort)/__dsh_ws/mock-ws-token/"
    )
    check("门禁：无凭证时应当被拒", false, "竟然装载成功")
} catch let error as BootPayloadError {
    if case .gated = error {
        check("门禁：无凭证时判定为 gated", true)
    } else {
        check("门禁：无凭证时判定为 gated", false, error.localizedDescription)
    }
} catch {
    check("门禁：无凭证时判定为 gated", false, error.localizedDescription)
}

section("lane 控制面（accept / renew / ws-token）")

let pairing = LanePairingClient(client: http)

switch await pairing.accept(origin: mockOrigin, token: "mock-token", deviceName: "自检") {
case .accepted(let deviceId, let cookie):
    check("控制面：accept 换到设备 ID + 会话 cookie", deviceId == "mock-device" && cookie.hasPrefix("dsh_mobile_session="))
default:
    check("控制面：accept 换到设备 ID + 会话 cookie", false)
}

switch await pairing.accept(origin: mockOrigin, token: "bad-token", deviceName: "自检") {
case .rejected(let failure):
    check("控制面：无效令牌 → invalidToken", failure == .invalidToken, failure.title)
default:
    check("控制面：无效令牌 → invalidToken", false)
}

switch await pairing.renew(origin: mockOrigin, deviceId: "mock-device") {
case .renewed(let cookie):
    check("控制面：续期取回新会话 cookie", cookie.hasPrefix("dsh_mobile_session="))
default:
    check("控制面：续期取回新会话 cookie", false)
}

switch await pairing.renew(origin: mockOrigin, deviceId: "unknown-device") {
case .rejected(let failure):
    check("控制面：未知设备 → deviceRemoved", failure == .deviceRemoved, failure.title)
default:
    check("控制面：未知设备 → deviceRemoved", false)
}

switch await pairing.wsToken(origin: mockOrigin, cookie: "dsh_mobile_session=mock-session-token") {
case .issued(let token):
    check("控制面：会话 cookie 换到直连令牌", token == "mock-ws-token", token)
default:
    check("控制面：会话 cookie 换到直连令牌", false)
}
switch await pairing.wsToken(origin: mockOrigin, cookie: nil) {
case .gated:
    check("控制面：未配对时拿不到直连令牌（门禁）", true)
default:
    check("控制面：未配对时拿不到直连令牌（门禁）", false)
}

section("降级链（unpaired → renew → accept → 连上）")

do {
    let registry = MemoryRegistry()
    let connector = HostConnector(
        registry: registry,
        payloadProvider: payloadProvider,
        pairing: pairing
    )
    let host = HostEntry(
        id: "degraded",
        label: "降级链桌面",
        laneOrigin: mockOrigin,
        deviceId: "mock-device",
        pairToken: "mock-token"
    )
    registry.upsert(host)
    switch await connector.connect(host) {
    case .connected(let updated, let payload):
        check(
            "降级链：静默续期后连上",
            updated.sessionCookie?.hasPrefix("dsh_mobile_session=") == true,
            updated.sessionCookie ?? "(无 cookie)"
        )
        // 数据面直连 lane：WS base 带令牌段，末尾斜杠不能少。
        let payloadJson = (try? JSONSerialization.jsonObject(with: Data(payload.toJson().utf8))) as? [String: Any]
        let transport = payloadJson?["transport"] as? [String: Any]
        let streamBase = transport?["streamBaseUrl"] as? String ?? ""
        check(
            "降级链：WS base 直连 lane（令牌段 + 末尾斜杠）",
            streamBase == "ws://127.0.0.1:\(mockPort)/__dsh_ws/mock-ws-token/",
            streamBase
        )
    case .needsRepair(_, let reason):
        check("降级链：静默续期后连上", false, reason)
    case .offline(_, let reason):
        check("降级链：静默续期后连上", false, reason)
    }
}

do {
    let registry = MemoryRegistry()
    let connector = HostConnector(
        registry: registry,
        payloadProvider: payloadProvider,
        pairing: pairing
    )
    let host = HostEntry(
        id: "hopeless",
        label: "失效桌面",
        laneOrigin: mockOrigin,
        deviceId: "unknown-device",
        pairToken: "bad-token"
    )
    registry.upsert(host)
    switch await connector.connect(host) {
    case .needsRepair(_, let reason):
        check("降级链：续期与接受都失败 → 需重新配对", reason.contains("重新配对"), reason)
    case .connected:
        check("降级链：续期与接受都失败 → 需重新配对", false, "竟然连上了")
    case .offline(_, let reason):
        check("降级链：续期与接受都失败 → 需重新配对", false, reason)
    }
}

if !realOrigin.isEmpty {
    section("真实 lane（\(realOrigin)）")

    do {
        let realHost = HostEntry(id: "real", label: "真实桌面", laneOrigin: realOrigin)
        _ = try await payloadProvider.load(
            host: realHost,
            socketBaseUrl: "ws://127.0.0.1:\(realPort)/__dsh_ws/real-token/"
        )
        check("真实 lane：未配对时判定为 gated", false, "竟然装载成功")
    } catch let error as BootPayloadError {
        if case .gated = error {
            check("真实 lane：未配对时判定为 gated", true)
        } else {
            check("真实 lane：未配对时判定为 gated", false, error.localizedDescription)
        }
    } catch {
        check("真实 lane：未配对时判定为 gated", false, error.localizedDescription)
    }

    switch await pairing.renew(origin: realOrigin, deviceId: "not-a-real-device") {
    case .rejected(let failure):
        check("真实 lane：续期未知设备 → deviceRemoved", failure == .deviceRemoved, failure.title)
    default:
        check("真实 lane：续期未知设备 → deviceRemoved", false)
    }
}

section("Keychain（凭证落盘面）")

do {
    let store = KeychainStore(service: "com.plus.mobile.dsh.selftest")
    store.setString("dsh_mobile_session=selftest-value", forKey: "hosts.entries")
    check("Keychain：写入后可读回", store.string(forKey: "hosts.entries") == "dsh_mobile_session=selftest-value")
    let probe = KeychainStore(service: "com.plus.mobile.dsh.selftest")
    let persisted = probe.string(forKey: "hosts.entries") != nil
    let persistedText = persisted ? "是" : "否——本机钥匙串不可用时退到内存存储"
    print("      （Keychain 持久化：\(persistedText)）")
    store.setString(nil, forKey: "hosts.entries")
    check("Keychain：删除后读不到", store.string(forKey: "hosts.entries") == nil)
}

section("配对链接解析")

if let link = PairLink.parse("dsh-mobile://pair?token=abc123&base=desk.local:3093,192.168.1.5:3093") {
    check("配对链接：移动端形态解析出令牌", link.token == "abc123")
    check(
        "配对链接：.local 候选排在前面（iOS 出站择优）",
        link.candidates.first?.hasSuffix(".local:3093") == true,
        link.candidates.joined(separator: " / ")
    )
} else {
    check("配对链接：移动端形态解析出令牌", false)
}

if let link = PairLink.parse("http://192.168.1.5:3093/pair?token=xyz") {
    check("配对链接：http 形态解析出令牌与 origin", link.token == "xyz" && link.origin == "http://192.168.1.5:3093")
} else {
    check("配对链接：http 形态解析出令牌与 origin", false)
}

check("配对链接：缺令牌 → nil", PairLink.parse("dsh-mobile://pair?base=desk.local:3093") == nil)
check("配对链接：非链接 → nil", PairLink.parse("随便一段文字") == nil)

section("壳的偏好（更新提醒总开关默认开）")
do {
    let store = MemoryKeyValueStore()
    let preferences = ShellPreferences(store: store)
    check("偏好：更新提醒总开关默认开", preferences.updateReminderEnabled)
    check("偏好：生物锁默认开", preferences.biometricLockEnabled)
    // 已存过的关闭值不被默认值覆盖。
    preferences.updateReminderEnabled = false
    check(
        "偏好：已存过的关闭值不被默认值覆盖",
        !ShellPreferences(store: store).updateReminderEnabled
    )
}

section("配对前的无凭证可达性预检（不可达 → 不发 accept）")
do {
    let port = closedLocalPort()
    let spy = SpyPairingClient()
    let service = PairingService(
        registry: MemoryRegistry(),
        pairing: spy,
        prober: ReachabilityProbe(timeout: 1)
    )
    guard let link = PairLink.parse("http://127.0.0.1:\(port)/pair?token=secret-token") else {
        check("预检：链接能解析", false)
        exit(1)
    }
    let outcome = await service.pair(link: link)
    check("预检：目标不可达 → 不发 accept", spy.acceptCalls == 0, "accept 调用 \(spy.acceptCalls) 次")
    check("预检：目标不可达 → 令牌不外流", spy.acceptedTokens.isEmpty)
    if case .failed(let failure) = outcome {
        check("预检：目标不可达 → 报不可达", failure == .unreachable, failure.title)
    } else {
        check("预检：目标不可达 → 报不可达", false)
    }
}

do {
    // 假 lane 在监听：TCP 连得上 → 预检通过 → 走原 accept 流程。
    let spy = SpyPairingClient()
    let service = PairingService(
        registry: MemoryRegistry(),
        pairing: spy,
        prober: ReachabilityProbe(timeout: 1)
    )
    guard let link = PairLink.parse("http://127.0.0.1:\(mockPort)/pair?token=t") else {
        check("预检：可达的链接能解析", false)
        exit(1)
    }
    _ = await service.pair(link: link)
    check("预检：目标可达 → 走 accept", spy.acceptCalls == 1, "accept 调用 \(spy.acceptCalls) 次")
}

// MARK: - 结论

print("")
print("通过 \(passes) 项，失败 \(failures.count) 项")
if !failures.isEmpty {
    for name in failures { print("  失败：\(name)") }
    exit(1)
}
exit(0)
