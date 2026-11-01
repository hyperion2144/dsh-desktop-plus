package com.plus.mobile.android.shell.host

/**
 * 主机状态（管理页的状态点与原因文案）。
 *
 * 状态**持久化**：App 被杀后重进管理页，仍要看得见「这台主机需要重新配对」，
 * 而不是重新探测一次才显示。
 */
enum class HostStatus(val code: String) {

    /** 还没连过（刚配对但尚未加载页面）。 */
    UNKNOWN("unknown"),

    /** 已连接。 */
    CONNECTED("connected"),

    /** 连不上（地址不可达 / 主机没开机）。 */
    OFFLINE("offline"),

    /** 门禁拒绝且降级链全败：需要重新配对。 */
    NEEDS_REPAIR("needs-repair"),
    ;

    companion object {
        /** 由存储里的代码还原；不认识的一律按 UNKNOWN 处理。 */
        fun fromCode(code: String?): HostStatus = entries.firstOrNull { it.code == code } ?: UNKNOWN
    }
}
