package com.plus.mobile.android.shell.discovery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 广播记录 → 发现项的装配。
 *
 * 记录形态取自桌面侧 `packages/plus/desktop-remote-access/lib/mdns.mjs` 的
 * `buildLaneTxt`（票 #57）：TXT 里只有「在哪」类事实——主机名、端口、配对入口路径。
 */
class LaneDiscoveryMapperTest {

    @Test
    fun `装配：名称与候选地址以解析出的 IP 为准`() {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = "DSH Desktop Plus - mac-mini",
                ip = "192.168.1.23",
                port = 3093,
                attributes = mapOf(
                    "host" to "mac-mini.local",
                    "port" to "3093",
                    "path" to "/pair",
                ),
            ),
        )
        assertEquals("DSH Desktop Plus - mac-mini", host?.label)
        assertEquals("http://192.168.1.23:3093", host?.origin)
        assertEquals("192.168.1.23:3093", host?.displayAddress)
        assertEquals("mac-mini.local", host?.host)
        assertEquals("/pair", host?.path)
    }

    @Test
    fun `装配：实例名带服务类型后缀时只取前半段`() {
        assertEquals(
            "DSH Desktop Plus - mac-mini",
            LaneDiscoveryMapper.displayLabel("DSH Desktop Plus - mac-mini._dsh-lane._tcp."),
        )
        assertEquals(
            "DSH Desktop Plus - mac-mini",
            LaneDiscoveryMapper.displayLabel("DSH Desktop Plus - mac-mini"),
        )
    }

    @Test
    fun `装配：解析不出 IP 的记录一律跳过（不用主机名拼地址）`() {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = "DSH Desktop Plus - mac-mini",
                ip = null,
                port = 3093,
                attributes = mapOf("host" to "mac-mini.local"),
            ),
        )
        assertNull(host)
    }

    @Test
    fun `装配：端口缺失时回退到 TXT 里的端口`() {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = "DSH Desktop Plus - mac-mini",
                ip = "192.168.1.23",
                port = 0,
                attributes = mapOf("port" to "3093"),
            ),
        )
        assertEquals(3093, host?.port)
        assertEquals("http://192.168.1.23:3093", host?.origin)
    }

    @Test
    fun `装配：既没有端口也没有 TXT 端口时跳过`() {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = "DSH Desktop Plus - mac-mini",
                ip = "192.168.1.23",
                port = 0,
                attributes = emptyMap(),
            ),
        )
        assertNull(host)
    }

    @Test
    fun `装配：配对入口路径缺省为 pair`() {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = "DSH Desktop Plus - mac-mini",
                ip = "192.168.1.23",
                port = 3093,
                attributes = emptyMap(),
            ),
        )
        assertEquals(LaneDiscoveryMapper.DEFAULT_PAIR_PATH, host?.path)
        assertNull(host?.host)
    }

    @Test
    fun `服务类型：与桌面广播一致`() {
        assertEquals("_dsh-lane._tcp", LaneDiscoveryMapper.LANE_SERVICE_TYPE)
        assertEquals("_dsh-lane._tcp.", LaneDiscoveryMapper.LANE_SERVICE_TYPE_QUERY)
    }
}
