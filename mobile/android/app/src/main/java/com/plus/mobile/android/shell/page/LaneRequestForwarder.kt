package com.plus.mobile.android.shell.page

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.net.LaneRequest
import java.io.ByteArrayInputStream

/**
 * 把页面的文档相对请求转发到当前主机 lane。
 *
 * 转发规则（权威形态见 upstream
 * `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`）：
 * 页面的一切数据面请求都是**文档相对**的，打在页面 origin 上；壳把它们搬到 lane origin，
 * 并在转发时附上壳持有的会话 cookie——页面 JS 自始至终拿不到凭证。
 *
 * `/files` 前缀规律（wayfinder #50 原型发现）：若页面文档挂在 `/files/index.html`，
 * 文档相对请求会**全部带上 `/files` 前缀**（`/files/api/x`、`/files/plugins/…`），
 * 转发时必须剥掉前缀，否则 lane 收到的是不存在的路径。壳把文档挂在 origin 根时前缀为空，
 * 但规则仍然按「文档基路径」实现，换挂载点也不会错。
 */
class LaneRequestForwarder(
    private val hostProvider: () -> HostEntry?,
    private val client: LaneHttpClient,
    /** 页面文档在页面 origin 下的基路径（根 = 空串；`/files` = 挂载在 /files 下）。 */
    private val documentBasePath: String,
) {

    /**
     * 转发一次请求。返回 null 表示「不归我管」（调用方应让它走默认流程）。
     */
    fun forward(request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        val path = url.path ?: return null
        if (!ShellSettings.isForwardedPath(path)) return null

        val host = hostProvider()
        if (host == null) {
            return errorResponse(503, "未配置主机")
        }
        val lanePath = stripDocumentBase(path)
        val query = url.encodedQuery?.let { "?$it" }.orEmpty()
        val target = host.laneOrigin.trimEnd('/') + lanePath + query

        return try {
            val response = client.open(
                LaneRequest(
                    url = target,
                    method = request.method,
                    cookie = host.sessionCookie,
                    headers = forwardedHeaders(request),
                ),
            )
            ShellLog.info("转发 ${request.method} $lanePath → $target （HTTP ${response.status}）")
            WebResourceResponse(
                contentTypeOf(response.headers["Content-Type"]) ?: response.headers["Content-Type"],
                null,
                response.status,
                response.reason,
                responseHeaders(response.headers),
                SafeInputStream(response.stream),
            )
        } catch (error: Exception) {
            ShellLog.warn("转发失败：$target", error)
            errorResponse(502, error.message ?: "转发失败")
        }
    }

    /** 剥掉文档基路径前缀（`/files` 规律）。 */
    fun stripDocumentBase(path: String): String {
        if (documentBasePath.isEmpty()) return path
        val prefix = if (documentBasePath.startsWith("/")) documentBasePath else "/$documentBasePath"
        if (path == prefix) return "/"
        if (path.startsWith("$prefix/")) return path.removePrefix(prefix)
        return path
    }

    private fun forwardedHeaders(request: WebResourceRequest): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        request.requestHeaders.forEach { (name, value) ->
            val lower = name.lowercase()
            // Host 由 lane 自己改写；逐跳头不能原样搬运；压缩协商由壳统一处理。
            if (lower in SKIPPED_HEADERS) return@forEach
            headers[name] = value
        }
        headers["Accept-Encoding"] = "identity"
        return headers
    }

    private fun responseHeaders(headers: Map<String, String>): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        headers.forEach { (name, value) ->
            val lower = name.lowercase()
            if (lower in DROPPED_RESPONSE_HEADERS) return@forEach
            result[name] = value
        }
        result["Content-Type"] = result["Content-Type"] ?: "application/octet-stream"
        return result
    }

    private fun contentTypeOf(header: String?): String? = header?.substringBefore(';')?.trim()?.ifEmpty { null }

    private fun errorResponse(status: Int, detail: String): WebResourceResponse {
        val body = """{"error":"$detail"}"""
        return WebResourceResponse(
            "application/json",
            "utf-8",
            status,
            if (status == 503) "Service Unavailable" else "Bad Gateway",
            mapOf("Content-Type" to "application/json; charset=utf-8"),
            ByteArrayInputStream(body.toByteArray(Charsets.UTF_8)),
        )
    }

    private companion object {
        /** 转发时不搬运的请求头。 */
        val SKIPPED_HEADERS = setOf(
            "host",
            "connection",
            "keep-alive",
            "proxy-connection",
            "transfer-encoding",
            "te",
            "trailer",
            "upgrade",
            "accept-encoding",
            "cookie",
        )

        /** 响应里不搬运的头：逐跳头与内容编码（壳统一按 identity 传输）。 */
        val DROPPED_RESPONSE_HEADERS = setOf(
            "connection",
            "keep-alive",
            "proxy-connection",
            "transfer-encoding",
            "upgrade",
            "content-encoding",
            "content-length",
        )
    }
}
