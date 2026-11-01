package com.plus.mobile.android.shell.page

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.boot.BootPayloadStore
import java.io.ByteArrayInputStream

/**
 * 页面请求的总路由：`shouldInterceptRequest` 的唯一入口。
 *
 * 优先级（对应票面「assets 内命中优先，未命中回退代理」）：
 *  1. 壳自有端点（引导载荷）——页面 origin 内，不出壳；
 *  2. 壳内自带的 upstream dist（真实 https origin 提供）；
 *  3. 转发到当前主机 lane（`/api/`、`/plugins/`、`/assets/`、`/__dsh-mobile/`）。
 */
class PageRequestRouter(
    private val assetLoader: WebViewAssetLoader,
    private val payloadStore: BootPayloadStore,
    private val forwarder: LaneRequestForwarder,
) {

    fun route(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        // 只管页面 origin 下的请求；其它 origin（外部链接）交给系统。
        if (url.host != ShellSettings.PAGE_HOST) return null
        val path = url.path ?: return null

        if (isWebSocketUpgrade(request)) {
            return websocketNotSupported()
        }

        if (path == ShellSettings.BOOT_PAYLOAD_PATH) {
            return payloadResponse()
        }
        assetLoader.shouldInterceptRequest(url)?.let { return it }
        return forwarder.forward(request)
    }

    /**
     * 壳不再中继 WS：页面带签名令牌直连 lane（见 connect/LaneSocketBase）。
     *
     * 走到这里说明是旧页面或第三方尝试——明确回 501，
     * 不让它挂在半开连接上（Android 侧没有自开的回环端口，壳的请求入口就是本路由；
     * 响应体读完连接即由 WebView 收掉）。
     */
    private fun websocketNotSupported(): WebResourceResponse {
        val body = """{"error":"websocket 直连 lane，壳不再中继"}"""
        return WebResourceResponse(
            "application/json",
            "utf-8",
            501,
            "Not Implemented",
            mapOf("Content-Type" to "application/json; charset=utf-8"),
            ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)),
        )
    }

    /** 判断这次请求是不是 WebSocket 升级握手（`Upgrade: websocket`）。 */
    private fun isWebSocketUpgrade(request: WebResourceRequest): Boolean =
        request.requestHeaders.entries.any { (name, value) ->
            name.equals("upgrade", ignoreCase = true) && value.contains("websocket", ignoreCase = true)
        }

    private fun payloadResponse(): WebResourceResponse {
        val payload = payloadStore.get()
        if (payload == null) {
            val body = """{"error":"引导载荷未就绪"}"""
            return WebResourceResponse(
                "application/json",
                "utf-8",
                503,
                "Service Unavailable",
                mapOf("Content-Type" to "application/json; charset=utf-8"),
                ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)),
            )
        }
        return WebResourceResponse(
            "application/json",
            "utf-8",
            200,
            "OK",
            mapOf("Content-Type" to "application/json; charset=utf-8", "Cache-Control" to "no-store"),
            ByteArrayInputStream(payload.toJson().toByteArray(Charsets.UTF_8)),
        )
    }
}
