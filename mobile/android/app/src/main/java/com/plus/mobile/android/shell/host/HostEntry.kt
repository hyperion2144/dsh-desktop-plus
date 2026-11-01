package com.plus.mobile.android.shell.host

/**
 * 一台桌面主机。
 *
 * 字段与 spec #55「多主机凭证模型」对齐：
 *  - `laneOrigin`：当前生效的地址（origin）；
 *  - `form`：地址形态（lan / mdns / tunnel / direct）；
 *  - `candidates`：地址候选列表（配对链接里的 base 列表），换网络时按序重试；
 *  - `deviceId`：设备 ID，降级链用它静默续期；
 *  - `sessionCookie`：lane 的会话 cookie（HttpOnly）——**只存在壳内**，由壳在转发请求时附加，
    永不下发给页面（spec #55「凭证与安全」第 17 条：页面 JS 永远拿不到凭证）；
 *  - `pairToken`：配对链接里的一次性令牌，只在首次配对与降级链兜底时用。
 */
data class HostEntry(
    val id: String,
    val label: String,
    val laneOrigin: String,
    val sessionCookie: String?,
    val form: HostForm = HostForm.LAN,
    /** 地址候选列表（按优先级）。 */
    val candidates: List<String> = emptyList(),
    /** 设备 ID：静默续期的凭据。 */
    val deviceId: String? = null,
    /** 配对链接里的一次性令牌（降级链兜底用）。 */
    val pairToken: String? = null,
    /** 状态（管理页状态点）。 */
    val status: HostStatus = HostStatus.UNKNOWN,
    /** 状态原因文案（需重配时写清为什么）。 */
    val statusReason: String? = null,
    /** 隧道地址的可达性探测结论（null = 未探测 / 不适用）。 */
    val tunnelReachable: Boolean? = null,
    /** 最近一次探测到的往返延迟（毫秒）。 */
    val latencyMs: Int? = null,
    /** 配对时间戳。 */
    val pairedAt: Long = 0L,
) {
    /** 供页面与日志使用的展示名（无标签时退回 origin）。 */
    val displayName: String get() = label.ifBlank { laneOrigin }

    /** 展示用地址（去掉协议头，与原型一致）。 */
    val displayOrigin: String
        get() = displayAddress(laneOrigin)

    companion object {

        /**
         * 展示用地址：去掉协议头与末尾斜杠。
         *
         * 生效地址与地址候选共用这一条规则，页面因此看到的是同一种写法。
         */
        fun displayAddress(origin: String): String =
            origin.removePrefix("http://").removePrefix("https://").trimEnd('/')
    }
}
