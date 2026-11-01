package com.plus.mobile.android.shell.page

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.ShellSettings

/**
 * document-start 注入：把引导脚本装到页面里，保证它跑在**任何页面脚本之前**。
 *
 * 为什么必须 document-start：上游客户端入口在 `run()` 里读 `window.__ModuleLoader__` 与
 * `globalThis.__DSH_BOOT__`（`upstream/packages/client/web/src/boot.ts`），facade 晚一步就
 * 会报「web boot: window.__ModuleLoader__ bootstrap facade is missing」。
 *
 * 引导脚本本身是**静态**的：它不内嵌主机信息，而是向壳自有端点取当前主机的注入行与传输配置。
 * 这样换主机时不需要重新注册脚本（androidx.webkit 没有 removeDocumentStartJavaScript）。
 */
class DocumentStartInstaller(private val webView: WebView) {

    /** 装上引导脚本。返回 true 表示 document-start 注入可用，false 表示要走内联兜底。 */
    fun install(script: String): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            ShellLog.warn("当前 WebView 不支持 document-start 注入，改用文档内联兜底")
            return false
        }
        WebViewCompat.addDocumentStartJavaScript(
            webView,
            script,
            setOf(ShellSettings.PAGE_ORIGIN),
        )
        ShellLog.info("已注册 document-start 引导脚本")
        return true
    }
}
