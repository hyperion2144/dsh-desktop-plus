package com.plus.mobile.android.shell.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 版本推导与比较的**跨实现测试向量**。
 *
 * 这里的每一个数值都取自 node 侧事实源的单测
 * `scripts/plus/test/mobile-version.test.mjs`（票 #58）——
 * 同一组输入，两侧必须推出同一个值、拒绝同一批非法输入。
 *
 * 改了公式就改了两边；只改一边，这组向量立刻红。
 */
class MobileVersionTest {

    @Test
    fun `解析：拆出 base 与预发布与 plus 计数`() {
        assertEquals(
            MobileVersion.PlusVersion(
                major = 0,
                minor = 2,
                patch = 2,
                prerelease = MobileVersion.Prerelease(label = "alpha", rank = 0, index = 2),
                plus = 9,
                level = 2,
            ),
            MobileVersion.parse("0.2.2-alpha.2.plus.9"),
        )
        // GitHub tag 带 `v` 前缀，比较前先剥掉。
        assertEquals(
            MobileVersion.parse("0.2.2-alpha.2.plus.9"),
            MobileVersion.parse("v0.2.2-alpha.2.plus.9"),
        )
        // 正式版 base（上游不再带 prerelease）：level 取正式版档位 999。
        assertEquals(
            MobileVersion.PlusVersion(
                major = 0,
                minor = 2,
                patch = 2,
                prerelease = null,
                plus = 3,
                level = 999,
            ),
            MobileVersion.parse("0.2.2.plus.3"),
        )
        assertEquals(0, MobileVersion.parse("0.2.2").plus)
    }

