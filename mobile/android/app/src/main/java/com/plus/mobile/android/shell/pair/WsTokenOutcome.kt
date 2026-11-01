package com.plus.mobile.android.shell.pair

/**
 * 直连令牌的签发结果。
 *
 * 三种结果**不能合并**，因为壳的后续动作完全不同：
 *  - [Token]：拿到令牌，拼出 `ws(s)://<lane>/__dsh_ws/<令牌>/`；
 *  - [Gated]：lane 明确拒绝（401/403 = 会话失效 / 设备被移除）→ 必须交给既有降级链
 *    （`/api/pair/renew` 静默续期 → 链接内令牌 `/api/pair/accept` → 标记「需重新配对」）；
 *  - [Unreachable]：地址不通 / 网络问题 / 上游异常 → 只能换下一个候选地址。
 *
 * 为什么专门建一个类型：令牌是在装载引导载荷**之前**换的，比门禁更早发生。
 * 如果把 [Gated] 也当 [Unreachable]，会话过期在用户侧就表现成「主机离线」，
 * 只能重新扫码配对——这正是降级链存在的意义，不能被绕开。
 */
sealed interface WsTokenOutcome {
    /** 拿到令牌。 */
    data class Token(val value: String) : WsTokenOutcome

    /** 门禁拒绝：会话失效 / 设备被移除。 */
    data object Gated : WsTokenOutcome

    /** 地址或网络不可用。 */
    data object Unreachable : WsTokenOutcome
}
