package com.plus.mobile.android.shell.update

/**
 * 更新提醒的「路」：同号壳与运行时是两个键（桌面契约里的 `shell` / `runtime`）。
 *
 * 移动端壳本身是「壳」这一路（`shell`）；桌面的 dsh 运行时那一路在手机上没有对应物，
 * 但键名保留下来，两端的拉黑列表与已提醒版本因此可以互相理解。
 */
enum class UpdateNoticeKind(val key: String) {
    /** 壳（移动端 App 自身）。 */
    SHELL("shell"),

    /** 运行时（桌面的 dsh 进程；移动端不用，键名保留以对齐契约）。 */
    RUNTIME("runtime"),
}

/**
 * 更新提醒状态：开关 / 拉黑版本 / 已提醒最高版本。
 *
 * 语义**复用桌面 update-notice 契约**
 * （`packages/plus/desktop-plugin/contracts/updates.ts` 的 `UpdateNoticeState`）：
 *
 *  - `enabled`：总开关，默认开（桌面契约同款）；
 *  - `ignored`：拉黑键，形如 `shell:<版本>`——拉黑的是**某一个具体版本**，不是整个渠道；
 *  - `lastNotified`：已提醒过的最高版本，分路记；同一个版本不重复提醒，
 *    比已提醒版本更旧的也不再提醒。
 *
 * 纯数据 + 纯函数（判定规则在 [UpdateNoticePolicy]），不碰存储与 Android API。
 */
data class UpdateNoticeState(
    val enabled: Boolean,
    /** 拉黑键列表（`shell:<版本>`）。 */
    val ignored: List<String>,
    /** 已提醒过的最高版本，分路（`shell` / `runtime`）。 */
    val lastNotified: Map<String, String?>,
) {

    /** 拉黑键：`<路>:<版本>`。 */
    fun ignoredKey(kind: UpdateNoticeKind, version: String): String = "${kind.key}:$version"

    /** 该版本是否被拉黑。 */
    fun isIgnored(kind: UpdateNoticeKind, version: String): Boolean =
        ignoredKey(kind, version) in ignored

    /** 该路已提醒过的最高版本（null = 还没提醒过）。 */
    fun lastNotifiedVersion(kind: UpdateNoticeKind): String? = lastNotified[kind.key]

    companion object {

        /** 桌面契约的默认值：总开关默认开。 */
        fun default(): UpdateNoticeState = UpdateNoticeState(
            enabled = true,
            ignored = emptyList(),
            lastNotified = emptyMap(),
        )
    }
}

/** 提醒判定的结论（UI 据此决定「提不提」「提不提什么」）。 */
enum class NoticeDecision {

    /** 总开关关着：什么都不做。 */
    DISABLED,

    /** 该版本被拉黑：什么都不做。 */
    IGNORED,

    /** 不是更新的版本（不高于本机已装版本）：什么都不做。 */
    NOT_NEWER,

    /** 已经提醒过这个或更新的版本：不重复提醒。 */
    ALREADY_NOTIFIED,

    /** 该提醒。 */
    NOTIFY,
}

/**
 * 提醒判定规则（桌面 update-notice 契约的可执行形态）。
 *
 * 判定顺序即语义顺序：
 *  1. 开关关 → 不提醒；
 *  2. 版本被拉黑 → 不提醒；
 *  3. 不比本机已装版本新 → 不提醒（降级安装一律不提示）；
 *  4. 不比「已提醒最高版本」新 → 不重复提醒；
 *  5. 其余 → 提醒。
 */
object UpdateNoticePolicy {

    /**
     * 判定某个候选版本要不要提醒。
     *
     * @param state 当前提醒状态
     * @param kind 提醒的路（移动端用 [UpdateNoticeKind.SHELL]）
     * @param candidateVersion feed 里的候选版本
     * @param currentVersion 本机已装版本
     */
    fun decide(
        state: UpdateNoticeState,
        kind: UpdateNoticeKind,
        candidateVersion: String,
        currentVersion: String,
    ): NoticeDecision {
        if (!state.enabled) return NoticeDecision.DISABLED
        if (state.isIgnored(kind, candidateVersion)) return NoticeDecision.IGNORED
        if (!MobileVersion.isNewer(candidateVersion, currentVersion)) return NoticeDecision.NOT_NEWER
        val notified = state.lastNotifiedVersion(kind)
        if (notified != null && !MobileVersion.isNewer(candidateVersion, notified)) {
            return NoticeDecision.ALREADY_NOTIFIED
        }
        return NoticeDecision.NOTIFY
    }

    /**
     * 记下「已经提醒过这个版本」——只保留最高版本。
     *
     * 提醒过的最高版本必须单调递增：用户跳过一个版本后再遇到更新的版本，仍然要提醒。
     */
    fun markNotified(
        state: UpdateNoticeState,
        kind: UpdateNoticeKind,
        version: String,
    ): UpdateNoticeState {
        val current = state.lastNotifiedVersion(kind)
        val highest = if (current == null || MobileVersion.isNewer(version, current)) version else current
        return state.copy(lastNotified = state.lastNotified + (kind.key to highest))
    }

    /** 拉黑某个版本（「不再提示此版本」）。 */
    fun ignore(
        state: UpdateNoticeState,
        kind: UpdateNoticeKind,
        version: String,
    ): UpdateNoticeState {
        val key = state.ignoredKey(kind, version)
        if (key in state.ignored) return state
        return state.copy(ignored = state.ignored + key)
    }

    /** 清空拉黑列表（「恢复全部提醒」）。 */
    fun clearIgnored(state: UpdateNoticeState): UpdateNoticeState = state.copy(ignored = emptyList())
}
