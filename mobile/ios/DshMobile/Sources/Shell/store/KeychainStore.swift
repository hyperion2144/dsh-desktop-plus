import Foundation
import Security

/// Keychain 承载的键值存储（壳唯一的持久化面）。
///
/// ## 边界（spec #55「凭证与安全」）
///
/// 主机条目里的**会话 cookie、deviceId、配对令牌**只存在这里：
/// - 落盘的是密文，密钥材料由 Secure Enclave / Keychain 保护，不出设备；
/// - `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`：设备重启后首次解锁即可用，
///   且条目不随备份迁移到别的设备。
///
/// cookie **不进 WKWebView 的 cookie jar**：WebView 的 cookie 是明文落盘的，
/// 且页面同源策略一旦出漏洞就能读到它。壳的做法是：cookie 只在 Keychain 里，
/// 出站时由壳解密附加（转发器 / 原生请求桥）。
///
/// Keychain 条目在 App 被删除后仍会保留（iOS 平台行为）：重新安装时壳会读回上次的
/// 主机条目；凭证本身仍然有效（桌面端的设备会话是持久化的）。
final class KeychainStore: KeyValueStore {
    /// Keychain 服务名（同一 App 的所有条目共用一个 service，用 account 区分键）。
    private let service: String

    /// Keychain 不可用时（罕见：设备策略禁用、条目损坏）落回内存存储，凭证不持久。
    private var fallback: [String: String] = [:]

    /// 是否已经退到内存存储（只报一次，不刷屏）。
    private var degraded = false

    init(service: String = "com.plus.mobile.dsh.shell") {
        self.service = service
    }

    func string(forKey key: String) -> String? {
        var query = baseQuery(forKey: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return nil }
            return String(data: data, encoding: .utf8)
        case errSecItemNotFound:
            return fallback[key]
        default:
            degrade(status)
            return fallback[key]
        }
    }

    func setString(_ value: String?, forKey key: String) {
        guard let value, let data = value.data(using: .utf8) else {
            removeItem(forKey: key)
            return
        }
        let query = baseQuery(forKey: key)
        let attributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(insert as CFDictionary, nil)
            if addStatus == errSecSuccess { return }
            degrade(addStatus)
        } else {
            degrade(updateStatus)
        }
        fallback[key] = value
    }

    func bool(forKey key: String, default fallback: Bool) -> Bool {
        guard let raw = string(forKey: key) else { return fallback }
        switch raw {
        case "1", "true": return true
        case "0", "false": return false
        default: return fallback
        }
    }

    func setBool(_ value: Bool, forKey key: String) {
        setString(value ? "1" : "0", forKey: key)
    }

    private func baseQuery(forKey key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    private func removeItem(forKey key: String) {
        let status = SecItemDelete(baseQuery(forKey: key) as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            degrade(status)
        }
        fallback.removeValue(forKey: key)
    }

    /// Keychain 不可用：记一次日志，之后这条路径退到内存存储（凭证不持久，但 App 不崩）。
    private func degrade(_ status: OSStatus) {
        guard !degraded else { return }
        degraded = true
        ShellLog.error("Keychain 不可用（OSStatus \(status)），退到内存存储：凭证不会持久化")
    }
}
