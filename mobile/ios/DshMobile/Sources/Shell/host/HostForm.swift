import Foundation

/// 主机形态（spec #55「地址形态与发现」）。
///
/// 形态决定两件事：徽标怎么画（管理页）、以及地址怎么分类（配对时的候选排序）。
enum HostForm: String, Codable, CaseIterable {
    /// 局域网 IP 直连。
    case lan
    /// mDNS 主机名（`<主机名>.local`）。
    case mdns
    /// 第三方隧道（公网 https）。
    case tunnel
    /// 直连 dsh 地址（不经 lane）。
    case direct

    /// 徽标上显示的形态代码。
    var code: String { rawValue }

    /// 形态的中文标签（管理页 tooltip / 无障碍标签）。
    var label: String {
        switch self {
        case .lan: return "局域网"
        case .mdns: return "mDNS"
        case .tunnel: return "隧道"
        case .direct: return "直连"
        }
    }

    /// 由存储里的代码还原；不认识的一律按 LAN 处理。
    static func fromCode(_ code: String?) -> HostForm {
        guard let code, let form = HostForm(rawValue: code) else { return .lan }
        return form
    }

    /// 按地址猜形态：
    /// - `.local` 结尾 → mDNS；
    /// - 公网 https → 隧道；
    /// - `direct://` → 直连；
    /// - 其余 → 局域网。
    static func of(origin: String) -> HostForm {
        let text = origin.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let host = OriginAddress.host(of: text)
        if host.hasSuffix(".local") { return .mdns }
        if text.hasPrefix("direct://") { return .direct }
        if text.hasPrefix("https://") && !isPrivateHost(host) { return .tunnel }
        return .lan
    }

    /// RFC1918 / 回环：这些地址不可能是公网隧道。
    private static func isPrivateHost(_ host: String) -> Bool {
        if host == "localhost" || host == "::1" { return true }
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return false }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == 4 else { return false }
        switch numbers[0] {
        case 10: return true
        case 192 where numbers[1] == 168: return true
        case 172 where (16...31).contains(numbers[1]): return true
        default: return false
        }
    }
}
