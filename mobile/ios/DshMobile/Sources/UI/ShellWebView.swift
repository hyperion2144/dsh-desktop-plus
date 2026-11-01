import SwiftUI
import WebKit

/// 壳内页面（WKWebView）的 SwiftUI 包装。
///
/// 页面 origin 是自定义 scheme（`dsh-shell://app.dsh.local`）：壳自己当源站，
/// 文档相对请求由 `ShellSchemeHandler` 分流（本地 dist / 转发到 lane）。
struct ShellWebView: UIViewRepresentable {
    let controller: ShellController
    let environment: AppEnvironment

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: controller, environment: environment)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // 持久化的数据存储：页面的 localStorage 等要跨启动存活。
        configuration.websiteDataStore = .default()
        let contentController = WKUserContentController()
        configuration.userContentController = contentController
        configuration.setURLSchemeHandler(
            ShellSchemeHandler(
                payloadStore: environment.payloadStore,
                registry: environment.registry,
                assets: environment.assets,
                forwarder: environment.forwarder
            ),
            forURLScheme: ShellSettings.pageScheme
        )

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(DesignTokens.bgBase)
        webView.scrollView.backgroundColor = UIColor(DesignTokens.bgBase)

        context.coordinator.webView = webView
        contentController.add(context.coordinator.nativeBridge, name: ShellSettings.nativeBridgeHandlerName)
        contentController.add(context.coordinator.mobileBridge, name: ShellSettings.mobileBridgeHandlerName)
        context.coordinator.installScripts()
        // 协调器是类：弱捕获避免页面装载器与协调器互相吊住。
        let coordinator = context.coordinator
        controller.attachPageLoader { [weak coordinator] in
            coordinator?.loadPage()
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // 页面状态由控制器驱动，这里不做任何重载。
    }

    /// WebView 的协调器：装脚本、回消息、管导航。
    final class Coordinator: NSObject, WKNavigationDelegate {
        let controller: ShellController
        let environment: AppEnvironment
        var webView: WKWebView?

        /// 原生请求桥：页面 → 壳 → URLSession → 页面。
        lazy var nativeBridge = NativeRequestBridge(
            hostProvider: { [weak environment] in environment?.registry.current() },
            client: environment.httpClient
        ) { [weak self] id, json in
            self?.reply(id: id, json: json)
        }

        /// 壳桥：页面内浮层切换器用它切主机。
        lazy var mobileBridge = MobileBridge(host: controller)

        init(controller: ShellController, environment: AppEnvironment) {
            self.controller = controller
            self.environment = environment
        }

        /// 装 document-start 用户脚本：壳桥快照 + 引导脚本。
        func installScripts() {
            guard let content = webView?.configuration.userContentController else { return }
            content.removeAllUserScripts()
            content.addUserScript(
                WKUserScript(source: controller.bridgeSnapshotScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
            content.addUserScript(
                WKUserScript(source: BootScript.source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }

        /// 装载页面（先重装脚本：主机快照可能变了）。
        func loadPage() {
            installScripts()
            guard let url = URL(string: ShellSettings.pageOrigin + ShellSettings.documentPath) else { return }
            webView?.load(URLRequest(url: url))
        }

        /// 把原生请求桥的响应交回页面。
        private func reply(id: String, json: String) {
            // JSON 里可能含 U+2028 / U+2029：它们在旧的 JS 字符串字面量里是行分隔符。
            let escaped = json
                .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
                .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
            webView?.evaluateJavaScript("window.__dshNativeResolve(\(id), \(escaped));")
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            // 页面 origin 之外的导航（release 链接等）交给系统浏览器。
            if url.scheme != ShellSettings.pageScheme {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            ShellLog.warn("页面装载失败：\(error.localizedDescription)")
        }
    }
}
