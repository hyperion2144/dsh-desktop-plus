package com.plus.mobile.android.shell.host

/**
 * 主机形态（spec #55「地址形态与发现」）。
 *
 * 形态决定两件事：徽标怎么画（管理页）、以及地址怎么分类（配对时的候选排序）。
 */
enum class HostForm(val code: String, val label: String) {

    /** 局域网 IP 直连。 */
    LAN("lan", "局域网"),

    /** mDNS 主机名（`<主机名>.local`）。 */
    MDNS("mdns", "mDNS"),

    /** 第三方隧道（公网 https）。 */
    TUNNEL("tunnel", "隧道"),

    /** 直连 dsh 地址（不经 lane）。 */
    DIRECT("direct", "直连"),
    ;

    companion object {

        /** 由存储里的代码还原；不认识的一律按 LAN 处理。 */
        fun fromCode(code: String?): HostForm = entries.firstOrNull { it.code == code } ?: LAN

        /**
         * 按地址猜形态：
         *  - `.local` 结尾 → mDNS；
         *  - 公网 https → 隧道；
         *  - 其余 → 局域网。
         */
        fun of(origin: String): HostForm {
            val text = origin.trim().lowercase()
            val host = text.substringAfter("://", text).substringBefore('/').substringBefore(']').substringBefore(':')
            return when {
                host.endsWith(".local") -> MDNS
                text.startsWith("https://") && !isPrivateHost(host) -> TUNNEL
                text.startsWith("direct://") -> DIRECT
                else -> LAN
            }
        }

        /** RFC1918 / 回环：这些地址不可能是公网隧道。 */
        private fun isPrivateHost(host: String): Boolean {
            if (host == "localhost" || host == "::1") return true
            val parts = host.split('.')
            if (parts.size != 4) return false
            val numbers = parts.map { it.toIntOrNull() ?: return false }
            return when {
                numbers[0] == 10 -> true
                numbers[0] == 192 && numbers[1] == 168 -> true
                numbers[0] == 172 && numbers[1] in 16..31 -> true
                else -> false
            }
        }
    }
}
