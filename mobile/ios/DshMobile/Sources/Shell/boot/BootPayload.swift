import Foundation

/// 引导载荷：页面在 document-start 取的那份数据。
///
/// 两块内容：
/// - `rows`：从 lane 渲染结果里解析出的注入行（facade / `__DSH_BOOT__` / bootstrap script-src / …）
/// - `transport`：`__DSH_TRANSPORT__` 的配置（streamBaseUrl / createWebSocket / ownsHost）
struct BootPayload {
    let hostId: String
    let hostLabel: String
    let laneOrigin: String
    let pageOrigin: String
    /// 页面侧 WebSocket 的 base：页面直连 lane 的地址（令牌在路径里，壳不再中继）。
    let socketBaseUrl: String
    let rows: [InjectionRow]

    /// 序列化成页面消费的 JSON。
    func toJson() -> String {
        let transport: [String: Any] = [
            // 能力位：对齐桌面载体与 lane 远程页面先例，只开特权 UI 面（服务端设置），
            // 不放宽传输层鉴权（spec #55「服务端设置特权面」）。
            "ownsHost": true,
            // 页面内 WS 的 base：直连 lane（令牌在路径里，凭证不经壳）。
            "streamBaseUrl": socketBaseUrl,
            "laneOrigin": laneOrigin,
            "pageOrigin": pageOrigin,
        ]
        let host: [String: Any] = [
            "id": hostId,
            "label": hostLabel,
            "origin": laneOrigin,
        ]
        var rowsJson: [[String: Any]] = []
        for row in rows {
            switch row {
            case .script(let text): rowsJson.append(["kind": "script", "text": text])
            case .scriptSrc(let src): rowsJson.append(["kind": "script-src", "src": src])
            case .scriptPreload(let src): rowsJson.append(["kind": "script-preload", "src": src])
            }
        }
        let root: [String: Any] = [
            "host": host,
            "transport": transport,
            "rows": rowsJson,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: root, options: [.sortedKeys]) else {
            return "{\"error\":\"引导载荷序列化失败\"}"
        }
        return String(data: data, encoding: .utf8) ?? "{\"error\":\"引导载荷序列化失败\"}"
    }
}
