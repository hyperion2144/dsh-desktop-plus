package com.plus.mobile.android.shell.store

import org.json.JSONArray
import org.json.JSONObject

/**
 * 主机条目在加密存储里的形状。
 *
 * 与运行期的 [com.plus.mobile.android.shell.host.HostEntry] 分开，是为了让「哪些字段会落盘、
 * 哪些字段是凭证」在类型上就一目了然：`cookie` / `deviceId` / `pairToken` 三项是凭证，
 * 其余是展示与路由信息。
 */
data class HostRecord(
    val id: String,
    /** 显示名。 */
    val label: String,
    /** 当前生效的 origin。 */
    val origin: String,
    /** 形态代码（lan / mdns / tunnel / direct）。 */
    val form: String,
    /** 地址候选列表（配对链接里的 base 列表）。 */
    val candidates: List<String>,
    /** 设备 ID：静默续期的凭据。 */
    val deviceId: String?,
    /** 会话 cookie（HttpOnly）：出站时由壳解密附加。 */
    val cookie: String?,
    /** 配对链接里的一次性令牌：首次配对 / 降级链兜底用。 */
    val pairToken: String?,
    /** 状态代码（unknown / connected / offline / needs-repair）。 */
    val status: String,
    /** 状态原因文案（需重配时写清为什么）。 */
    val statusReason: String?,
    /** 隧道地址的可达性探测结论（null = 未探测 / 不适用）。 */
    val tunnelReachable: Boolean?,
    /** 配对时间戳。 */
    val pairedAt: Long,
)

/**
 * 主机记录列表的 JSON 编解码。
 *
 * 整表存一个键：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
 */
object HostRecordCodec {

    /** 编码成 JSON 数组文本。 */
    fun encode(records: List<HostRecord>): String {
        val array = JSONArray()
        records.forEach { record ->
            val item = JSONObject()
                .put("id", record.id)
                .put("label", record.label)
                .put("origin", record.origin)
                .put("form", record.form)
                .put("candidates", JSONArray(record.candidates))
                .put("status", record.status)
                .put("pairedAt", record.pairedAt)
            record.deviceId?.let { item.put("deviceId", it) }
            record.cookie?.let { item.put("cookie", it) }
            record.pairToken?.let { item.put("pairToken", it) }
            record.statusReason?.let { item.put("statusReason", it) }
            record.tunnelReachable?.let { item.put("tunnelReachable", it) }
            array.put(item)
        }
        return array.toString()
    }

    /** 解码 JSON 数组文本；损坏时返回空列表（不抛给调用方）。 */
    fun decode(text: String): List<HostRecord> {
        if (text.isBlank()) return emptyList()
        val array = try {
            JSONArray(text)
        } catch (_: Exception) {
            return emptyList()
        }
        val records = ArrayList<HostRecord>(array.length())
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optString("id").trim()
            if (id.isEmpty()) continue
            val candidates = ArrayList<String>()
            val candidateArray = item.optJSONArray("candidates")
            if (candidateArray != null) {
                for (position in 0 until candidateArray.length()) {
                    val value = candidateArray.optString(position).trim()
                    if (value.isNotEmpty()) candidates.add(value)
                }
            }
            records.add(
                HostRecord(
                    id = id,
                    label = item.optString("label"),
                    origin = item.optString("origin"),
                    form = item.optString("form", "lan"),
                    candidates = candidates,
                    deviceId = item.optString("deviceId").ifEmpty { null },
                    cookie = item.optString("cookie").ifEmpty { null },
                    pairToken = item.optString("pairToken").ifEmpty { null },
                    status = item.optString("status", "unknown"),
                    statusReason = item.optString("statusReason").ifEmpty { null },
                    tunnelReachable = if (item.has("tunnelReachable")) item.optBoolean("tunnelReachable") else null,
                    pairedAt = item.optLong("pairedAt", 0L),
                ),
            )
        }
        return records
    }
}
