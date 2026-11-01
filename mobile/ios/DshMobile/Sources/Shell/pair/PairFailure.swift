import Foundation

/// 配对失败的分类。
///
/// 分开的理由：失败文案必须区分「链接过期」与「设备被移除」——两者的补救动作不同
/// （前者去桌面端重新取链接，后者要桌面端重新允许这台设备）。
enum PairFailure: Equatable {
    /// 链接里的令牌无效 / 已过期 / 已被用过（一次性令牌）。
    case invalidToken
    /// 桌面端把这台设备移除了（续期时 deviceId 查无此设备）。
    case deviceRemoved
    /// 服务端没有下发会话 cookie（不该发生，视为失败）。
    case noSession
    /// 主机地址不可达。
    case unreachable
    /// 其它 HTTP 状态。
    case unexpected
    /// 链接格式无法识别。
    case malformed

    /// 失败标题（配对屏与提示条共用）。
    var title: String {
        switch self {
        case .invalidToken: return "链接无效或已过期"
        case .deviceRemoved: return "此设备已被移除"
        case .noSession: return "会话未建立"
        case .unreachable: return "目标不可达，请检查地址或网络"
        case .unexpected: return "配对未完成"
        case .malformed: return "无法识别该链接"
        }
    }

    /// 失败详情：写清下一步该做什么。
    var detail: String {
        switch self {
        case .invalidToken:
            return "配对链接 10 分钟有效、一次性。请回到桌面端重新获取二维码或链接。"
        case .deviceRemoved:
            return "桌面端已移除这台设备。请在桌面端重新配对后再试。"
        case .noSession:
            return "桌面端没有下发会话凭证。请在桌面端重新签发配对链接。"
        case .unreachable:
            return "配对链接里的地址连不上。确认桌面端已开机、这台设备与桌面在同一网络（公网主机请用隧道地址），再重新粘贴链接。"
        case .unexpected:
            return "桌面端返回了意料之外的响应。请稍后重试。"
        case .malformed:
            return "这不是桌面端签发的配对链接。请复制完整的配对链接（含 token 参数）。"
        }
    }
}
