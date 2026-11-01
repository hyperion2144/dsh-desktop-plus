import Foundation
import WebKit

/// 页面请求的总路由：壳内页面 origin 的唯一入口。
///
/// 优先级（对应票面「assets 内命中优先，未命中回退代理」）：
/// 1. 壳自有端点（引导载荷）——页面 origin 内，不出壳；
/// 2. 壳内自带的 upstream dist；
/// 3. 转发到当前主机 lane（`/api/`、`/plugins/`、`/assets/`、`/__dsh-mobile/`、`/_loopback/`）。
final class ShellSchemeHandler: NSObject, WKURLSchemeHandler {
    private let payloadStore: BootPayloadStore
    private let registry: HostRegistry
    private let assets: DistAssetHandler
    private let forwarder: LaneRequestForwarder

    /// 在途的转发任务（页面取消时一并取消）。
    private let lock = NSLock()
    private var inFlight: [ObjectIdentifier: URLSessionDataTask] = [:]

    init(
        payloadStore: BootPayloadStore,
        registry: HostRegistry,
        assets: DistAssetHandler,
        forwarder: LaneRequestForwarder
    ) {
        self.payloadStore = payloadStore
        self.registry = registry
        self.assets = assets
        self.forwarder = forwarder
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(ShellSchemeError.missingURL)
            return
        }
        // 数据面不再经过壳：WS 由页面带令牌直连 lane。走到这里说明是旧页面或第三方尝试——
        // 明确回 501，不让它挂在半开连接上。
        if isWebSocketUpgrade(task.request) {
            serveWebSocketRejected(task: task, request: task.request)
            return
        }
        // Foundation 的 url.path 会丢结尾斜杠（/plugins/ → /plugins），
        // 既过不了转发白名单，也会把 combo 路由改写错；URLComponents.path 保留原样。
        let path: String = {
            let p = URLComponents(url: url, resolvingAgainstBaseURL: false)?.path ?? url.path
            return p.isEmpty ? "/" : p
        }()
        if path == ShellSettings.bootPayloadPath {
            serveBootPayload(task: task, request: task.request)
            return
        }
        if let file = assets.file(for: path) {
            serveFile(task: task, request: task.request, file: file)
            return
        }
        guard ShellSettings.isForwardedPath(path) else {
            // 不在白名单里的路径既不本地命中也不转发：宁可 404，也不要把未知路径盲转给主机。
            serveNotFound(task: task, request: task.request)
            return
        }
        let laneTask = forwarder.forward(task: task, request: task.request, host: registry.current())
        if let laneTask {
            lock.lock()
            inFlight[ObjectIdentifier(task)] = laneTask
            lock.unlock()
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock()
        let laneTask = inFlight.removeValue(forKey: ObjectIdentifier(task))
        lock.unlock()
        laneTask?.cancel()
    }

    /// 壳自有的引导端点：注入行 + 传输配置。
    private func serveBootPayload(task: WKURLSchemeTask, request: URLRequest) {
        guard let payload = payloadStore.get() else {
            respond(task: task, request: request, status: 503, headers: ["Content-Type": "application/json; charset=utf-8"], body: Data("{\"error\":\"引导载荷未就绪\"}".utf8))
            return
        }
        respond(
            task: task,
            request: request,
            status: 200,
            headers: ["Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"],
            body: Data(payload.toJson().utf8)
        )
    }

    /// 壳内自带的 upstream dist。
    private func serveFile(task: WKURLSchemeTask, request: URLRequest, file: URL) {
        guard let data = try? Data(contentsOf: file) else {
            serveNotFound(task: task, request: request)
            return
        }
        respond(
            task: task,
            request: request,
            status: 200,
            headers: ["Content-Type": DistAssetHandler.mimeType(of: file.path)],
            body: data
        )
    }

    private func serveNotFound(task: WKURLSchemeTask, request: URLRequest) {
        respond(
            task: task,
            request: request,
            status: 404,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: Data("{\"error\":\"页面资源不存在\"}".utf8)
        )
    }

    /// 判断一个请求是不是 WebSocket 升级握手。
    private func isWebSocketUpgrade(_ request: URLRequest) -> Bool {
        guard let upgrade = request.value(forHTTPHeaderField: "Upgrade") else { return false }
        return upgrade.lowercased() == "websocket"
    }

    /// 回绝 WebSocket 升级：数据面已经直连 lane，壳不再中继。
    private func serveWebSocketRejected(task: WKURLSchemeTask, request: URLRequest) {
        respond(
            task: task,
            request: request,
            status: 501,
            headers: ["Content-Type": "application/json; charset=utf-8"],
            body: Data("{\"error\":\"websocket 直连 lane，壳不再中继\"}".utf8)
        )
    }

    private func respond(task: WKURLSchemeTask, request: URLRequest, status: Int, headers: [String: String], body: Data) {
        let url = request.url ?? URL(string: ShellSettings.pageOrigin + ShellSettings.documentPath)!
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            task.didFailWithError(ShellSchemeError.missingURL)
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

/// 壳的 scheme 层失败类型。
enum ShellSchemeError: Error, LocalizedError {
    /// 请求没有 URL。
    case missingURL

    var errorDescription: String? {
        switch self {
        case .missingURL: return "请求没有 URL"
        }
    }
}
