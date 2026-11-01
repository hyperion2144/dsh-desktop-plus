import Foundation
import WebKit

/// 把页面的文档相对请求转发到当前主机 lane。
///
/// 转发规则（权威形态见 upstream
/// `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`）：
/// 页面的一切数据面请求都是**文档相对**的，打在页面 origin 上；壳把它们搬到 lane origin，
/// 并在转发时附上壳持有的会话 cookie——页面 JS 自始至终拿不到凭证。
///
/// 转发是**流式**的：网关的长响应（事件流）不能被读进内存再吐回去。
final class LaneRequestForwarder {
    private let client: LaneHttpClient
    /// 页面文档在页面 origin 下的基路径（根 = 空串；挂在 `/files` 下时 = `/files`）。
    private let documentBasePath: String

    init(client: LaneHttpClient, documentBasePath: String = "") {
        self.client = client
        self.documentBasePath = documentBasePath
    }

    /// 转发一次请求（把响应搬给页面）。
    ///
    /// - Parameters:
    ///   - task: 页面的 scheme 任务（响应只能给它一次）。
    ///   - request: 页面发来的请求。
    ///   - host: 当前主机（凭证来源）；nil 表示没配置主机。
    /// - Returns: 在途的出站任务（页面取消时用它中止）。
    @discardableResult
    func forward(task: WKURLSchemeTask, request: URLRequest, host: HostEntry?) -> URLSessionDataTask? {
        guard let host else {
            respond(task: task, request: request, status: 503, body: Data("{\"error\":\"未配置主机\"}".utf8))
            return nil
        }
        guard let url = laneURL(request: request, host: host) else {
            respond(task: task, request: request, status: 502, body: Data("{\"error\":\"地址无法解析\"}".utf8))
            return nil
        }
        let laneRequest = LaneRequest(
            url: url,
            method: request.httpMethod ?? "GET",
            cookie: host.sessionCookie,
            headers: forwardedHeaders(request)
        )
        ShellLog.info("转发 \(laneRequest.method) \(url.path) → \(url.absoluteString)")
        return client.stream(
            laneRequest,
            onResponse: { [weak task] response in
                guard let task else { return }
                var headers: [String: String] = [:]
                for (key, value) in response.allHeaderFields {
                    guard let name = key as? String else { continue }
                    let lower = name.lowercased()
                    // 逐跳头与内容编码不搬运：壳统一按 identity 传输。
                    if ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "content-encoding", "content-length"].contains(lower) {
                        continue
                    }
                    headers[name] = value as? String ?? String(describing: value)
                }
                if headers["Content-Type"] == nil { headers["Content-Type"] = "application/octet-stream" }
                guard let urlResponse = HTTPURLResponse(
                    url: request.url ?? url,
                    statusCode: response.statusCode,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers
                ) else {
                    // 理论上不会发生（HTTPURLResponse 只在头非法时为 nil）。
                    task.didFailWithError(ForwardError.badResponse)
                    return
                }
                task.didReceive(urlResponse)
            },
            onData: { [weak task] data in
                task?.didReceive(data)
            },
            onComplete: { [weak task] error in
                guard let task else { return }
                if let error {
                    ShellLog.warn("转发失败：\(url.absoluteString)（\(error.localizedDescription)）")
                    task.didFailWithError(error)
                } else {
                    task.didFinish()
                }
            }
        )
    }

    /// 把页面 origin 下的路径映射到 lane origin 下的同一路径。
    private func laneURL(request: URLRequest, host: HostEntry) -> URL? {
        guard let url = request.url else { return nil }
        // 结尾斜杠必须原样保留：/plugins/??combo 少一个斜杠就不再是同一条路由
        //（Foundation 的 url.path 会把结尾斜杠丢掉）。
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let path = stripDocumentBase(comps?.path ?? url.path)
        var text = OriginAddress.normalized(host.laneOrigin) + path
        if let query = url.query, !query.isEmpty { text += "?" + query }
        return URL(string: text)
    }

    /// 剥掉文档基路径前缀（`/files` 规律）。
    func stripDocumentBase(_ path: String) -> String {
        guard !documentBasePath.isEmpty else { return path }
        let base = documentBasePath.hasPrefix("/") ? documentBasePath : "/" + documentBasePath
        if path == base { return "/" }
        if path.hasPrefix(base + "/") { return String(path.dropFirst(base.count)) }
        return path
    }

    /// 转发时不搬运的请求头。
    private func forwardedHeaders(_ request: URLRequest) -> [String: String] {
        var headers: [String: String] = [:]
        for (name, value) in request.allHTTPHeaderFields ?? [:] {
            let lower = name.lowercased()
            // Host 由 lane 自己改写；逐跳头不能原样搬运；压缩协商由壳统一处理；
            // cookie 由壳附加（页面那份不算数）。
            if ["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "accept-encoding", "cookie"].contains(lower) {
                continue
            }
            headers[name] = value
        }
        headers["Accept-Encoding"] = "identity"
        return headers
    }

    /// 用一个错误响应结束任务。
    private func respond(task: WKURLSchemeTask, request: URLRequest, status: Int, body: Data) {
        let url = request.url ?? URL(string: ShellSettings.pageOrigin + ShellSettings.documentPath)!
        let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json; charset=utf-8"]
        )!
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

/// 转发失败的类型。
enum ForwardError: Error, LocalizedError {
    /// lane 的应答头无法构造出合法的 HTTP 响应。
    case badResponse

    var errorDescription: String? {
        switch self {
        case .badResponse: return "lane 的应答无法转成页面响应"
        }
    }
}
