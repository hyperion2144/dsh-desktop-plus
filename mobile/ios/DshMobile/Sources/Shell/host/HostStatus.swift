import Foundation

/// 主机状态（管理页的状态点与原因文案）。
///
/// 状态**持久化**：App 被杀后重进管理页，仍要看得见「这台主机需要重新配对」，
/// 而不是重新探测一次才显示。
enum HostStatus: String, Codable, CaseIterable {
    /// 还没连过（刚配对但尚未加载页面）。
    case unknown
    /// 已连接。
    case connected
    /// 连不上（地址不可达 / 主机没开机）。
    case offline
    /// 门禁拒绝且降级链全败：需要重新配对。
    case needsRepair = "needs-repair"

    /// 由存储里的代码还原；不认识的一律按 unknown 处理。
    static func fromCode(_ code: String?) -> HostStatus {
        guard let code, let status = HostStatus(rawValue: code) else { return .unknown }
        return status
    }
}
