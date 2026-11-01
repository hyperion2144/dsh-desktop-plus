package com.plus.mobile.android.shell.update

import com.plus.mobile.android.shell.store.ShellPreferences

/**
 * 提醒状态与壳内偏好的适配层。
 *
 * 偏好本身不敏感（版本号不是凭证），但与凭证同库存放——壳只有一处持久化，
 * 回退到内存存储时提醒状态与凭证一起失效，语义一致。
 *
 * 这一层是「契约形状 ↔ 存储键」的映射点：桌面契约里的
 * `ignored: string[]` / `lastNotified: { shell, runtime }` 在壳内落成三个偏好键。
 */
class UpdateNoticeStore(private val preferences: ShellPreferences) {

    /** 读当前提醒状态。 */
    fun read(): UpdateNoticeState = UpdateNoticeState(
        enabled = preferences.updateReminderEnabled,
        ignored = preferences.updateIgnoredVersions,
        lastNotified = mapOf(
            UpdateNoticeKind.SHELL.key to preferences.updateLastNotifiedVersion,
            UpdateNoticeKind.RUNTIME.key to null,
        ),
    )

    /** 写回提醒状态。 */
    fun write(state: UpdateNoticeState) {
        preferences.updateReminderEnabled = state.enabled
        preferences.updateIgnoredVersions = state.ignored
        preferences.updateLastNotifiedVersion = state.lastNotified[UpdateNoticeKind.SHELL.key]
    }
}
