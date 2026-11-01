import Foundation

/// 引导载荷装载失败（主机不可达 / 页面不像 dsh 页面）。
enum BootPayloadError: Error, LocalizedError {
    /// 主机不可达（网络层失败）。
    case unreachable(String)
    /// 配对门禁拒绝（HTTP 401 + `{"error":"unpaired"}`）。
    case gated(String)
    /// 主机返回的不是 dsh 页面。
    case malformed(String)

    var errorDescription: String? {
        switch self {
        case .unreachable(let detail): return detail
        case .gated(let detail): return detail
        case .malformed(let detail): return detail
        }
    }
}

/// 引导载荷的来源：向当前主机要一份渲染好的 index.html，解析出注入行。
///
/// 「注入行从 lane 拉取/合成」的落地：facade、`__DSH_BOOT__` 全局、bootstrap 的 plugin combo
/// 都是**主机运行时才有**的内容（依赖主机上装了哪些插件），壳自己造不出来，只能取。
final class BootPayloadProvider {
    private let client: LaneHttpClient
    private let parser: LaneIndexParser

    init(client: LaneHttpClient, parser: LaneIndexParser = LaneIndexParser()) {
        self.client = client
        self.parser = parser
    }

    /// 拉取并解析当前主机的引导载荷。
    func load(host: HostEntry, socketBaseUrl: String) async throws -> BootPayload {
        let origin = OriginAddress.normalized(host.laneOrigin)
        guard let url = URL(string: origin + ShellSettings.documentPath) else {
            throw BootPayloadError.unreachable("地址无法解析")
        }
        let response: LaneResponse
        do {
            response = try await client.send(
                LaneRequest(url: url, cookie: host.sessionCookie, headers: ["Accept": "text/html"])
            )
        } catch {
            throw BootPayloadError.unreachable("无法连接主机 \(host.displayName)")
        }
        guard (200..<300).contains(response.status) else {
            // 门禁拒绝：body 是 {"error":"unpaired"}（lane 的配对门禁，见 proxy.mjs）。
            if response.status == 401 {
                let detail = String(data: response.body, encoding: .utf8) ?? ""
                if detail.contains(Self.unpairedMark) {
                    throw BootPayloadError.gated("主机要求重新配对：\(host.displayName)")
                }
            }
            throw BootPayloadError.malformed("主机返回 HTTP \(response.status)")
        }
        guard let html = String(data: response.body, encoding: .utf8) else {
            throw BootPayloadError.malformed("主机页面不是文本")
        }
        let rows = parser.parse(html)
        guard rows.contains(where: { if case .script(let text) = $0 { return text.contains(Self.facadeMark) } else { return false } }) else {
            throw BootPayloadError.malformed("主机页面缺少模块加载 facade")
        }
        guard rows.contains(where: { if case .script(let text) = $0 { return text.contains(Self.bootGraphMark) } else { return false } }) else {
            throw BootPayloadError.malformed("主机页面缺少启动图")
        }
        ShellLog.info(
            "引导载荷就绪：主机=\(host.displayName) 注入行=\(rows.count) "
                + "内联=\(rows.filter { if case .script = $0 { return true } else { return false } }.count) "
                + "外部=\(rows.filter { if case .scriptSrc = $0 { return true } else { return false } }.count)"
        )
        return BootPayload(
            hostId: host.id,
            hostLabel: host.displayName,
            laneOrigin: origin,
            pageOrigin: ShellSettings.pageOrigin,
            socketBaseUrl: socketBaseUrl,
            rows: rows
        )
    }

    /// facade 行标记：`window.__ModuleLoader__=` 队列。
    private static let facadeMark = "__ModuleLoader__"
    /// 启动图行标记：`globalThis["__DSH_BOOT__"] = …`。
    private static let bootGraphMark = "__DSH_BOOT__"
    /// 配对门禁的 body 标记。
    private static let unpairedMark = "unpaired"
}
