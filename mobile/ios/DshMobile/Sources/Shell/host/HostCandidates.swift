import Foundation

/// 地址候选的排序策略（平台相关）。
///
/// spec #55「地址形态与发现」的落地：配对链接给出的候选是 `<主机名>.local` + 多网卡 IPv4 并存，
/// 壳**按平台择优**：
/// - iOS 出站用 `.local`——iOS 17 起 ATS 不再默认放行裸 IP，而 `.local` 是系统 mDNS 自带的
///   名字，一条 `NSAllowsLocalNetworking` 就能覆盖（不逐条列 IP）；
/// - Android / 鸿蒙出站用 IP（各一条明文豁免）。
///
/// 本壳只做 iOS 这一侧：`.local` 候选排前面，其余保持链接给出的顺序。
enum HostCandidates {
    /// 按 iOS 的择优顺序排候选：`.local` 优先，其余保持原序。
    static func orderedForPlatform(_ candidates: [String]) -> [String] {
        let trimmed = candidates
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var seen = Set<String>()
        let unique = trimmed.filter { seen.insert($0).inserted }
        let local = unique.filter { isLocalHostname($0) }
        let rest = unique.filter { !isLocalHostname($0) }
        return local + rest
    }

    /// 判断一个候选是不是 `.local` 主机名（mDNS 形态）。
    static func isLocalHostname(_ origin: String) -> Bool {
        let host = OriginAddress.host(of: origin)
        return host.hasSuffix(".local")
    }
}
