import Foundation

/// lane 的端点拼装与响应里的会话 cookie 提取。
///
/// lane 控制面的契约（权威来源：`packages/plus/desktop-remote-access/lib/index.mjs` 的 `routePairing`）：
///
/// | 端点 | 方法 | 请求 | 成功 | 失败 |
/// |---|---|---|---|---|
/// | `/__dsh-mobile/api/pair/accept` | POST | `{token, name}` | 200 + `Set-Cookie: dsh_mobile_session=…` + `{deviceId}` | 403 `invalid-token` |
/// | `/__dsh-mobile/api/pair/renew` | POST | `{deviceId}` | 200 + `Set-Cookie` | 403 `unknown-device` |
/// | `/__dsh-mobile/api/pair/probe` | GET | `?url=…` | 200 `{ok, status, reason}` | 401 未配对 |
enum LaneEndpoint {
    /// 拼一个 lane 控制面端点的 URL。
    static func url(origin: String, path: String, query: [URLQueryItem] = []) -> URL? {
        let base = OriginAddress.normalized(origin)
        var components = URLComponents(string: base + ShellSettings.lanePrefix + path)
        components?.queryItems = query.isEmpty ? nil : query
        return components?.url
    }

    /// 从响应头里取出会话 cookie。
    ///
    /// 取的是**整对** `dsh_mobile_session=<值>`：出站时壳直接把它当 `Cookie` 头附加，
    /// 而 lane 的门禁按 `name=value` 解析。
    static func sessionCookie(in headers: [String: String]) -> String? {
        for (name, value) in headers where name.lowercased() == "set-cookie" {
            if let range = value.range(of: "dsh_mobile_session=") {
                let tail = value[range.upperBound...]
                let end = tail.firstIndex { $0 == ";" || $0 == "," || $0 == " " } ?? tail.endIndex
                let cookieValue = String(tail[..<end])
                if !cookieValue.isEmpty { return "dsh_mobile_session=\(cookieValue)" }
            }
        }
        return nil
    }
}
