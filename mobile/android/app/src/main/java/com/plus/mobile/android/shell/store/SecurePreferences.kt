package com.plus.mobile.android.shell.store

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.plus.mobile.android.shell.ShellLog

/**
 * 平台加密存储（Android Keystore + EncryptedSharedPreferences）。
 *
 * ## 边界（spec #55「凭证与安全」）
 *
 * 主机条目里的**会话 cookie、deviceId、配对令牌**只存在这里：
 *  - 主密钥由 Android Keystore 生成，密钥材料不出设备；
 *  - 落盘的是密文：键名 AES256-SIV、值 AES256-GCM。
 *
 * cookie **不常驻系统 CookieManager**：WebView 的 cookie 罐是明文落盘的，且页面同源策略一旦
 * 出现漏洞就能读到它。壳的做法是：cookie 只在加密存储里，出站时由壳解密附加
 * （见 net/LaneHttpClient、bridge/NativeRequestBridge；WS 由页面带令牌直连 lane，壳不经手凭证）。
 *
 * Keystore 不可用时（少数定制 ROM / 迁移损坏）创建会抛异常 —— 调用方据此回退到内存存储，
 * 而不是让 App 起不来。
 */
class SecurePreferences(private val prefs: SharedPreferences) : KeyValueStore {

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun putString(key: String, value: String?) {
        val editor = prefs.edit()
        if (value == null) editor.remove(key) else editor.putString(key, value)
        editor.apply()
    }

    override fun getBoolean(key: String, fallback: Boolean): Boolean = prefs.getBoolean(key, fallback)

    override fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }

    companion object {

        /** 加密偏好文件名（落在 App 私有目录）。 */
        private const val FILE_NAME = "dsh_mobile_secure"

        /**
         * 打开加密存储；不可用时返回 null（调用方回退内存存储）。
         */
        fun open(context: Context): SecurePreferences? = try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            SecurePreferences(
                EncryptedSharedPreferences.create(
                    context,
                    FILE_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                ),
            )
        } catch (error: Exception) {
            ShellLog.error("加密存储不可用，回退到内存存储（凭证不持久）", error)
            null
        }
    }
}
