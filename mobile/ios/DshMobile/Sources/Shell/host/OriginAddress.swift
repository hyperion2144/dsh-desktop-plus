import Foundation

/// origin 字符串的解析小工具。
///
/// 壳里到处要判断「这个地址是不是 `.local`」「是不是私网」「是不是隧道」，
/// 于是主机名的取法只有这一份实现，避免各处各写一遍正则。
enum OriginAddress {
    /// 取 origin 里的主机名：去掉 scheme、路径、端口与 IPv6 方括号。
    static func host(of origin: String) -> String {
        var text = origin.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let schemeRange = text.range(of: "://") {
            text = String(text[schemeRange.upperBound...])
        }
        if let slash = text.firstIndex(of: "/") {
            text = String(text[..<slash])
        }
        if text.hasPrefix("["), let end = text.firstIndex(of: "]") {
            return String(text[text.index(after: text.startIndex)..<end])
        }
        if let colon = text.lastIndex(of: ":") {
            text = String(text[..<colon])
        }
        return text
    }

    /// origin 的 scheme（小写；没有 scheme 时为空）。
    static func scheme(of origin: String) -> String {
        let text = origin.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let range = text.range(of: "://") else { return "" }
        return String(text[..<range.lowerBound])
    }

    /// origin 的端口：显式端口优先；缺省按 scheme 补（`https`/`wss` → 443，其余 → 80）。
    ///
    /// 解析不出（没有端口且形态不明、端口不是数字）时返回 nil。
    static func port(of origin: String) -> UInt16? {
        var text = origin.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var secure = false
        if let schemeRange = text.range(of: "://") {
            let scheme = String(text[..<schemeRange.lowerBound])
            secure = scheme == "https" || scheme == "wss"
            text = String(text[schemeRange.upperBound...])
        }
        if let slash = text.firstIndex(of: "/") {
            text = String(text[..<slash])
        }
        let fallback: UInt16 = secure ? 443 : 80
        // IPv6 字面量：`[::1]:3093`。
        if text.hasPrefix("["), let end = text.firstIndex(of: "]") {
            let tail = String(text[text.index(after: end)...])
            if tail.hasPrefix(":") { return UInt16(tail.dropFirst()) }
            return fallback
        }
        if let colon = text.lastIndex(of: ":") {
            return UInt16(text[text.index(after: colon)...])
        }
        return fallback
    }

    /// 去掉尾部斜杠。
    static func normalized(_ origin: String) -> String {
        var text = origin.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }
}
