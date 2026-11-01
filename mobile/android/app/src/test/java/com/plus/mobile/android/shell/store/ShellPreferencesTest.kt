package com.plus.mobile.android.shell.store

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 壳的非凭证偏好：默认值与「已存过的值不被默认值覆盖」。
 *
 * 契约（code-review P5）：更新提醒的**总开关默认开**——
 * 与桌面 update-notice 契约同款，也与 iOS / 鸿蒙壳一致。
 */
class ShellPreferencesTest {

    @Test
    fun `更新提醒总开关默认开`() {
        val preferences = ShellPreferences(MemoryKeyValueStore())
        assertTrue(preferences.updateReminderEnabled)
    }

    @Test
    fun `已存过的关闭值不被默认值覆盖`() {
        val store = MemoryKeyValueStore()
        ShellPreferences(store).updateReminderEnabled = false
        assertFalse(ShellPreferences(store).updateReminderEnabled)
    }

    @Test
    fun `生物锁开关同样默认开`() {
        assertTrue(ShellPreferences(MemoryKeyValueStore()).biometricLockEnabled)
    }
}
