import Foundation

/// 一次发往 lane 的请求描述。
struct LaneRequest {
    /// 目标 URL。
    let url: URL
    /// HTTP 方法。
    var method: String = "GET"
    /// 壳持有的会话 cookie（页面永远拿不到）。
    var cookie: String?
    /// 附加请求头。
    var headers: [String: String] = [:]
    /// 请求体。带 body 的请求只能由壳原生发起（WebView 的 scheme handler 拿不到 body）。
    var body: Data?
}

/// lane 的响应（状态 + 头 + body）。
///
/// 转发器另有流式通道（`LaneHttpClient.stream`）：网关的长响应不能读进内存再吐回去。
struct LaneResponse {
    /// HTTP 状态码。
    let status: Int
    /// 状态文本。
    let reason: String
    /// 响应头（键为原始大小写，取值时按大小写不敏感匹配）。
    let headers: [String: String]
    /// 响应体。
    let body: Data

    /// 取一个响应头（大小写不敏感）。
    func header(_ name: String) -> String? {
        let target = name.lowercased()
        for (key, value) in headers where key.lowercased() == target {
            return value
        }
        return nil
    }
}

/// 壳侧的 HTTP 客户端。
///
/// 只用 URLSession：壳不需要第三方 HTTP 栈，且 WebView 之外的一切出站请求都在这里发生
/// （凭证由壳附加）。
final class LaneHttpClient {
    /// 连接超时（秒）。
    private let connectTimeout: TimeInterval
    /// 读超时（秒）。长响应（SSE）走流式通道，不受这个限制。
    private let readTimeout: TimeInterval

    /// 流式通道的路由器：一个 session 一个 delegate，按任务 id 分发回调。
    private let router = LaneStreamRouter()

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = readTimeout
        configuration.timeoutIntervalForResource = readTimeout
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: router, delegateQueue: router.queue)
    }()

    init(connectTimeout: TimeInterval = 10, readTimeout: TimeInterval = 30) {
        self.connectTimeout = connectTimeout
        self.readTimeout = readTimeout
    }

    /// 发起一次请求并读完响应。
    ///
    /// - Throws: 网络不可达、超时等（`URLError`）。
    func send(_ request: LaneRequest) async throws -> LaneResponse {
        var urlRequest = makeURLRequest(request)
        urlRequest.timeoutInterval = readTimeout
        let (data, response) = try await session.data(for: urlRequest)
        guard let http = response as? HTTPURLResponse else {
            throw LaneHttpError.invalidResponse
        }
        return LaneResponse(
            status: http.statusCode,
            reason: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
            headers: headersOf(http),
            body: data
        )
    }

    /// 发起一条流式请求（响应体边到边交）。
    ///
    /// 转发器用它把 lane 的响应原样搬给页面：事件流不能被读进内存再吐回去。
    ///
    /// - Returns: 在途的任务（页面取消时用它中止）。
    func stream(
        _ request: LaneRequest,
        onResponse: @escaping (HTTPURLResponse) -> Void,
        onData: @escaping (Data) -> Void,
        onComplete: @escaping (Error?) -> Void
    ) -> URLSessionDataTask {
        let urlRequest = makeURLRequest(request)
        let task = session.dataTask(with: urlRequest)
        router.register(task: task, onResponse: onResponse, onData: onData, onComplete: onComplete)
        task.resume()
        return task
    }

    /// 把壳的请求描述翻成 URLSession 的请求。
    private func makeURLRequest(_ request: LaneRequest) -> URLRequest {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.uppercased()
        urlRequest.timeoutInterval = connectTimeout
        // 明文传输在壳里是常态（lane 是局域网 http）：不自动压缩，避免与解码路径纠缠。
        urlRequest.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        urlRequest.httpShouldHandleCookies = false
        for (name, value) in request.headers where !name.isEmpty {
            urlRequest.setValue(value, forHTTPHeaderField: name)
        }
        if let cookie = request.cookie, !cookie.isEmpty {
            urlRequest.setValue(cookie, forHTTPHeaderField: "Cookie")
        }
        if let body = request.body {
            urlRequest.httpBody = body
        }
        return urlRequest
    }

    private func headersOf(_ response: HTTPURLResponse) -> [String: String] {
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let name = key as? String else { continue }
            headers[name] = value as? String ?? String(describing: value)
        }
        return headers
    }
}

/// 壳侧 HTTP 客户端的失败类型。
enum LaneHttpError: Error, LocalizedError {
    /// 响应不是 HTTP 响应。
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "响应不是 HTTP 响应"
        }
    }
}

/// 流式通道的路由器：一个 session 一个 delegate，按任务 id 把回调分给发起方。
final class LaneStreamRouter: NSObject, URLSessionDataDelegate {
    /// 回调集合。
    struct Handlers {
        let onResponse: (HTTPURLResponse) -> Void
        let onData: (Data) -> Void
        let onComplete: (Error?) -> Void
    }

    /// 回调队列（串行：一次只跑一个回调，避免与发起方抢数据）。
    let queue: OperationQueue = {
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        queue.name = "com.plus.mobile.dsh.lane-stream"
        return queue
    }()

    private let lock = NSLock()
    private var handlers: [Int: Handlers] = [:]

    /// 登记一个任务的回调。
    func register(
        task: URLSessionTask,
        onResponse: @escaping (HTTPURLResponse) -> Void,
        onData: @escaping (Data) -> Void,
        onComplete: @escaping (Error?) -> Void
    ) {
        lock.lock()
        defer { lock.unlock() }
        handlers[task.taskIdentifier] = Handlers(
            onResponse: onResponse,
            onData: onData,
            onComplete: onComplete
        )
    }

    private func handlers(for task: URLSessionTask) -> Handlers? {
        lock.lock()
        defer { lock.unlock() }
        return handlers[task.taskIdentifier]
    }

    private func removeHandlers(for task: URLSessionTask) {
        lock.lock()
        defer { lock.unlock() }
        handlers.removeValue(forKey: task.taskIdentifier)
    }

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if let http = response as? HTTPURLResponse {
            handlers(for: dataTask)?.onResponse(http)
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        handlers(for: dataTask)?.onData(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let handlers = handlers(for: task)
        removeHandlers(for: task)
        handlers?.onComplete(error)
    }
}
