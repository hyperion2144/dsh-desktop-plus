package com.plus.mobile.android.shell.host

/**
 * 主机存储的接口。
 *
 * 实现：[EncryptedHostRegistry]（Keystore 加密存储）。Keystore 不可用时同一个实现挂在内存键值上，
 * 调用方不需要区分。
 */
interface HostRegistry {

    /** 全部已配置主机（按加入顺序）。 */
    fun list(): List<HostEntry>

    /** 当前主机；未显式指定时取列表第一台。 */
    fun current(): HostEntry?

    /** 按 id 取主机。 */
    fun find(id: String): HostEntry?

    /** 设定当前主机。 */
    fun setCurrent(id: String)

    /** 加入或更新一台主机（同 id 覆盖）。 */
    fun upsert(host: HostEntry)

    /** 移除一台主机。 */
    fun remove(id: String)

    /** 更新状态与原因文案（已连接 / 离线 / 需重新配对）。 */
    fun markStatus(id: String, status: HostStatus, reason: String? = null)

    /** 记录最近一次探测到的往返延迟（毫秒）。 */
    fun markLatency(id: String, latencyMs: Int?)
}
