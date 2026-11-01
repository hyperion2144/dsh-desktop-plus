package com.plus.mobile.android.shell.boot

import org.json.JSONArray
import org.json.JSONObject

/**
 * 引导载荷：页面在 document-start 取的那份数据。
 *
 * 两块内容：
 *  - `rows`：从 lane 渲染结果里解析出的注入行（facade / `__DSH_BOOT__` / bootstrap script-src / …）
 *  - `transport`：`__DSH_TRANSPORT__` 的配置（streamBaseUrl / createWebSocket / ownsHost）
 */
data class BootPayload(
    val hostId: String,
    val hostLabel: String,
    val laneOrigin: String,
    val pageOrigin: String,
    /** 页面侧 WebSocket 的 base：页面带签名令牌直连 lane（`ws(s)://<lane>/__dsh_ws/<令牌>/`）。 */
    val socketBaseUrl: String,
    val rows: List<InjectionRow>,
) {

    /** 序列化成页面消费的 JSON。 */
    fun toJson(): String {
        val root = JSONObject()
        root.put(
            "host",
            JSONObject()
                .put("id", hostId)
                .put("label", hostLabel)
                .put("origin", laneOrigin),
        )
        root.put(
            "transport",
            JSONObject()
                // 能力位：对齐桌面载体与 lane 远程页面先例，只开特权 UI 面（服务端设置），
                // 不放宽传输层鉴权（spec #55「服务端设置特权面」）。
                .put("ownsHost", true)
                // 页面内 WS 的 base：页面带签名令牌直连 lane（壳不再中继，凭证不进页面）。
                .put("streamBaseUrl", socketBaseUrl)
                .put("laneOrigin", laneOrigin)
                .put("pageOrigin", pageOrigin),
        )
        val array = JSONArray()
        rows.forEach { row ->
            val item = JSONObject()
            when (row) {
                is InjectionRow.Script -> item.put("kind", "script").put("text", row.text)
                is InjectionRow.ScriptSrc -> item.put("kind", "script-src").put("src", row.src)
                is InjectionRow.ScriptPreload -> item.put("kind", "script-preload").put("src", row.src)
            }
            array.put(item)
        }
        root.put("rows", array)
        return root.toString()
    }
}
