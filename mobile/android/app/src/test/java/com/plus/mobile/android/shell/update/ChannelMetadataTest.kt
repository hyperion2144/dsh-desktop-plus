package com.plus.mobile.android.shell.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.util.Base64

/**
 * channel yml 的解析。
 *
 * 元数据文本取自 node 侧生成器 `scripts/plus/mobile-metadata.mjs` 的 `renderChannelMetadata`
 * （票 #58）产出的**逐字形态**——客户端解析的就是发版流水线写出的那份文件。
 */
class ChannelMetadataTest {

    private val sha512 = Base64.getEncoder().encodeToString(ByteArray(64) { 0x11 })

    private val androidMetadata = listOf(
        "version: 0.2.2-alpha.2.plus.1",
        "files:",
        "  - url: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk",
        "    sha512: $sha512",
        "    size: 12345678",
        "path: dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk",
        "sha512: $sha512",
        "releaseDate: '2026-10-31T12:24:24.528Z'",
        "",
    ).joinToString("\n")

    @Test
    fun `解析：字段与桌面 channel yml 同形`() {
        val metadata = ChannelMetadataParser.parse(androidMetadata)
        assertEquals("0.2.2-alpha.2.plus.1", metadata.version)
        assertEquals("dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk", metadata.path)
        assertEquals(sha512, metadata.sha512)
        assertEquals("2026-10-31T12:24:24.528Z", metadata.releaseDate)
        assertEquals(1, metadata.files.size)
        val file = metadata.files.first()
        assertEquals("dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk", file.url)
        assertEquals(sha512, file.sha512)
        assertEquals(12345678L, file.size)
    }

    @Test
    fun `解析：元数据里的版本能推出移动端安装版本号（客户端本地算即可）`() {
        val metadata = ChannelMetadataParser.parse(androidMetadata)
        assertEquals(20200201, MobileVersion.versionCode(metadata.version))
    }

    @Test
    fun `解析：注释与空行不影响结果`() {
        val text = "# 由发版流水线生成\n\n" + androidMetadata
        val metadata = ChannelMetadataParser.parse(text)
        assertEquals("0.2.2-alpha.2.plus.1", metadata.version)
    }

    @Test
    fun `解析：缺关键字段一律拒绝`() {
        assertNotNull(runCatching { ChannelMetadataParser.parse("files:\n  - url: a.apk\n") }.exceptionOrNull())
        assertNotNull(runCatching { ChannelMetadataParser.parse("version: 0.2.2-alpha.2.plus.1\n") }.exceptionOrNull())
        assertNotNull(
            runCatching {
                ChannelMetadataParser.parse(
                    "version: 0.2.2-alpha.2.plus.1\nfiles:\n  - url: a.apk\n    size: abc\n",
                )
            }.exceptionOrNull(),
        )
    }

    @Test
    fun `产物 URL：相对 feed 根拼接（与桌面同一套约定）`() {
        val feed = "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-android.yml"
        assertEquals(
            "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download",
            UpdateFeed.baseDirOf(feed),
        )
        assertEquals(
            "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk",
            UpdateFeed.artifactUrl(feed, "dsh-desktop-plus-mobile-0.2.2-alpha.2.plus.1-android.apk"),
        )
        // 本地 override（验证用）同样按目录拼接。
        assertEquals(
            "http://10.0.2.2:8765/app.apk",
            UpdateFeed.artifactUrl("http://10.0.2.2:8765/nightly-android.yml", "app.apk"),
        )
    }
}
