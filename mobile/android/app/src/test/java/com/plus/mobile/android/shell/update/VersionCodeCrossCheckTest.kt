package com.plus.mobile.android.shell.update

import com.plus.mobile.android.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 构建期版本号与运行时推导的**对拍**。
 *
 * 安装版本号（`versionCode`）在构建脚本里由 plus 版本推导（`app/build.gradle.kts`），
 * 运行时另有一份 Kotlin 实现（[MobileVersion]）——两份实现必须推出同一个值。
 *
 * 这个测试就是那道闸：构建脚本改了公式而 Kotlin 侧没改（或反过来），这里立刻红。
 */
class VersionCodeCrossCheckTest {

    @Test
    fun `构建期的 versionCode 等于运行时按同一套公式推出的值`() {
        assertEquals(
            MobileVersion.versionCode(BuildConfig.VERSION_NAME),
            BuildConfig.VERSION_CODE,
        )
    }

    @Test
    fun `默认版本的安装版本号是 20200201（与 node 侧单测同值）`() {
        // node 侧：mobileVersionCode('0.2.2-alpha.2.plus.1') === 20200201
        assertEquals(20200201, MobileVersion.versionCode("0.2.2-alpha.2.plus.1"))
    }

    @Test
    fun `构建期写入的更新源不是空串`() {
        assert(UpdateConfig.FEED_URL.isNotBlank())
    }
}

/** 构建期常量（测试用镜像）。 */
internal object UpdateConfig {
    val FEED_URL: String = BuildConfig.UPDATE_FEED_URL
}
