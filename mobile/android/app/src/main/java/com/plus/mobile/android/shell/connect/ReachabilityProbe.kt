package com.plus.mobile.android.shell.connect

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.net.Socket

/**
 * origin 拆出来的连接终点（主机名 + 端口）。
 *
 * 端口缺省按 scheme 补：`https`/`wss` → 443，其余 → 80。
 */
data class Endpoint(val host: String, val port: Int)

/**
 * 无凭证可达性预检：**只做一次 TCP 连接**。
 *
 * ## 为什么在 accept 之前
 *
 * 配对链接里的地址可能根本不通（地址写错、换了网络、桌面没开机）。
 * 旧流程先发 accept（带一次性令牌）才发现连不上——凭证已经发给了不可达甚至错误的目标。
 * 契约要求「配对前探测，不把凭证发给不可达目标」，所以这里先探一次：
 * **只连 TCP，不发任何 HTTP 请求，更不带任何凭证**。
 *
 * 预检只回答「值不值得把凭证发过去」：连得上就算可达，其余（连不上、超时、
 * 地址解析不出）一律算不可达。
 */
class ReachabilityProbe(private val timeoutMs: Int = DEFAULT_TIMEOUT_MS) {

    /**
     * 目标是否可达（连得上就算可达）。
     */
    suspend fun reachable(origin: String): Boolean = withContext(Dispatchers.IO) {
        val endpoint = endpointOf(origin)
        if (endpoint == null) {
            return@withContext false
        }
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(endpoint.host, endpoint.port), timeoutMs)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        /** 预检超时（毫秒）：预检要快——不通就立刻停，不让用户干等。 */
        const val DEFAULT_TIMEOUT_MS: Int = 2000

        /**
         * origin → 连接终点；解析不出返回 null。
         *
         * 支持 `scheme://host:port`、`host:port` 与 IPv6 字面量 `[::1]:port`。
         */
        fun endpointOf(origin: String): Endpoint? {
            var text = origin.trim()
            if (text.isEmpty()) return null
            var secure = false
            val schemeAt = text.indexOf("://")
            if (schemeAt >= 0) {
                val scheme = text.substring(0, schemeAt).lowercase()
                secure = scheme == "https" || scheme == "wss"
                text = text.substring(schemeAt + 3)
            }
            // 去掉路径 / 查询串 / 片段：预检只关心「连到哪里」。
            text = text.substringBefore('/').substringBefore('?').substringBefore('#')
            if (text.isEmpty()) return null
            val defaultPort = if (secure) 443 else 80
            if (text.startsWith("[")) {
                val close = text.indexOf(']')
                if (close < 0) return null
                val host = text.substring(1, close)
                if (host.isEmpty()) return null
                val tail = text.substring(close + 1)
                val port = if (tail.startsWith(":")) tail.substring(1).toIntOrNull() ?: return null else defaultPort
                return Endpoint(host, port)
            }
            val colon = text.lastIndexOf(':')
            if (colon < 0) {
                return Endpoint(text, defaultPort)
            }
            val host = text.substring(0, colon)
            val port = text.substring(colon + 1).toIntOrNull() ?: return null
            if (host.isEmpty() || port <= 0 || port > 65535) return null
            return Endpoint(host, port)
        }
    }
}
