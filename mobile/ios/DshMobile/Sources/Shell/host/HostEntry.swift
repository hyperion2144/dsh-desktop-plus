import Foundation

/// 一台桌面主机。
///
/// 字段与 spec #55「多主机凭证模型」对齐：
/// - `laneOrigin`：当前生效的地址（origin）；
/// - `form`：地址形态（lan / mdns / tunnel / direct）；
/// - `candidates`：地址候选列表（配对链接里的 base 列表），换网络时按序重试；
/// - `deviceId`：设备 ID，降级链用它静默续期；
/// - `sessionCookie`：lane 的会话 cookie（HttpOnly）——**只存在壳内**，由壳在转发请求时附加，
///   永不下发给页面（spec #55「凭证与安全」第 17 条：页面 JS 永远拿不到凭证）；
/// - `pairToken`：配对链接里的一次性令牌，只在首次配对与降级链兜底时用。
struct HostEntry: Identifiable, Equatable {
    /// 主机 id：默认取 origin。
    let id: String
    /// 显示名。
    var label: String
    /// 当前生效的 origin。
    var laneOrigin: String
    /// 会话 cookie（凭证）。
    var sessionCookie: String?
    /// 地址形态。
    var form: HostForm
    /// 地址候选列表（按优先级）。
    var candidates: [String]
    /// 设备 ID：静默续期的凭据。
    var deviceId: String?
    /// 配对链接里的一次性令牌（降级链兜底用）。
    var pairToken: String?
    /// 状态（管理页状态点）。
    var status: HostStatus
    /// 状态原因文案（需重配时写清为什么）。
    var statusReason: String?
    /// 隧道地址的可达性探测结论（nil = 未探测 / 不适用）。
    var tunnelReachable: Bool?
    /// 最近一次探测到的往返延迟（毫秒）。
    var latencyMs: Int?
    /// 配对时间戳（毫秒）。
    var pairedAt: Double

    init(
        id: String,
        label: String,
        laneOrigin: String,
        sessionCookie: String? = nil,
        form: HostForm = .lan,
        candidates: [String] = [],
        deviceId: String? = nil,
        pairToken: String? = nil,
        status: HostStatus = .unknown,
        statusReason: String? = nil,
        tunnelReachable: Bool? = nil,
        latencyMs: Int? = nil,
        pairedAt: Double = 0
    ) {
        self.id = id
        self.label = label
        self.laneOrigin = laneOrigin
        self.sessionCookie = sessionCookie
        self.form = form
        self.candidates = candidates
        self.deviceId = deviceId
        self.pairToken = pairToken
        self.status = status
        self.statusReason = statusReason
        self.tunnelReachable = tunnelReachable
        self.latencyMs = latencyMs
        self.pairedAt = pairedAt
    }

    /// 供页面与日志使用的展示名（无标签时退回 origin）。
    var displayName: String { label.isEmpty ? laneOrigin : label }

    /// 展示用地址（去掉协议头，与原型一致）。
    var displayOrigin: String {
        laneOrigin
            .replacingOccurrences(of: "http://", with: "")
            .replacingOccurrences(of: "https://", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
