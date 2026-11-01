package com.plus.mobile.android.shell.host

import com.plus.mobile.android.shell.store.HostRecord
import com.plus.mobile.android.shell.store.HostRecordCodec
import com.plus.mobile.android.shell.store.KeyValueStore

/**
 * 主机仓库：落盘在平台加密存储里。
 *
 * ## 为什么是这一层
 *
 * 主机条目里有**凭证**（会话 cookie、deviceId、配对令牌）。它们必须满足两条：
 *  1. **不落明文**：落在 Keystore 加密的偏好里（见 store/SecurePreferences）；
 *  2. **不到页面**：页面拿不到 cookie，只能通过壳桥拿到主机名与 origin（bridge/MobileBridge）。
 *
 * 整表用一个键存：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
 *
 * 线程安全：UI 线程与 WebView 的 JS 桥线程都可能读写。
 */
class EncryptedHostRegistry(private val store: KeyValueStore) : HostRegistry {

    private val lock = Any()
    private val hosts = LinkedHashMap<String, HostEntry>()
    private var currentId: String? = null

    init {
        restore()
    }

    override fun list(): List<HostEntry> = synchronized(lock) { hosts.values.toList() }

    override fun current(): HostEntry? = synchronized(lock) {
        currentId?.let { hosts[it] } ?: hosts.values.firstOrNull()
    }

    override fun find(id: String): HostEntry? = synchronized(lock) { hosts[id] }

    override fun setCurrent(id: String) = synchronized(lock) {
        if (hosts.containsKey(id)) {
            currentId = id
            persist()
        }
    }

    override fun upsert(host: HostEntry) = synchronized(lock) {
        hosts[host.id] = host
        if (currentId == null) currentId = host.id
        persist()
    }

    override fun remove(id: String) = synchronized(lock) {
        hosts.remove(id)
        if (currentId == id) currentId = hosts.keys.firstOrNull()
        persist()
    }

    override fun markStatus(id: String, status: HostStatus, reason: String?) = synchronized(lock) {
        val host = hosts[id] ?: return@synchronized
        hosts[id] = host.copy(status = status, statusReason = reason)
        persist()
    }

    override fun markLatency(id: String, latencyMs: Int?) = synchronized(lock) {
        val host = hosts[id] ?: return@synchronized
        hosts[id] = host.copy(latencyMs = latencyMs)
        persist()
    }

    /** 从存储恢复（进程重启后主机列表与凭证都在）。 */
    private fun restore() = synchronized(lock) {
        val records = HostRecordCodec.decode(store.getString(KEY_HOSTS).orEmpty())
        records.forEach { record -> hosts[record.id] = record.toEntry() }
        // 一次性令牌只在配对那一次有效：老版本曾把它持久化，恢复时统一清掉，
        // 避免降级链拿已消费的令牌去 accept 而被推回重新配对。
        val stale = hosts.values.filter { !it.pairToken.isNullOrBlank() }
        if (stale.isNotEmpty()) {
            stale.forEach { hosts[it.id] = it.copy(pairToken = null) }
            persist()
        }
        val stored = store.getString(KEY_CURRENT)
        currentId = stored?.takeIf { hosts.containsKey(it) } ?: hosts.keys.firstOrNull()
    }

    /** 写回存储。调用方必须已持有锁。 */
    private fun persist() {
        store.putString(KEY_HOSTS, HostRecordCodec.encode(hosts.values.map { it.toRecord() }))
        store.putString(KEY_CURRENT, currentId)
    }

    private fun HostEntry.toRecord(): HostRecord = HostRecord(
        id = id,
        label = label,
        origin = laneOrigin,
        form = form.code,
        candidates = candidates,
        deviceId = deviceId,
        cookie = sessionCookie,
        pairToken = pairToken,
        status = status.code,
        statusReason = statusReason,
        tunnelReachable = tunnelReachable,
        pairedAt = pairedAt,
    )

    private fun HostRecord.toEntry(): HostEntry = HostEntry(
        id = id,
        label = label,
        laneOrigin = origin,
        sessionCookie = cookie,
        form = HostForm.fromCode(form),
        candidates = candidates,
        deviceId = deviceId,
        pairToken = pairToken,
        status = HostStatus.fromCode(status),
        statusReason = statusReason,
        tunnelReachable = tunnelReachable,
        latencyMs = null,
        pairedAt = pairedAt,
    )

    private companion object {
        const val KEY_HOSTS = "hosts.entries"
        const val KEY_CURRENT = "hosts.current"
    }
}
