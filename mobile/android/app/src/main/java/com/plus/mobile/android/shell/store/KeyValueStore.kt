package com.plus.mobile.android.shell.store

/**
 * 键值存储的最小抽象。
 *
 * 真实实现是 [SecurePreferences]（Keystore 加密）；Keystore 不可用时退回 [MemoryKeyValueStore]
 * （只活在进程内存里：App 被杀即失，但壳照常可用，只是不持久）。
 *
 * 这一层存在的意义：上层（主机仓库、偏好）只认「键值」，不认 Android 的 SharedPreferences，
 * 于是「加密存储」与「内存回退」是同一个实现细节的两种落法。
 */
interface KeyValueStore {

    /** 读一个字符串；不存在时返回 null。 */
    fun getString(key: String): String?

    /** 写一个字符串；value 为 null 时删除该键。 */
    fun putString(key: String, value: String?)

    /** 读一个布尔值；不存在时返回 fallback。 */
    fun getBoolean(key: String, fallback: Boolean): Boolean

    /** 写一个布尔值。 */
    fun putBoolean(key: String, value: Boolean)
}

/**
 * 内存实现：Keystore 不可用时的回退。
 *
 * 线程安全：UI 线程与 WebView 的 JS 桥线程都可能读写。
 */
class MemoryKeyValueStore : KeyValueStore {

    private val lock = Any()
    private val values = LinkedHashMap<String, Any>()

    override fun getString(key: String): String? = synchronized(lock) { values[key] as? String }

    override fun putString(key: String, value: String?) {
        synchronized(lock) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    override fun getBoolean(key: String, fallback: Boolean): Boolean =
        synchronized(lock) { values[key] as? Boolean ?: fallback }

    override fun putBoolean(key: String, value: Boolean) = synchronized(lock) { values[key] = value }
}
