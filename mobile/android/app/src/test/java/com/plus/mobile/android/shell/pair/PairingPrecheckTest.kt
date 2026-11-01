package com.plus.mobile.android.shell.pair

import com.plus.mobile.android.shell.connect.ReachabilityProbe
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.host.HostRegistry
import com.plus.mobile.android.shell.host.HostStatus
import com.plus.mobile.android.shell.net.LaneHttpClient
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.ServerSocket

/**
 * 记 accept 调用次数的假客户端。
 *
 * 契约（code-review P6）：**配对前先探测，不把凭证发给不可达目标**——
 * 所以「目标不可达」时 accept 一次都不该被调用。
 */
private class SpyPairingClient : LanePairingClient(LaneHttpClient()) {
    /** accept 被调用的次数。 */
    var acceptCalls: Int = 0
    /** accept 被调用时收到的令牌（用来核对凭证有没有外流）。 */
    val acceptedTokens: MutableList<String> = mutableListOf()

    override suspend fun accept(
        origin: String,
        token: String,
        deviceName: String,
    ): LanePairingClient.AcceptOutcome {
        acceptCalls += 1
        acceptedTokens.add(token)
        return LanePairingClient.AcceptOutcome.Unreachable("不应被调用")
    }
}

/** 内存主机仓库（不碰 Keystore）。 */
private class MemoryHostRegistry : HostRegistry {
    private val hosts = linkedMapOf<String, HostEntry>()
    private var currentId: String? = null

    override fun list(): List<HostEntry> = hosts.values.toList()

    override fun current(): HostEntry? = currentId?.let { hosts[it] } ?: hosts.values.firstOrNull()

    override fun find(id: String): HostEntry? = hosts[id]

    override fun setCurrent(id: String) {
        if (hosts.containsKey(id)) currentId = id
    }

    override fun upsert(host: HostEntry) {
        hosts[host.id] = host
    }

    override fun remove(id: String) {
        hosts.remove(id)
        if (currentId == id) currentId = null
    }

    override fun markStatus(id: String, status: HostStatus, reason: String?) {
        hosts[id]?.let { hosts[id] = it.copy(status = status, statusReason = reason) }
    }

    override fun markLatency(id: String, latencyMs: Int?) {
        hosts[id]?.let { hosts[id] = it.copy(latencyMs = latencyMs) }
    }
}

/**
 * 配对前的无凭证可达性预检（code-review P6）。
 *
 * 契约：粘贴链接 / 扫码解析出的链接在 accept **之前**先探一次目标；
 * 探不通就停在入口态报错，**不发送 accept、不发送凭证**。
 */
class PairingPrecheckTest {

    @Test
    fun `目标不可达时不发 accept（凭证不外流）`() = runBlocking {
        val port = closedLocalPort()
        val spy = SpyPairingClient()
        val service = PairingService(MemoryHostRegistry(), spy, ReachabilityProbe(timeoutMs = 500))

        val link = PairLink.parse("http://127.0.0.1:$port/pair?token=secret-token")
        assertNotNull(link)
        val outcome = service.pair(link!!)

        assertEquals("accept 不该被调用", 0, spy.acceptCalls)
        assertTrue("令牌不该外流", spy.acceptedTokens.isEmpty())
        assertEquals(PairingService.PairOutcome.Failed(PairFailure.UNREACHABLE), outcome)
    }

    @Test
    fun `目标可达时照常走 accept`() = runBlocking {
        // 起一个只监听不响应的本地端口：TCP 连得上（预检通过），HTTP 不通。
        ServerSocket(0).use { listener ->
            val spy = SpyPairingClient()
            val service = PairingService(MemoryHostRegistry(), spy, ReachabilityProbe(timeoutMs = 500))

            val link = PairLink.parse("http://127.0.0.1:${listener.localPort}/pair?token=t")
            assertNotNull(link)
            service.pair(link!!)

            assertEquals("预检通过后应当调用 accept", 1, spy.acceptCalls)
        }
    }

    @Test
    fun `地址解析不出来时按不可达处理`() {
        assertNull(ReachabilityProbe.endpointOf(""))
        assertNull(ReachabilityProbe.endpointOf("http://"))
        assertNull(ReachabilityProbe.endpointOf("http://host:not-a-port"))
    }

    @Test
    fun `origin 拆出主机名与端口`() {
        val lan = ReachabilityProbe.endpointOf("http://192.168.3.90:3093")!!
        assertEquals("192.168.3.90", lan.host)
        assertEquals(3093, lan.port)
        // 缺省端口按 scheme 补。
        assertEquals(443, ReachabilityProbe.endpointOf("https://dsh-4f2e.cpolar.io")!!.port)
        assertEquals(80, ReachabilityProbe.endpointOf("http://dsh-4f2e.cpolar.io")!!.port)
        // 路径 / 查询串不参与连接终点。
        assertEquals(3093, ReachabilityProbe.endpointOf("http://192.168.3.90:3093/pair?token=t")!!.port)
    }

    /** 找一个当前没人监听的本地端口（先占再放）。 */
    private fun closedLocalPort(): Int = ServerSocket(0).use { it.localPort }
}
