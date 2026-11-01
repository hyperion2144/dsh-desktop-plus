import Foundation

/// 桌面端签发的一次性配对链接。
///
/// ## 支持的两种形态
///
/// 1. `http://主机地址:端口/pair?token=…` —— 桌面端「远程访问」面板的二维码就是这个形态
///    （`packages/plus/desktop-remote-access/client/client.source.jsx` 的 `pairLink()`）。
///    地址候选以 `base` 参数随链接下发（`buildHttpPairLink`）。
/// 2. `dsh-mobile://pair?token=…&base=候选1,候选2` —— 移动端专用形态
///    （同包 `lib/links.mjs` 的 `buildPairLink`），`base` 是**地址候选列表**。
///
/// 两种形态都带一次性令牌；**没有任何手输令牌的入口**（spec #55「配对」）。
///
/// 解析是纯函数（不碰 iOS API），因此可以直接在纯 Swift 测试里验。
struct PairLink {
    /// 一次性令牌。
    let token: String
    /// 地址候选列表（origin，按 iOS 择优顺序：`.local` 在前）。
    let candidates: [String]
    /// 链接里带的显示名（桌面端当前不带，留给将来的扩展）。
    let displayName: String?

    /// 首选地址。
    var origin: String { candidates.first ?? "" }

    /// 移动端专用 scheme。
    static let mobileScheme = "dsh-mobile"

    /// 解析配对链接；无法识别时返回 nil。
    static func parse(_ raw: String) -> PairLink? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let components = URLComponents(string: text) else { return nil }
        let scheme = components.scheme?.lowercased() ?? ""
        let query = parseQuery(components.queryItems)
        let token = (query["token"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { return nil }

        switch scheme {
        case mobileScheme:
            let candidates = splitCandidates(query["base"] ?? query["origin"] ?? "")
            guard !candidates.isEmpty else { return nil }
            return PairLink(token: token, candidates: HostCandidates.orderedForPlatform(candidates), displayName: query["name"])
        case "http", "https":
            guard isPairingPath(components.path) else { return nil }
            guard let origin = originOf(components) else { return nil }
            // 链接自带的 base 参数是权威的候选列表；链接自身的 origin 也并进来（老链接没有 base）。
            var candidates = splitCandidates(query["base"] ?? "")
            if !candidates.contains(origin) { candidates.insert(origin, at: 0) }
            return PairLink(
                token: token,
                candidates: HostCandidates.orderedForPlatform(candidates),
                displayName: query["name"]
            )
        default:
            return nil
        }
    }

    /// 配对入口路径：裸 `/pair`（桌面端形态）或保留命名空间下的 `/pair`。
    private static func isPairingPath(_ path: String) -> Bool {
        let clean = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if clean.isEmpty { return true }
        return clean.hasSuffix("pair")
    }

    /// 由 URLComponents 取出 origin（scheme://host[:port]）。
    private static func originOf(_ components: URLComponents) -> String? {
        guard let host = components.host, !host.isEmpty else { return nil }
        let scheme = (components.scheme ?? "http").lowercased()
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    /// 拆候选列表并逐个归一化。
    private static func splitCandidates(_ raw: String) -> [String] {
        raw.split(separator: ",")
            .compactMap { normalizeOrigin(String($0)) }
    }

    /// 归一化一个地址：补协议头、去尾斜杠。
    ///
    /// 桌面端给的 base 形态是 `主机:端口`（无协议），故缺协议时按 http 补齐。
    private static func normalizeOrigin(_ raw: String) -> String? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !text.isEmpty else { return nil }
        let withScheme = text.contains("://") ? text : "http://\(text)"
        guard let components = URLComponents(string: withScheme), let host = components.host, !host.isEmpty else {
            return nil
        }
        let scheme = (components.scheme ?? "http").lowercased()
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    /// 解析查询串（不做 + → 空格 的替换：令牌与地址里没有空格）。
    private static func parseQuery(_ items: [URLQueryItem]?) -> [String: String] {
        var result: [String: String] = [:]
        items?.forEach { item in
            guard !item.name.isEmpty else { return }
            result[item.name] = item.value ?? ""
        }
        return result
    }
}
