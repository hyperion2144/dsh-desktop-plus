package com.plus.mobile.android.shell.pair

import java.net.URI
import java.net.URLDecoder

/**
 * 桌面端签发的一次性配对链接。
 *
 * ## 支持的两种形态
 *
 * 1. `http://主机地址:端口/pair?token=…` —— 桌面端「远程访问」面板的二维码就是这个形态
 *    （`packages/plus/desktop-remote-access/client/client.source.jsx` 的 `pairLink()`：
 *    `scheme + "://" + base + "/pair?token=" + token`）。
 * 2. `dsh-mobile://pair?token=…&base=候选1,候选2` —— 移动端专用形态
 *    （同包 `lib/links.mjs` 的 `buildPairLink`），`base` 是**地址候选列表**。
 *
 * 两种形态都带一次性令牌；**没有任何手输令牌的入口**（spec #55「配对」）。
 *
 * 解析是纯函数（不碰 Android API），因此可在 JVM 单元测试里直接验。
 */
data class PairLink(
    /** 一次性令牌。 */
    val token: String,
    /** 地址候选列表（按优先级）。 */
    val candidates: List<String>,
    /** 链接里带的显示名（桌面端当前不带，留给将来的扩展）。 */
    val displayName: String? = null,
) {

    /** 首选地址。 */
    val origin: String get() = candidates.first()

    companion object {

        /** 移动端专用 scheme。 */
        const val MOBILE_SCHEME = "dsh-mobile"

        /**
         * 解析配对链接；无法识别时返回 null。
         */
        fun parse(raw: String): PairLink? {
            val text = raw.trim()
            if (text.isEmpty()) return null
            val uri = try {
                URI(text)
            } catch (_: Exception) {
                return null
            }
            val scheme = uri.scheme?.lowercase() ?: return null
            val query = parseQuery(uri.rawQuery)
            val token = query["token"]?.trim().orEmpty()
            if (token.isEmpty()) return null

            return when (scheme) {
                MOBILE_SCHEME -> {
                    val candidates = splitCandidates(query["base"] ?: query["origin"].orEmpty())
                    if (candidates.isEmpty()) null else PairLink(token, candidates, query["name"])
                }
                "http", "https" -> {
                    if (!isPairingPath(uri.path.orEmpty())) return null
                    val origin = originOf(uri) ?: return null
                    // 链接自带的 base 参数是权威的候选列表（.local + 多网卡 IP，桌面端用
                    // buildHttpPairLink 下发）；链接自身的 origin 也并进来（老链接没有 base）。
                    val candidates = splitCandidates(query["base"] ?: "")
                    if (!candidates.contains(origin)) {
                        candidates.add(0, origin)
                    }
                    PairLink(token, candidates, query["name"])
                }
                else -> null
            }
        }

        /** 配对入口路径：裸 `/pair`（桌面端形态）或保留命名空间下的 `/pair`。 */
        private fun isPairingPath(path: String): Boolean {
            val clean = path.trimEnd('/')
            if (clean.isEmpty()) return true
            return clean.endsWith("/pair")
        }

        /** 由 URI 取出 origin（scheme://host[:port]）。 */
        private fun originOf(uri: URI): String? {
            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val port = if (uri.port > 0) ":${uri.port}" else ""
            return "${uri.scheme.lowercase()}://$host$port"
        }

        /** 拆候选列表并逐个归一化。 */
        private fun splitCandidates(raw: String): MutableList<String> =
            raw.split(',')
                .mapNotNull { normalizeOrigin(it) }
                .distinct()
                .toMutableList()
        /**
         * 归一化一个地址：补协议头、去尾斜杠。
         *
         * 桌面端给的 base 形态是 `主机:端口`（无协议），故缺协议时按 http 补齐。
         */
        private fun normalizeOrigin(raw: String): String? {
            val text = raw.trim().trimEnd('/')
            if (text.isEmpty()) return null
            val withScheme = if (text.contains("://")) text else "http://$text"
            val uri = try {
                URI(withScheme)
            } catch (_: Exception) {
                return null
            }
            val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
            val port = if (uri.port > 0) ":${uri.port}" else ""
            return "${uri.scheme.lowercase()}://$host$port"
        }

        /** 解析查询串（不做 + → 空格 的替换：令牌与地址里没有空格）。 */
        private fun parseQuery(raw: String?): Map<String, String> {
            if (raw.isNullOrBlank()) return emptyMap()
            val result = LinkedHashMap<String, String>()
            raw.split('&').forEach { pair ->
                if (pair.isEmpty()) return@forEach
                val index = pair.indexOf('=')
                if (index <= 0) return@forEach
                val name = decode(pair.substring(0, index))
                val value = decode(pair.substring(index + 1))
                if (name.isNotEmpty()) result[name] = value
            }
            return result
        }

        private fun decode(value: String): String = try {
            URLDecoder.decode(value, "UTF-8")
        } catch (_: Exception) {
            value
        }
    }
}
