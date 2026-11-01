package com.plus.mobile.android.shell.ui

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate
import com.plus.mobile.android.R

/**
 * 外观偏好：跟随系统 / 浅色 / 深色。
 *
 * 壳的主题是 Theme.AppCompat.DayNight.NoActionBar（res/values/themes.xml），
 * 明暗由 AppCompatDelegate 决定：换模式会重建界面，所以改完立即生效，不用重启。
 *
 * 取值落在普通 SharedPreferences：外观不是凭证（不进加密存储），但必须能被
 * Application 在任何界面起来之前读到——它是壳启动路径上的第一个决定。
 */
object AppearanceSettings {
    /** 跟随系统（默认）。 */
    const val SYSTEM = "system"

    /** 强制浅色。 */
    const val LIGHT = "light"

    /** 强制深色。 */
    const val DARK = "dark"

    /** 三个合法取值，顺序即选择对话框里的顺序。 */
    val VALUES = listOf(SYSTEM, LIGHT, DARK)

    /** 偏好文件名（壳的非敏感偏好）。 */
    private const val PREFS_NAME = "dsh_shell"

    /** 偏好键。 */
    private const val KEY_APPEARANCE = "pref.appearance"

    /** 读当前外观；缺省或非法值都当「跟随系统」。 */
    fun load(context: Context): String {
        val stored = prefs(context).getString(KEY_APPEARANCE, SYSTEM) ?: SYSTEM
        return if (stored in VALUES) stored else SYSTEM
    }

    /** 写当前外观；非法值当「跟随系统」。 */
    fun save(context: Context, value: String) {
        val normalized = if (value in VALUES) value else SYSTEM
        prefs(context).edit().putString(KEY_APPEARANCE, normalized).apply()
    }

    /** 把外观应用到整个进程（立即生效：AppCompat 会重建受影响的界面）。 */
    fun applyToApp(value: String) {
        val mode = when (value) {
            LIGHT -> AppCompatDelegate.MODE_NIGHT_NO
            DARK -> AppCompatDelegate.MODE_NIGHT_YES
            else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
        }
        AppCompatDelegate.setDefaultNightMode(mode)
    }

    /** 取值对应的显示文案。 */
    fun labelRes(value: String): Int = when (value) {
        LIGHT -> R.string.appearance_light
        DARK -> R.string.appearance_dark
        else -> R.string.appearance_system
    }

    /** 偏好存取（走 applicationContext：不持有界面）。 */
    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
