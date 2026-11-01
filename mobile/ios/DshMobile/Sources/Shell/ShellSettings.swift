import Foundation

/// 壳的全局常量：壳与页面之间那份契约的唯一事实源。
///
/// 这一层回答三个问题：页面 origin 是什么、页面请求哪些路径要转发到 lane、壳自有端点在哪。
/// 其余代码只读这里，不各自写死一份。
///
/// ## 为什么页面 origin 用自定义 scheme
///
/// `file://` 不可行（模块脚本 + 相对 fetch 都会被 CORS 拦），而 `https://` 需要一张可信证书。
/// WKWebView 的 `WKURLSchemeHandler` 提供了第三条路：壳自己当源站，把本地 dist 以
/// `dsh-shell://app.dsh.local/…` 交给页面。
///
/// 自定义 scheme 的 origin **不是 opaque**：origin 需要一个非空 host 才是可存储、可同源比较的
/// origin（`localStorage` / 同源 fetch 都依赖这一点），所以 host 固定为 `app.dsh.local`。
/// 自定义 scheme 不走 ATS（ATS 只管 http/https），因此页面侧没有明文豁免问题。
enum ShellSettings {
    /// 页面 origin 的 scheme（`WKURLSchemeHandler` 自定义 scheme）。
    static let pageScheme = "dsh-shell"

    /// 页面 origin 的主机名。自定义 scheme 下必须非空，否则 origin 是 opaque 的。
    static let pageHost = "app.dsh.local"

    /// 页面 origin。
    static var pageOrigin: String { "\(pageScheme)://\(pageHost)" }

    /// 页面文档在页面 origin 下的路径。
    static let documentPath = "/index.html"

    /// 壳内自带的上游 web 产物在 App bundle 里的目录名（构建产物，不入库）。
    static let distDirectoryName = "dist"

    /// 壳内静态引导脚本在 App bundle 里的目录名。
    static let bootScriptDirectoryName = "shell"

    /// 壳内静态引导脚本的文件名。
    static let bootScriptFileName = "boot.js"

    /// 壳自有引导端点：注入行 + 传输配置从这里取（页面 origin 内，不出壳）。
    static let bootPayloadPath = "/__dsh-mobile-shell/boot.json"

    /// lane 控制面的保留命名空间前缀（与桌面端 `lane-routes.mjs` 的 LANE_PREFIX 一致）。
    static let lanePrefix = "/__dsh-mobile"

    /// 页面直连 lane 的 WS 路径前缀：`ws://<lane>/__dsh_ws/<令牌>/<原路径>`。
    ///
    /// **末尾斜杠是硬要求**：页面用 `new URL('api/remote.mux', base)` 相对解析，
    /// 少了它 `__dsh_ws/<令牌>` 整段会被当成文件名吃掉（令牌也一同丢失）。
    static let laneWsPrefix = "/__dsh_ws/"

    /// 页面侧原生请求桥的 message handler 名（承载带请求体的 POST）。
    static let nativeBridgeHandlerName = "dshNative"

    /// 移动端壳桥的 message handler 名（hosts / current / switchHost）。
    static let mobileBridgeHandlerName = "dshMobile"

    /// 需要转发到 lane 的路径前缀。
    ///
    /// 页面的一切数据面请求都是**文档相对**的：
    /// - `/api/` —— 一元 RPC、网关 HTTP 面
    /// - `/plugins/` —— 插件 bundle
    /// - `/assets/` —— 页面资源（本地 dist 未命中时回退到 lane）
    /// - `/__dsh-mobile/` —— lane 自己的保留命名空间
    /// - `/_loopback/` —— lane 的回环端口映射
    ///
    /// 不在白名单里的路径既不本地命中也不转发：宁可 404，也不要把未知路径盲转给主机。
    static let forwardedPrefixes = [
        "/api/",
        "/plugins/",
        "/assets/",
        "/__dsh-mobile/",
        "/_loopback/",
    ]

    /// 判断一个页面路径是否属于「转发到 lane」的范畴。
    static func isForwardedPath(_ path: String) -> Bool {
        forwardedPrefixes.contains { path.hasPrefix($0) }
    }
}
