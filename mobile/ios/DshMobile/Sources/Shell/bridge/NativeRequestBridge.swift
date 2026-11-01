import Foundation
import WebKit

/// 壳内原生请求桥：页面把「带请求体的请求」交给壳，壳带凭证发到 lane，再把响应交回页面。
///
/// 为什么需要它：WKWebView 的 `WKURLSchemeHandler` **拿不到请求体**（WebKit 不把 body 交给
/// scheme handler），而 dsh 客户端的一元 RPC 是 `POST` + JSON body
/// （`upstream/packages/client/connection/src/client/rpc.ts`）。没有这条桥，RPC 的 body 会丢。
///
/// 边界：
/// - 只接受**页面 origin** 下的 URL（页面不能借桥去访问任意第三方）；
/// - 凭证由壳附加，页面拿不到；
/// - 只用于小响应（RPC）；事件流（SSE）仍走转发通道以保持流式。
final class NativeRequestBridge: NSObject, WKScriptMessageHandler {
    /// 页面侧回包的通道：`(请求 id, 响应 JSON)`。
    typealias Responder = (String, String) -> Void

    private let hostProvider: () -> HostEntry?
    private let client: LaneHttpClient
    private let responder: Responder

    init(hostProvider: @escaping () -> HostEntry?, client: LaneHttpClient, responder: @escaping Responder) {
        self.hostProvider = hostProvider
        self.client = client
        self.responder = responder
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let id = payload["id"] as? String else { return }
        let method = (payload["method"] as? String ?? "GET").uppercased()
        let urlText = payload["url"] as? String ?? ""
        let headers = payload["headers"] as? [String: String] ?? [:]
        let bodyBase64 = payload["bodyBase64"] as? String ?? ""
        // 主线程执行：网络在 await 处让出主线程，回包直接交给页面。
        Task { @MainActor [weak self] in
            guard let self else { return }
            let result = await self.perform(method: method, urlText: urlText, headers: headers, bodyBase64: bodyBase64)
            let json = Self.encode(result)
            self.responder(id, json)
        }
    }

    /// 执行一次请求。
    private func perform(
        method: String,
        urlText: String,
        headers: [String: String],
        bodyBase64: String
    ) async -> [String: Any] {
        guard let target = laneTarget(urlText) else {
            return ["ok": false, "error": "不支持的请求地址"]
        }
        guard let host = hostProvider() else {
            return ["ok": false, "error": "未配置主机"]
        }
        let body = bodyBase64.isEmpty ? nil : Data(base64Encoded: bodyBase64)
        do {
            let response = try await client.send(
                LaneRequest(
                    url: target,
                    method: method,
                    cookie: host.sessionCookie,
                    headers: headers,
                    body: body
                )
            )
            var responseHeaders: [String: String] = [:]
            for (name, value) in response.headers {
                let lower = name.lowercased()
                if ["content-encoding", "transfer-encoding", "connection", "content-length"].contains(lower) { continue }
                responseHeaders[name] = value
            }
            return [
                "ok": true,
                "status": response.status,
                "statusText": response.reason,
                "headers": responseHeaders,
                "bodyBase64": response.body.base64EncodedString(),
            ]
        } catch {
            ShellLog.warn("原生请求桥失败：\(urlText)（\(error.localizedDescription)）")
            return ["ok": false, "error": error.localizedDescription]
        }
    }

    /// 把页面 origin 下的绝对 URL 映射到 lane origin 下的同一路径。
    private func laneTarget(_ urlText: String) -> URL? {
        let prefix = ShellSettings.pageOrigin
        guard urlText.hasPrefix(prefix) else { return nil }
        let rest = String(urlText.dropFirst(prefix.count))
        let path = rest.components(separatedBy: "?").first ?? rest
        let query = rest.contains("?") ? String(rest.split(separator: "?", maxSplits: 1)[1]) : ""
        guard let host = hostProvider() else { return nil }
        var text = OriginAddress.normalized(host.laneOrigin) + path
        if !query.isEmpty { text += "?" + query }
        return URL(string: text)
    }

    private static func encode(_ payload: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else {
            return "{\"ok\":false,\"error\":\"响应序列化失败\"}"
        }
        return String(data: data, encoding: .utf8) ?? "{\"ok\":false,\"error\":\"响应序列化失败\"}"
    }
}
