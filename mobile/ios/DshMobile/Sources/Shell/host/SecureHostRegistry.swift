import Foundation

/// 主机仓库的 Keychain 实现。
///
/// ## 为什么是这一层
///
/// 主机条目里有**凭证**（会话 cookie、deviceId、配对令牌）。它们必须满足两条：
/// 1. **不落明文**：落在 Keychain 里（见 store/KeychainStore）；
/// 2. **不到页面**：页面拿不到 cookie，只能通过壳桥拿到主机名与 origin。
///
/// 整表用一个键存：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
///
/// 线程安全：UI 线程与 WebView 的 JS 桥线程都可能读写。
final class SecureHostRegistry: HostRegistry {
    private let store: KeyValueStore
    private let lock = NSLock()
    private var hosts: [String: HostEntry] = [:]
    private var order: [String] = []
    private var currentId: String?

    init(store: KeyValueStore) {
        self.store = store
        restore()
    }

    func list() -> [HostEntry] {
        lock.lock()
        defer { lock.unlock() }
        return order.compactMap { hosts[$0] }
    }

    func current() -> HostEntry? {
        lock.lock()
        defer { lock.unlock() }
        if let currentId, let host = hosts[currentId] { return host }
        return order.first.flatMap { hosts[$0] }
    }

    func find(id: String) -> HostEntry? {
        lock.lock()
        defer { lock.unlock() }
        return hosts[id]
    }

    func setCurrent(id: String) {
        lock.lock()
        defer { lock.unlock() }
        guard hosts[id] != nil else { return }
        currentId = id
        persist()
    }

    func upsert(_ host: HostEntry) {
        lock.lock()
        defer { lock.unlock() }
        if hosts[host.id] == nil { order.append(host.id) }
        hosts[host.id] = host
        if currentId == nil { currentId = host.id }
        persist()
    }

    func remove(id: String) {
        lock.lock()
        defer { lock.unlock() }
        hosts.removeValue(forKey: id)
        order.removeAll { $0 == id }
        if currentId == id { currentId = order.first }
        persist()
    }

    func markStatus(id: String, status: HostStatus, reason: String?) {
        lock.lock()
        defer { lock.unlock() }
        guard var host = hosts[id] else { return }
        host.status = status
        host.statusReason = reason
        hosts[id] = host
        persist()
    }

    func markLatency(id: String, latencyMs: Int?) {
        lock.lock()
        defer { lock.unlock() }
        guard var host = hosts[id] else { return }
        host.latencyMs = latencyMs
        hosts[id] = host
        persist()
    }

    /// 从存储恢复（进程重启后主机列表与凭证都在）。
    private func restore() {
        let records = HostRecordCodec.decode(store.string(forKey: Key.hosts) ?? "")
        for record in records {
            hosts[record.id] = record.entry
            order.append(record.id)
        }
        // 一次性令牌只在配对那一次有效：老版本曾把它持久化，恢复时统一清掉，
        // 避免降级链拿已消费的令牌去 accept 而被推回重新配对。
        var tokenChanged = false
        for id in hosts.keys {
            if hosts[id]?.pairToken?.isEmpty == false {
                hosts[id]?.pairToken = nil
                tokenChanged = true
            }
        }
        if tokenChanged {
            persist()
        }
        let stored = store.string(forKey: Key.current)
        currentId = stored.flatMap { hosts[$0] != nil ? $0 : nil } ?? order.first
    }

    /// 写回存储。调用方必须已持有锁。
    private func persist() {
        let records = order.compactMap { hosts[$0] }.map(HostRecord.init(entry:))
        store.setString(HostRecordCodec.encode(records), forKey: Key.hosts)
        store.setString(currentId, forKey: Key.current)
    }

    private enum Key {
        static let hosts = "hosts.entries"
        static let current = "hosts.current"
    }
}
