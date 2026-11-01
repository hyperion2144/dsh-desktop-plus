import Foundation

/// 主机仓库：读写「已配对主机 + 各自凭证」的唯一入口。
protocol HostRegistry: AnyObject {
    /// 全部主机（按加入顺序）。
    func list() -> [HostEntry]

    /// 当前主机；没有标记时取第一台。
    func current() -> HostEntry?

    /// 按 id 找主机。
    func find(id: String) -> HostEntry?

    /// 设定当前主机（id 不存在时不动）。
    func setCurrent(id: String)

    /// 新增或覆盖一台主机。
    func upsert(_ host: HostEntry)

    /// 移除一台主机。
    func remove(id: String)

    /// 标记某台主机的状态与原因。
    func markStatus(id: String, status: HostStatus, reason: String?)

    /// 记录某台主机最近一次探测到的往返延迟。
    func markLatency(id: String, latencyMs: Int?)
}
