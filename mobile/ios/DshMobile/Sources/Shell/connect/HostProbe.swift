import Foundation

/// 主机探测：量一段往返延迟（管理页显示用）。
///
/// 探测只打 lane 的根路径：它要的是「这台机器现在通不通」，不是某个业务接口的结果。
final class HostProbe {
    private let client: LaneHttpClient

    init(client: LaneHttpClient) {
        self.client = client
    }

    /// 探测往返延迟（毫秒）；不可达时返回 nil。
    func latency(origin: String) async -> Int? {
        guard let url = URL(string: OriginAddress.normalized(origin) + "/") else { return nil }
        let start = Date()
        do {
            _ = try await client.send(LaneRequest(url: url, method: "GET"))
        } catch {
            return nil
        }
        return Int(Date().timeIntervalSince(start) * 1000)
    }
}
