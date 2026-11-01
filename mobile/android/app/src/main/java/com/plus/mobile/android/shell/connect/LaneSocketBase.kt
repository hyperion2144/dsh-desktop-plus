package com.plus.mobile.android.shell.connect

import com.plus.mobile.android.shell.ShellSettings

/**
 * 页面直连 lane 的 WS base 的**纯计算**部分：`ws(s)://<lane>/__dsh_ws/<令牌>/`。
 *
 * ## 为什么是「计算」而不是「常量」
 *
 * base 里有两样每台主机都不一样的成分：lane 地址与**一次性签发的直连令牌**。
 * 令牌只能由 lane 用会话 cookie 换（见 [com.plus.mobile.android.shell.pair.LanePairingClient]），
 * 所以 base 必须等主机与令牌都定了才算得出来——但它的**形状**是死的：
 *
 *  - scheme 随 lane 走：http→ws、https→wss（页面在 https origin 里，明文 ws 属混合内容）；
 *  - 路径前缀 `/__dsh_ws/<令牌>/` 由 lane 剥掉后再按原路径转发。
 *
 * 末尾斜杠是硬要求：页面用 `new URL('api/remote.mux', base)` 相对解析 mux 路径，
 * 少了它 `__dsh_ws/<令牌>` 整段会被当成文件名吃掉（令牌也一同丢失）。
 */
object LaneSocketBase {

    /**
     * 由 lane 地址与直连令牌算出页面侧 WS 的 base。
     *
     * @param origin lane 的地址（`http://<主机>:<端口>` 一类）。
     * @param token lane 签发的直连令牌。
     */
    fun baseUrl(origin: String, token: String): String {
        val trimmed = origin.trim().trimEnd('/')
        val scheme = if (trimmed.startsWith("https://", ignoreCase = true)) "wss" else "ws"
        val authority = trimmed.substringAfter("://", trimmed)
        return "$scheme://$authority${ShellSettings.LANE_WS_PREFIX}$token/"
    }
}
