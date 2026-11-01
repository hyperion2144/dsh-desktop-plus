import Foundation
import Network

/// 发现到的一台桌面（mDNS 广播记录）。
///
/// 广播记录**不携带授权**：发现只回答「桌面在哪儿、端口多少」，
/// 授权永远由桌面签发的一次性限时链接完成。
struct DiscoveredService: Identifiable, Equatable {
    /// 广播的实例名（`DSH Desktop Plus - <主机名>`）。
    let name: String
    /// 目标主机名（SRV 目标，形如 `<主机名>.local`）。
    let host: String
    /// lane 端口。
    let port: Int
    /// 配对入口路径。
    let path: String

    /// 展示用地址。
    var displayAddress: String { "\(host):\(port)" }

    /// 稳定 id（同一台桌面重复广播时是同一个）。
    var id: String { "\(host):\(port)" }
}

/// mDNS 发现：扫描局域网里的 `_dsh-lane._tcp` 广播。
///
/// 桌面侧广播的契约见 `packages/plus/desktop-remote-access/lib/mdns.mjs`：
/// 服务类型 `_dsh-lane._tcp.local`，TXT 记录里是 `host` / `port` / `path`。
///
/// iOS 侧用 `NWBrowser` 的 bonjour 浏览：需要在 Info.plist 声明 `NSBonjourServices`
/// （iOS 14+ 首次浏览会弹本地网络授权）。
final class LaneDiscovery {
    /// 服务类型（不含 `.local` 域）。
    static let serviceType = "_dsh-lane._tcp"

    private var browser: NWBrowser?
    private let queue = DispatchQueue(label: "com.plus.mobile.dsh.discovery")
    private let lock = NSLock()
    private var stored: [DiscoveredService] = []
    /// 发现结果变化的回调（主线程）。
    var onChange: (([DiscoveredService]) -> Void)?

    /// 当前发现到的桌面。
    var services: [DiscoveredService] {
        lock.lock()
        defer { lock.unlock() }
        return stored
    }

    /// 开始扫描。
    func start() {
        guard browser == nil else { return }
        let parameters = NWParameters()
        parameters.includePeerToPeer = true
        let browser = NWBrowser(
            for: .bonjour(type: Self.serviceType, domain: "local."),
            using: parameters
        )
        self.browser = browser
        browser.stateUpdateHandler = { state in
            switch state {
            case .failed(let error):
                ShellLog.warn("mDNS 浏览失败：\(error.localizedDescription)")
            case .ready:
                ShellLog.info("mDNS 发现已启动：\(Self.serviceType)")
            default:
                break
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            self?.apply(results)
        }
        browser.start(queue: queue)
    }

    /// 停止扫描。
    func stop() {
        browser?.cancel()
        browser = nil
        lock.lock()
        stored = []
        lock.unlock()
    }

    private func apply(_ results: Set<NWBrowser.Result>) {
        var found: [DiscoveredService] = []
        for result in results {
            guard let service = Self.parse(result) else { continue }
            found.append(service)
        }
        found.sort { $0.id < $1.id }
        lock.lock()
        stored = found
        lock.unlock()
        DispatchQueue.main.async { [weak self] in
            self?.onChange?(found)
        }
    }

    /// 从一条浏览结果里取出服务名与 TXT 记录。
    private static func parse(_ result: NWBrowser.Result) -> DiscoveredService? {
        guard case let .bonjour(txt) = result.metadata else { return nil }
        let host = txt["host"] ?? ""
        let port = txt["port"].flatMap(Int.init) ?? 0
        let path = txt["path"] ?? "/pair"
        guard !host.isEmpty, port > 0 else { return nil }
        var name = host
        if case let .service(serviceName, _, _, _) = result.endpoint {
            name = serviceName
        }
        return DiscoveredService(name: name, host: host, port: port, path: path)
    }
}
