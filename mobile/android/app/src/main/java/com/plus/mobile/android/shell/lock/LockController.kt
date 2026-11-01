package com.plus.mobile.android.shell.lock

import android.os.SystemClock
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.store.ShellPreferences

/**
 * App 级生物锁的状态机。
 *
 * ## 三个触发场景（spec #55「生物锁」）
 *
 * 1. **冷启动**：进程刚起来时 `unlocked = false`，第一次回前台必然要求验证；
 * 2. **后台超 1 分钟回前台**：[onBackground] 记下离开时刻，回前台超过
 *    [BACKGROUND_TIMEOUT_MS] 就重新上锁；
 * 3. **敏感操作**（配对 / 删主机）：调用 [lock] 主动上锁，验证通过才继续。
 *
 * **切主机不触发**：切换主机在同一个 Activity 内完成，不经过后台/冷启动路径。
 *
 * 开关默认开（[ShellPreferences.biometricLockEnabled]），可关。
 */
class LockController(private val preferences: ShellPreferences) {

    /** 开关：默认开，可关。关掉时锁整体失效。 */
    var enabled: Boolean
        get() = preferences.biometricLockEnabled
        set(value) {
            preferences.biometricLockEnabled = value
            if (!value) unlocked = true
        }

    /** 当前是否已验证（进程内状态，不落盘）。 */
    private var unlocked = false

    /** 离开前台的时刻（0 = 没离开过）。 */
    private var backgroundedAt = 0L

    /** 记下离开前台的时刻。 */
    fun onBackground() {
        backgroundedAt = SystemClock.elapsedRealtime()
        ShellLog.info("离开前台：记下时刻")
    }

    /**
     * 回前台：判断这次要不要验证，并给出触发原因。
     *
     * 副作用：清掉离开时刻（同一个前台周期只判一次）。
     *
     * @return null = 不需要验证；否则是触发原因（锁屏据此写文案）。
     */
    fun needsUnlock(): LockReason? {
        if (!enabled) {
            unlocked = true
            return null
        }
        val elapsed = if (backgroundedAt > 0L) SystemClock.elapsedRealtime() - backgroundedAt else 0L
        backgroundedAt = 0L
        val reason = when {
            elapsed > BACKGROUND_TIMEOUT_MS -> {
                unlocked = false
                LockReason.BACKGROUND
            }
            unlocked -> null
            else -> LockReason.COLD
        }
        ShellLog.info("回前台：离开 ${elapsed}ms → ${reason ?: "无需验证"}")
        return reason
    }

    /** 验证通过。 */
    fun unlock() {
        unlocked = true
    }

    /** 主动上锁（敏感操作前）。 */
    fun lock() {
        unlocked = false
    }

    /** 触发验证的原因（锁屏文案据此区分）。 */
    enum class LockReason {
        /** 冷启动：进程刚起来，尚未验证过。 */
        COLD,

        /** 后台超时回前台。 */
        BACKGROUND,
    }

    companion object {
        /** 后台超时阈值：1 分钟（原型定稿：「离开超过 1 分钟」）。 */
        const val BACKGROUND_TIMEOUT_MS = 60_000L
    }
}
