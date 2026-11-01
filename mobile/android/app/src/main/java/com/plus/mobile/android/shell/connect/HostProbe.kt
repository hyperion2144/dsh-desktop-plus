package com.plus.mobile.android.shell.connect

import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.net.LaneRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 主机探测：往返延迟与可达性。
 *
 * 探测打的是 lane 控制面的状态端点（`/__dsh-mobile/pair`）：**不需要凭证**、响应极小，
 * 因此可以随时探，不打扰主机也不泄露任何东西。
 */
class HostProbe(private val client: LaneHttpClient) {

    /**
     * 测一次往返延迟（毫秒）；不可达时返回 null。
     */
    suspend fun latency(origin: String): Int? = withContext(Dispatchers.IO) {
        val url = origin.trimEnd('/') + ShellSettings.LANE_PREFIX + "/pair"
        val started = System.nanoTime()
        try {
            client.open(LaneRequest(url = url, method = "GET")).use { response ->
                response.stream.readBytes()
                val elapsed = (System.nanoTime() - started) / 1_000_000
                if (response.status in 200..299) elapsed.toInt() else null
            }
        } catch (_: Exception) {
            null
        }
    }
}
