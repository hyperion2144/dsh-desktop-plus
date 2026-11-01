import Foundation

/// 主机条目在持久化里的形状。
///
/// 与运行期的 `HostEntry` 分开，是为了让「哪些字段会落盘、哪些字段是凭证」在类型上就一目了然：
/// `cookie` / `deviceId` / `pairToken` 三项是凭证，其余是展示与路由信息。
struct HostRecord: Codable, Equatable {
    /// 主机 id。
    let id: String
    /// 显示名。
    var label: String
    /// 当前生效的 origin。
    var origin: String
    /// 形态代码（lan / mdns / tunnel / direct）。
    var form: String
    /// 地址候选列表（配对链接里的 base 列表）。
    var candidates: [String]
    /// 设备 ID：静默续期的凭据。
    var deviceId: String?
    /// 会话 cookie（HttpOnly）：出站时由壳解密附加。
    var cookie: String?
    /// 配对链接里的一次性令牌：首次配对 / 降级链兜底用。
    var pairToken: String?
    /// 状态代码（unknown / connected / offline / needs-repair）。
    var status: String
    /// 状态原因文案（需重配时写清为什么）。
    var statusReason: String?
    /// 隧道地址的可达性探测结论。
    var tunnelReachable: Bool?
    /// 配对时间戳（毫秒）。
    var pairedAt: Double

    /// 从运行期条目落盘。
    init(entry: HostEntry) {
        id = entry.id
        label = entry.label
        origin = entry.laneOrigin
        form = entry.form.code
        candidates = entry.candidates
        deviceId = entry.deviceId
        cookie = entry.sessionCookie
        pairToken = entry.pairToken
        status = entry.status.rawValue
        statusReason = entry.statusReason
        tunnelReachable = entry.tunnelReachable
        pairedAt = entry.pairedAt
    }

    /// 还原成运行期条目。
    var entry: HostEntry {
        HostEntry(
            id: id,
            label: label,
            laneOrigin: origin,
            sessionCookie: cookie,
            form: HostForm.fromCode(form),
            candidates: candidates,
            deviceId: deviceId,
            pairToken: pairToken,
            status: HostStatus.fromCode(status),
            statusReason: statusReason,
            tunnelReachable: tunnelReachable,
            latencyMs: nil,
            pairedAt: pairedAt
        )
    }
}

/// 主机记录列表的编解码。
///
/// 整表存一个键：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
enum HostRecordCodec {
    /// 编码成 JSON 数组文本。
    static func encode(_ records: [HostRecord]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(records) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// 解码 JSON 数组文本；损坏时返回空列表（不抛给调用方）。
    static func decode(_ text: String) -> [HostRecord] {
        guard let data = text.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([HostRecord].self, from: data)) ?? []
    }
}
