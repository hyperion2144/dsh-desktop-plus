package com.plus.mobile.android.shell.update

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * 移动端更新 feed 的地址规则。
 *
 * 元数据里的 `files[].url` 是**文件名**，产物 URL 相对 feed 所在目录拼接
 * （与桌面 channel feed 同一套约定）。
 */
object UpdateFeed {

    /**
     * 默认 feed：GitHub Release 上的移动端 channel 元数据。
     *
     * 走的是 Release 资产直链（`releases/latest/download/…`），**不走 api.github.com**——
     * 后者有 60 次/小时的额度池，启动检查不能消耗它（与桌面同一策略）。
     */
    const val DEFAULT_FEED_URL =
        "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-android.yml"

    /** feed 所在目录（产物 URL 相对它拼接）。 */
    fun baseDirOf(feedUrl: String): String {
        val url = feedUrl.trim()
        val index = url.lastIndexOf('/')
        return if (index <= 0) url else url.substring(0, index)
    }

    /** 产物的完整 URL。 */
    fun artifactUrl(feedUrl: String, fileName: String): String =
        "${baseDirOf(feedUrl).trimEnd('/')}/${fileName.trimStart('/')}"
}

/**
 * 拉取并解析移动端更新元数据。
 *
 * ## 静默降级
 *
 * 拉取失败（没网、超时、HTTP 错误、元数据不成形）一律抛 [IOException] / [ChannelMetadataException]，
 * 由调用方（[UpdateCoordinator]）吞掉并只记日志——**更新检查永远不阻塞启动**。
 *
 * ## 本地 override
 *
 * feed 地址由构造参数提供，验证时可指向本地 http 服务（`-PupdateFeedUrl=…` 或运行时偏好），
 * 生产默认是 [UpdateFeed.DEFAULT_FEED_URL]。
 */
class UpdateFeedClient(
    /** 当前生效的 feed 地址（可被本地 override 换掉）。 */
    private val feedUrlProvider: () -> String,
    private val connectTimeoutMs: Int = 8_000,
    private val readTimeoutMs: Int = 10_000,
) {

    /** 当前 feed 地址。 */
    val feedUrl: String get() = feedUrlProvider()

    /**
     * 拉取元数据并解析。
     *
     * @throws IOException 网络层失败（没网 / 超时 / 非 2xx）
     * @throws ChannelMetadataException 元数据不成形
     */
    fun fetch(): ChannelMetadata {
        val url = feedUrl
        val body = readText(url)
        return ChannelMetadataParser.parse(body)
    }

    /** 产物的完整 URL（相对当前 feed）。 */
    fun artifactUrl(fileName: String): String = UpdateFeed.artifactUrl(feedUrl, fileName)

    private fun readText(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            instanceFollowRedirects = true
            setRequestProperty("Accept", "text/yaml, text/plain, */*")
            setRequestProperty("User-Agent", "dsh-mobile-android")
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IOException("更新源请求失败：HTTP $code（$url）")
            }
            return connection.inputStream.use { readLimited(it, MAX_FEED_BYTES) }
        } finally {
            connection.disconnect()
        }
    }

    /** 读文本但有上限：元数据只有几百字节，超过上限说明地址指错了东西。 */
    private fun readLimited(stream: InputStream, limit: Int): String {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = stream.read(chunk)
            if (read <= 0) break
            total += read
            if (total > limit) throw IOException("更新源内容超过上限（$limit 字节）")
            buffer.write(chunk, 0, read)
        }
        return buffer.toString(Charsets.UTF_8.name())
    }

    private companion object {

        /** 元数据上限 256 KiB。 */
        const val MAX_FEED_BYTES = 256 * 1024
    }
}

