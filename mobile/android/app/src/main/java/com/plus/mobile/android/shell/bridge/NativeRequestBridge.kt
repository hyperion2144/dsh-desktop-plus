package com.plus.mobile.android.shell.bridge

import android.util.Base64
import android.webkit.JavascriptInterface
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.net.LaneRequest
import org.json.JSONObject

/**
 * 壳内原生请求桥：页面把「带请求体的请求」交给壳，壳带凭证发到 lane，再把响应交回页面。
 *
 * 为什么需要它：Android 的 `shouldInterceptRequest` **拿不到请求体**（平台限制），
 * 而 dsh 客户端的一元 RPC 是 `POST` + JSON body（`upstream/packages/client/connection/src/client/rpc.ts`）。
 * 没有这条桥，RPC 的 body 会在转发时丢失。
 *
 * 边界：
 *  - 只接受**页面 origin** 下的 URL（页面不能借桥去访问任意第三方）；
 *  - 凭证由壳附加，页面拿不到；
 *  - 只用于小响应（RPC）；事件流（SSE）仍走转发通道以保持流式。
 */
class NativeRequestBridge(
    private val hostProvider: () -> HostEntry?,
    private val client: LaneHttpClient,
    /** 页面文档基路径（`/files` 规律的剥前缀）。 */
    private val documentBasePath: String,
) {

    /**
     * 执行一次请求。返回 JSON 字符串：
     * `{"ok":true,"status":200,"statusText":"OK","headers":{…},"bodyBase64":"…"}`
     * 或 `{"ok":false,"error":"…"}`。
     */
    @JavascriptInterface
    fun request(method: String, url: String, headersJson: String, bodyBase64: String): String {
        return try {
            val target = laneTarget(url)
            val headers = parseHeaders(headersJson)
            val body = if (bodyBase64.isEmpty()) null else Base64.decode(bodyBase64, Base64.NO_WRAP)
            val host = hostProvider() ?: return failure("未配置主机")
            val response = client.open(
                LaneRequest(
                    url = target,
                    method = method.ifBlank { "GET" }.uppercase(),
                    cookie = host.sessionCookie,
                    headers = headers,
                    body = body,
                ),
            )
            val payload = response.use {
                val bytes = it.stream.readBytes()
                JSONObject()
                    .put("ok", true)
                    .put("status", it.status)
                    .put("statusText", it.reason)
                    .put("headers", JSONObject(headersOf(it.headers)))
                    .put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
            }
            payload.toString()
        } catch (error: Exception) {
            ShellLog.warn("原生请求桥失败：$url", error)
            failure(error.message ?: "请求失败")
        }
    }

    /** 把页面 origin 下的绝对 URL 映射到 lane origin 下的同一路径。 */
    private fun laneTarget(url: String): String {
        val prefix = ShellSettings.PAGE_ORIGIN
        if (!url.startsWith(prefix)) throw IllegalArgumentException("不支持的请求地址")
        val path = url.removePrefix(prefix).substringBefore('?')
        val query = url.substringAfter('?', "")
        val host = hostProvider() ?: throw IllegalStateException("未配置主机")
        val stripped = stripDocumentBase(path)
        return host.laneOrigin.trimEnd('/') + stripped + if (query.isEmpty()) "" else "?$query"
    }

    /** 剥掉文档基路径前缀（`/files` 规律）。 */
    private fun stripDocumentBase(path: String): String {
        if (documentBasePath.isEmpty()) return path
        val base = if (documentBasePath.startsWith("/")) documentBasePath else "/$documentBasePath"
        if (path == base) return "/"
        if (path.startsWith("$base/")) return path.removePrefix(base)
        return path
    }

    private fun parseHeaders(headersJson: String): Map<String, String> {
        if (headersJson.isBlank()) return emptyMap()
        val json = JSONObject(headersJson)
        val headers = LinkedHashMap<String, String>()
        json.keys().forEach { name ->
            headers[name] = json.optString(name, "")
        }
        return headers
    }

    private fun headersOf(headers: Map<String, String>): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        headers.forEach { (name, value) ->
            val lower = name.lowercase()
            if (lower in setOf("content-encoding", "transfer-encoding", "connection", "content-length")) return@forEach
            result[name] = value
        }
        return result
    }

    private fun failure(error: String): String = JSONObject().put("ok", false).put("error", error).toString()
}
