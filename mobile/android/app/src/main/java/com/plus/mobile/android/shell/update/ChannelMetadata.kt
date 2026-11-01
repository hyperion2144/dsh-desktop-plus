package com.plus.mobile.android.shell.update

/** channel 元数据不合法（缺字段 / 值不成形）。 */
class ChannelMetadataException(message: String) : IllegalArgumentException(message)

/**
 * 移动端更新元数据里的一个产物条目。
 *
 * `url` 是**文件名**而不是完整 URL——客户端相对 feed 根拼接（与桌面 channel yml 一致）。
 */
data class ChannelFile(
    val url: String,
    val sha512: String,
    val size: Long,
)

/**
 * 移动端 channel 元数据（与桌面 channel yml 逐字同形）。
 *
 * 键结构固定（由 `scripts/plus/mobile-metadata.mjs` 的 `renderChannelMetadata` 生成）：
 *
 * ```
 * version: <plus 版本>
 * files:
 *   - url: <产物文件名>
 *     sha512: <产物 sha512（base64）>
 *     size: <产物流字节数>
 * path: <产物文件名>
 * sha512: <产物 sha512（base64）>
 * releaseDate: '<ISO 时间>'
 * ```
 *
 * 元数据里**不含**移动端自己的安装版本号（versionCode）：它由 plus 版本经
 * [MobileVersion] 的公式确定性推出，客户端本地算即可。
 */
data class ChannelMetadata(
    val version: String,
    val files: List<ChannelFile>,
    val path: String,
    val sha512: String,
    val releaseDate: String,
) {
    /** 移动端 feed 只发一个平台产物；取第一个。 */
    val file: ChannelFile? get() = files.firstOrNull()
}

/**
 * channel yml 的轻量解析器。
 *
 * ## 为什么自己解析而不上 yaml 库
 *
 * 元数据的键结构是**固定的**（见 [ChannelMetadata]），几百字节的文件，
 * 为它引入一个 YAML 依赖不划算：壳的依赖面越小，APK 越小、攻击面越小。
 * 解析器只认上面那五个键，其余行（注释、空行、未知键）一律忽略。
 *
 * 纯函数（不碰 Android API），因此可在 JVM 单元测试里直接验。
 */
object ChannelMetadataParser {

    /**
     * 解析 channel yml 文本。
     *
     * @throws ChannelMetadataException 缺关键字段或值不成形
     */
    fun parse(text: String): ChannelMetadata {
        var version: String? = null
        var path: String? = null
        var sha512: String? = null
        var releaseDate: String? = null
        val files = mutableListOf<ChannelFile>()

        var inFiles = false
        var currentUrl: String? = null
        var currentSha512: String? = null
        var currentSize: Long? = null

        fun flushFile() {
            val url = currentUrl
            if (url != null) {
                files.add(
                    ChannelFile(
                        url = url,
                        sha512 = currentSha512.orEmpty(),
                        size = currentSize ?: 0L,
                    ),
                )
            }
            currentUrl = null
            currentSha512 = null
            currentSize = null
        }
        text.lineSequence().forEach { rawLine ->
            val line = rawLine.trim()
            if (line.isEmpty() || line.startsWith("#")) return@forEach

            // 缩进决定层级：顶格是顶层键（`files` 列表到此结束），缩进的是列表项或列表项的属性。
            val indented = rawLine.firstOrNull()?.isWhitespace() == true
            if (!indented) {
                inFiles = false
                val (key, value) = splitEntry(line)
                when (key) {
                    "version" -> version = value
                    "files" -> inFiles = true
                    "path" -> path = value
                    "sha512" -> sha512 = value
                    "releaseDate" -> releaseDate = value
                    else -> Unit
                }
                return@forEach
            }

            if (!inFiles) return@forEach
            if (line.startsWith("- ")) {
                // 新列表项：`  - url: …`
                flushFile()
                val (key, value) = splitEntry(line.removePrefix("- ").trim())
                when (key) {
                    "url" -> currentUrl = value
                    "sha512" -> currentSha512 = value
                    "size" -> currentSize = parseSize(value)
                    else -> Unit
                }
                return@forEach
            }
            // 列表项的后续属性：`    sha512: …`
            val (key, value) = splitEntry(line)
            if (currentUrl != null) {
                when (key) {
                    "url" -> currentUrl = value
                    "sha512" -> currentSha512 = value
                    "size" -> currentSize = parseSize(value)
                    else -> Unit
                }
            }
        }
        flushFile()

        val resolvedVersion = version?.takeIf { it.isNotBlank() }
            ?: throw ChannelMetadataException("channel metadata: missing version")
        val resolvedPath = path?.takeIf { it.isNotBlank() }
            ?: throw ChannelMetadataException("channel metadata: missing path")
        if (files.isEmpty()) {
            throw ChannelMetadataException("channel metadata: missing files")
        }
        return ChannelMetadata(
            version = resolvedVersion,
            files = files,
            path = resolvedPath,
            sha512 = sha512.orEmpty(),
            releaseDate = releaseDate.orEmpty(),
        )
    }

    /** 拆 `key: value`；值两侧的引号剥掉（releaseDate 一定是带引号的 ISO 串）。 */
    private fun splitEntry(line: String): Pair<String, String> {
        val index = line.indexOf(':')
        if (index <= 0) {
            throw ChannelMetadataException("channel metadata: malformed line \"$line\"")
        }
        val key = line.substring(0, index).trim()
        val value = line.substring(index + 1).trim()
        return key to unquote(value)
    }

    private fun unquote(value: String): String {
        if (value.length >= 2) {
            val first = value.first()
            val last = value.last()
            if ((first == '\'' && last == '\'') || (first == '"' && last == '"')) {
                return value.substring(1, value.length - 1)
            }
        }
        return value
    }

    private fun parseSize(value: String): Long = value.toLongOrNull()
        ?: throw ChannelMetadataException("channel metadata: size is not a number: $value")
}
