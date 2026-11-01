package com.plus.mobile.android.shell.boot

import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.net.LaneRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** 引导载荷装载失败（主机不可达 / 页面不像 dsh 页面）。 */
open class BootPayloadException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * 主机不可达（网络层失败）。
 *
 * 与 [HostGateException] 分开：门禁拒绝要走降级链（renew / accept），网络不通只能换候选地址。
 */
class HostUnreachableException(message: String, cause: Throwable? = null) : BootPayloadException(message, cause)

/**
 * 配对门禁拒绝（HTTP 401 + `{"error":"unpaired"}`）。
 *
 * 这是降级链的入口：门禁说「这台设备没配对（或会话失效了）」，壳据此依次尝试
 * `/api/pair/renew` 静默续期 → 链接内令牌 `/api/pair/accept` → 全败则标记「需重新配对」。
 */
class HostGateException(message: String) : BootPayloadException(message)

/**
 * 引导载荷的来源：向当前主机要一份渲染好的 index.html，解析出注入行。
 *
 * 「注入行从 lane 拉取/合成」的落地：facade、`__DSH_BOOT__` 全局、bootstrap 的 plugin combo
 * 都是**主机运行时才有**的内容（依赖主机上装了哪些插件），壳自己造不出来，只能取。
 */
class BootPayloadProvider(
    private val client: LaneHttpClient,
    private val parser: LaneIndexParser = LaneIndexParser(),
) {

    /**
     * 拉取并解析当前主机的引导载荷。
     *
     * @throws BootPayloadException 主机不可达或返回的不是 dsh 页面。
     */
    suspend fun load(host: HostEntry, socketBaseUrl: String): BootPayload = withContext(Dispatchers.IO) {
        val url = host.laneOrigin.trimEnd('/') + "/index.html"
        val response = try {
            client.open(
                LaneRequest(
                    url = url,
                    cookie = host.sessionCookie,
                    headers = mapOf("Accept" to "text/html"),
                ),
            )
        } catch (error: Exception) {
            throw HostUnreachableException("无法连接主机 ${host.displayName}", error)
        }
        try {
            if (response.status !in 200..299) {
                // 门禁拒绝：body 是 {"error":"unpaired"}（lane 的配对门禁，见 proxy.mjs）。
                if (response.status == 401) {
                    val detail = runCatching { response.readText() }.getOrDefault("")
                    if (detail.contains(UNPAIRED_MARK)) {
                        throw HostGateException("主机要求重新配对：${host.displayName}")
                    }
                }
                throw BootPayloadException("主机返回 HTTP ${response.status}")
            }
            val html = response.readText()
            val rows = parser.parse(html)
            if (!rows.any { it is InjectionRow.Script && it.text.contains(FACADE_MARK) }) {
                throw BootPayloadException("主机页面缺少模块加载 facade")
            }
            if (!rows.any { it is InjectionRow.Script && it.text.contains(BOOT_GRAPH_MARK) }) {
                throw BootPayloadException("主机页面缺少启动图")
            }
            ShellLog.info(
                "引导载荷就绪：主机=${host.displayName} 注入行=${rows.size} " +
                    "内联=${rows.count { it is InjectionRow.Script }} " +
                    "外部=${rows.count { it is InjectionRow.ScriptSrc }} " +
                    "预载=${rows.count { it is InjectionRow.ScriptPreload }}",
            )
            BootPayload(
                hostId = host.id,
                hostLabel = host.displayName,
                laneOrigin = host.laneOrigin.trimEnd('/'),
                pageOrigin = ShellSettings.PAGE_ORIGIN,
                socketBaseUrl = socketBaseUrl,
                rows = rows,
            )
        } finally {
            response.close()
        }
    }

    private companion object {
        /** facade 行标记：`window.__ModuleLoader__=` 队列。 */
        const val FACADE_MARK = "__ModuleLoader__"

        /** 启动图行标记：`globalThis["__DSH_BOOT__"] = …`。 */
        const val BOOT_GRAPH_MARK = "__DSH_BOOT__"

        /** 配对门禁的 body 标记。 */
        const val UNPAIRED_MARK = "unpaired"
    }
}
