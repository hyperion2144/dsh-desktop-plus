package com.plus.mobile.android.shell.net

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** 一次发往 lane 的请求描述。 */
data class LaneRequest(
    val url: String,
    val method: String = "GET",
    /** 壳持有的会话 cookie（页面永远拿不到）。 */
    val cookie: String? = null,
    val headers: Map<String, String> = emptyMap(),
    /** 请求体。WebView 拦截拿不到 body，带 body 的请求只能由壳原生发起。 */
    val body: ByteArray? = null,
)

/**
 * lane 响应：状态 + 头 + **流式** body。
 *
 * body 保持流式是有意的：网关的长响应（SSE / 事件流）不能被读进内存再吐回去。
 */
class LaneResponse(
    val status: Int,
    val reason: String,
    val headers: Map<String, String>,
    val stream: InputStream,
) : java.io.Closeable {
    /** 读完整 body 为文本（仅用于小响应，如 index.html）。 */
    fun readText(): String = stream.bufferedReader(Charsets.UTF_8).readText()

    override fun close() {
        try {
            stream.close()
        } catch (_: Exception) {
            // 关闭失败不影响调用方语义
        }
    }
}

/**
 * 壳侧的 HTTP 客户端。
 *
 * 只用 `HttpURLConnection`：壳不需要第三方 HTTP 栈，且 WebView 的
 * `shouldInterceptRequest` 之外的一切出站请求都在这里发生（凭证由壳附加）。
 */
class LaneHttpClient(
    private val connectTimeoutMs: Int = 10_000,
    private val readTimeoutMs: Int = 30_000,
) {

    /**
     * 打开一条到 lane 的请求。
     *
     * @throws java.io.IOException 网络不可达、超时等。
     */
    fun open(request: LaneRequest): LaneResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        connection.requestMethod = request.method
        connection.connectTimeout = connectTimeoutMs
        connection.readTimeout = readTimeoutMs
        connection.instanceFollowRedirects = false
        // 明文传输在壳里是常态（lane 是局域网 http），不自动压缩以免与 WebView 的
        // 解码路径纠缠；体积换确定性。
        connection.setRequestProperty("Accept-Encoding", "identity")
        request.headers.forEach { (name, value) ->
            if (name.isNotBlank()) connection.setRequestProperty(name, value)
        }
        request.cookie?.takeIf { it.isNotBlank() }?.let { connection.setRequestProperty("Cookie", it) }
        request.body?.let { body ->
            connection.doOutput = true
            connection.setRequestProperty("Content-Length", body.size.toString())
            connection.outputStream.use { it.write(body) }
        }

        val status = try {
            connection.responseCode
        } catch (error: Exception) {
            connection.disconnect()
            throw error
        }
        val stream = if (status in 200..299) {
            connection.inputStream
        } else {
            connection.errorStream ?: ByteArrayInputStream(ByteArray(0))
        }
        val headers = LinkedHashMap<String, String>()
        connection.headerFields.forEach { (name, values) ->
            if (name != null && values.isNotEmpty()) headers[name] = values.joinToString(", ")
        }
        return LaneResponse(status, connection.responseMessage.orEmpty(), headers, stream)
    }
}
