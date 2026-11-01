package com.plus.mobile.android.shell.store

/**
 * 壳的非凭证偏好。
 *
 * 与凭证同库存放（同一个加密偏好文件）：偏好本身不敏感，但同库意味着「壳只有一处持久化」，
 * 回退到内存存储时偏好与凭证一起失效，语义一致。
 */
class ShellPreferences(private val store: KeyValueStore) {

    /**
     * 生物锁开关：**默认开**（spec #55「安全」：App 级锁默认开，可关）。
     */
    var biometricLockEnabled: Boolean
        get() = store.getBoolean(KEY_BIOMETRIC_LOCK, true)
        set(value) = store.putBoolean(KEY_BIOMETRIC_LOCK, value)

    /**
     * 更新提醒开关。默认开（桌面 update-notice 契约同款：总开关默认开）。
     */
    var updateReminderEnabled: Boolean
        get() = store.getBoolean(KEY_UPDATE_REMINDER, true)
        set(value) = store.putBoolean(KEY_UPDATE_REMINDER, value)

    /**
     * 拉黑键列表（`shell:<版本>`，换行分隔）。
     *
     * 语义复用桌面 update-notice 契约：拉黑的是**某一个具体版本**，不是整个渠道。
     */
    var updateIgnoredVersions: List<String>
        get() = store.getString(KEY_UPDATE_IGNORED)
            ?.split('\n')
            ?.filter { it.isNotBlank() }
            ?: emptyList()
        set(value) = store.putString(
            KEY_UPDATE_IGNORED,
            value.filter { it.isNotBlank() }.joinToString("\n"),
        )

    /** 已提醒过的最高版本（壳这一路）。 */
    var updateLastNotifiedVersion: String?
        get() = store.getString(KEY_UPDATE_LAST_NOTIFIED)
        set(value) = store.putString(KEY_UPDATE_LAST_NOTIFIED, value)

    /** 上次检查更新的时刻（毫秒；0 = 从没查过）。 */
    var updateLastCheckAt: Long
        get() = store.getString(KEY_UPDATE_LAST_CHECK)?.toLongOrNull() ?: 0L
        set(value) = store.putString(KEY_UPDATE_LAST_CHECK, value.toString())

    /**
     * 更新源地址的本地 override（空串 = 用构建期默认值）。
     *
     * 验证时把 feed 指到本机 http 服务，走通「检查 → 提醒 → 下载 → 拉起安装器」。
     */
    var updateFeedOverride: String?
        get() = store.getString(KEY_UPDATE_FEED)
        set(value) = store.putString(KEY_UPDATE_FEED, value)

    private companion object {
        const val KEY_BIOMETRIC_LOCK = "pref.biometric_lock"
        const val KEY_UPDATE_REMINDER = "pref.update_reminder"
        const val KEY_UPDATE_IGNORED = "pref.update_ignored"
        const val KEY_UPDATE_LAST_NOTIFIED = "pref.update_last_notified"
        const val KEY_UPDATE_LAST_CHECK = "pref.update_last_check"
        const val KEY_UPDATE_FEED = "pref.update_feed"
    }
}
