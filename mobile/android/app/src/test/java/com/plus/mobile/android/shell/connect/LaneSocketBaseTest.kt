package com.plus.mobile.android.shell.connect

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.URI

/**
 * 页面直连 lane 的 WS base 的单元测试。
 *
 * base 的形状是死的（纯计算，不碰 Android API），因此能在 JVM 上直接验。
 * 末尾斜杠那条尤其要锁死：页面用 `new URL('api/remote.mux', base)` 相对解析，
 * 少了斜杠 `__dsh_ws/<令牌>` 整段会被当成文件名吃掉（令牌也一并丢失）。
 */
class LaneSocketBaseTest {

    @Test
    fun `http 形态的 lane 换成 ws 并带上令牌段`() {
        assertEquals(
            "ws://192.168.3.90:3093/__dsh_ws/tok-1/",
            LaneSocketBase.baseUrl("http://192.168.3.90:3093", "tok-1"),
        )
    }

    @Test
    fun `https 形态的 lane 换成 wss`() {
        assertEquals(
            "wss://dsh-4f2e.cpolar.io/__dsh_ws/tok-2/",
            LaneSocketBase.baseUrl("https://dsh-4f2e.cpolar.io", "tok-2"),
        )
    }

    @Test
    fun `lane 地址末尾的斜杠不会带进 base`() {
        assertEquals(
            "ws://10.0.2.2:3093/__dsh_ws/tok-3/",
            LaneSocketBase.baseUrl("http://10.0.2.2:3093/", "tok-3"),
        )
    }

    @Test
    fun `按页面的相对解析方式 mux 路径仍落在令牌段之后`() {
        // 这里用 URI.resolve 复刻页面的 new URL('api/remote.mux', base)：
        // base 少了末尾斜杠时，解析结果会把 __dsh_ws/<令牌> 当成文件名丢掉。
        val base = LaneSocketBase.baseUrl("http://192.168.3.90:3093", "tok-4")
        assertEquals(
            "ws://192.168.3.90:3093/__dsh_ws/tok-4/api/remote.mux",
            URI(base).resolve("api/remote.mux").toString(),
        )
    }
}