    @Test
    fun `解析：拒绝非法输入`() {
        assertThrows { MobileVersion.parse("") }
        assertThrows { MobileVersion.parse("0.2.2-alpha") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.2.3") }
        assertThrows { MobileVersion.parse("0.2.2-preview.1") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.2.plus.010") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.2.plus.0") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.2+plus.9") }
    }

    @Test
    fun `安装版本号：确定性`() {
        assertEquals(20200209, MobileVersion.versionCode("0.2.2-alpha.2.plus.9"))
        assertEquals(
            MobileVersion.versionCode("0.2.2-alpha.2.plus.9"),
            MobileVersion.versionCode("0.2.2-alpha.2.plus.9"),
        )
        assertEquals(20200209, MobileVersion.versionCode("v0.2.2-alpha.2.plus.9"))
    }

    @Test
    fun `安装版本号：plus 计数进位只动最低位（不是字典序）`() {
        val nine = MobileVersion.versionCode("0.2.2-alpha.2.plus.9")
        val ten = MobileVersion.versionCode("0.2.2-alpha.2.plus.10")
        assertEquals(20200210, ten)
        assertTrue("plus.10 必须大于 plus.9", ten > nine)
    }

    @Test
    fun `安装版本号：预发布层级单调（跨上游 alpha）`() {
        val chain = listOf(
            "0.2.2-alpha.2.plus.9",
            "0.2.2-alpha.2.plus.10",
            "0.2.2-alpha.3.plus.1",
            "0.2.2-alpha.3.plus.2",
            "0.2.2.plus.1",
            "0.2.3-alpha.1.plus.1",
            "0.3.0-alpha.1.plus.1",
        )
        val codes = chain.map { MobileVersion.versionCode(it) }
        for (index in 1 until codes.size) {
            assertTrue(
                "${chain[index]} 的构建号必须大于 ${chain[index - 1]}",
                codes[index] > codes[index - 1],
            )
        }
        assertEquals(
            listOf(20200209, 20200210, 20200301, 20200302, 20299901, 20300101, 30000101),
            codes,
        )
    }

    @Test
    fun `安装版本号：始终在 Android 安装上限之内`() {
        assertTrue(MobileVersion.versionCode("0.2.2-alpha.2.plus.9") < MobileVersion.ANDROID_MAX_VERSION_CODE)
        assertTrue(MobileVersion.versionCode("9.9.99-alpha.2.plus.99") < MobileVersion.ANDROID_MAX_VERSION_CODE)
    }

    @Test
    fun `iOS 形态：1 到 3 段点分整数且与版本号同序`() {
        assertEquals("0.2.200209", MobileVersion.bundleVersion("0.2.2-alpha.2.plus.9"))
        val chain = listOf(
            "0.2.2-alpha.2.plus.9",
            "0.2.2-alpha.2.plus.10",
            "0.2.2-alpha.3.plus.1",
            "0.2.2.plus.1",
            "0.2.3-alpha.1.plus.1",
            "0.3.0-alpha.1.plus.1",
        )
        val parts = chain.map { MobileVersion.bundleVersion(it).split('.').map { part -> part.toInt() } }
        for (index in 1 until parts.size) {
            assertTrue(
                "${chain[index]} 的 CFBundleVersion 必须大于 ${chain[index - 1]}",
                compareParts(parts[index], parts[index - 1]) > 0,
            )
        }
    }

    @Test
    fun `比较：SemVer 优先级`() {
        assertTrue(MobileVersion.compare("0.2.2-alpha.2.plus.9", "0.2.2-alpha.2.plus.10") < 0)
        assertTrue(MobileVersion.compare("0.2.2-alpha.2.plus.10", "0.2.2-alpha.3") < 0)
        assertTrue(MobileVersion.compare("0.2.2-alpha.3", "0.2.2") < 0)
        assertEquals(0, MobileVersion.compare("0.2.2-alpha.2.plus.9", "0.2.2-alpha.2.plus.9"))
        assertTrue(MobileVersion.isNewer("0.2.2-alpha.2.plus.2", "0.2.2-alpha.2.plus.1"))
        assertTrue(!MobileVersion.isNewer("0.2.2-alpha.2.plus.1", "0.2.2-alpha.2.plus.2"))
    }

    @Test
    fun `已知坑一：plus 计数不能补零`() {
        assertThrows { MobileVersion.parse("0.2.2-alpha.2.plus.010") }
        assertThrows { MobileVersion.compare("0.2.2-alpha.2.plus.010", "0.2.2-alpha.2.plus.9") }
    }

    @Test
    fun `已知坑二：plus 计数不能挪进构建元数据段`() {
        // 挪到 `+` 之后，SemVer 认为两个版本相等——更新判定会直接失效。
        assertThrows { MobileVersion.parse("0.2.2-alpha.2+plus.10") }
        assertThrows { MobileVersion.compare("0.2.2-alpha.2+plus.10", "0.2.2-alpha.2+plus.9") }
    }

    @Test
    fun `预发布标签表：稠密、无重复，且在推导公式的容量之内`() {
        assertEquals(MobileVersion.PRERELEASE_LABELS.size, MobileVersion.PRERELEASE_LABELS.toSet().size)
        assertTrue(
            "标签序号最多 9 个（level = 序号×100 + 预发布序号，要留得下正式版的 999）",
            MobileVersion.PRERELEASE_LABELS.size <= 9,
        )
        for (label in MobileVersion.PRERELEASE_LABELS) {
            val parsed = MobileVersion.parse("0.2.2-$label.1.plus.1")
            assertNotNull(parsed.prerelease)
            assertEquals(label, parsed.prerelease?.label)
        }
    }

    @Test
    fun `比较：数字标识符按数值比，数字低于字母数字`() {
        // SemVer §11：数字标识符的优先级低于字母数字标识符。
        assertTrue(MobileVersion.compare("1.0.0-1", "1.0.0-alpha") < 0)
        assertTrue(MobileVersion.compare("1.0.0-2", "1.0.0-11") < 0)
        assertTrue(MobileVersion.compare("1.0.0-alpha", "1.0.0-alpha.1") < 0)
    }

    @Test
    fun `比较：非法版本一律拒绝`() {
        assertThrows { MobileVersion.compare("1.2", "1.2.3") }
        assertThrows { MobileVersion.compare("1.2.3-01", "1.2.3") }
        assertNull(null)
    }

    @Test
    fun `跨实现向量：正式版 base 加 plus 计数与各字段上界`() {
        // 这组数值取自共享向量 scripts/plus/test/mobile-version.vectors.json：
        // node / Kotlin / Swift / ArkTS 四端跑的是同一份，推导结果必须逐字相同。
        val stablePlus = MobileVersion.parse("0.2.2.plus.3")
        assertNull(stablePlus.prerelease)
        assertEquals(3, stablePlus.plus)
        assertEquals(999, stablePlus.level)
        assertEquals(20299903, MobileVersion.versionCode("0.2.2.plus.3"))
        assertEquals("0.2.299903", MobileVersion.bundleVersion("0.2.2.plus.3"))

        assertEquals(20299900, MobileVersion.versionCode("0.2.2"))
        assertEquals("0.2.299900", MobileVersion.bundleVersion("0.2.2"))

        assertEquals(101, MobileVersion.parse("0.2.2-beta.1.plus.1").level)
        assertEquals(20210101, MobileVersion.versionCode("0.2.2-beta.1.plus.1"))
        assertEquals("0.2.210101", MobileVersion.bundleVersion("0.2.2-beta.1.plus.1"))

        assertEquals(208, MobileVersion.parse("0.2.2-rc.8.plus.99").level)
        assertEquals(20220899, MobileVersion.versionCode("0.2.2-rc.8.plus.99"))
        assertEquals("0.2.220899", MobileVersion.bundleVersion("0.2.2-rc.8.plus.99"))

        assertEquals(999920899, MobileVersion.versionCode("9.9.99-rc.8.plus.99"))
        assertEquals("9.9.9920899", MobileVersion.bundleVersion("9.9.99-rc.8.plus.99"))

        // 字段上界与前导零：一律拒绝（与 node / Swift / ArkTS 同规则）。
        assertThrows { MobileVersion.parse("02.2.2") }
        assertThrows { MobileVersion.parse("0.02.2") }
        assertThrows { MobileVersion.parse("0.2.02") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.02") }
        assertThrows { MobileVersion.parse("10.2.2") }
        assertThrows { MobileVersion.parse("0.10.2") }
        assertThrows { MobileVersion.parse("0.2.100") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.100") }
        assertThrows { MobileVersion.parse("0.2.2-alpha.2.plus.100") }
    }

    private fun compareParts(left: List<Int>, right: List<Int>): Int {
        for (index in 0 until minOf(left.size, right.size)) {
            if (left[index] != right[index]) return left[index] - right[index]
        }
        return left.size - right.size
    }

    private fun assertThrows(block: () -> Unit) {
        val error = runCatching { block() }.exceptionOrNull()
        assertNotNull("该输入必须被拒绝", error)
    }
}
