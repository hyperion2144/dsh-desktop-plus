package com.plus.mobile.android.shell.discovery

import android.content.Context
import android.os.Build
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import com.plus.mobile.android.shell.ShellLog

/**
 * 发现到的一台桌面主机。
 *
 * ## 发现 ≠ 授权
 *
 * mDNS 是明文组播，整条局域网都看得见广播内容，因此广播记录里**只有「在哪」类事实**
 * （主机名、端口、配对入口路径）——**没有任何授权令牌**。
 * 授权永远由桌面签发的一次性限时链接完成（配对入口见 [DiscoveredHost.origin] 的引导文案）。
 *
 * @param serviceName mDNS 实例名（桌面上是 `DSH Desktop Plus - <主机名>`）
 * @param label 展示名（去掉实例名里的服务类型后缀）
 * @param origin 候选地址（`http://<ip>:<port>`）
 * @param ip 解析出的 IP（**以 NsdManager 的解析结果为准**）
 * @param port lane 端口
 * @param host 广播里的主机名（TXT 的 `host`，可能是 `<主机名>.local`）
 * @param path 配对入口路径（TXT 的 `path`）
 */
data class DiscoveredHost(
    val serviceName: String,
    val label: String,
    val origin: String,
    val ip: String,
    val port: Int,
    val host: String?,
    val path: String,
) {

    /** 展示用地址（IP:port）——以 NsdManager 解析出的 IP 为准。 */
    val displayAddress: String get() = "$ip:$port"
}

/**
 * 一条广播记录的原始形态（与 Android 的 [NsdServiceInfo] 解耦）。
 *
 * 解耦的意义：装配逻辑是**纯函数**，因此可以在 JVM 单元测试里直接验
 * （`NsdServiceInfo` 是 Android 类型，JVM 测不了）。
 */
data class LaneServiceRecord(
    val serviceName: String,
    val ip: String?,
    val port: Int,
    val attributes: Map<String, String>,
)

/**
 * 广播记录 → 发现项的装配（纯函数）。
 */
object LaneDiscoveryMapper {

    /** 桌面广播的服务类型（bonjour 形态）。 */
    const val LANE_SERVICE_TYPE = "_dsh-lane._tcp"

    /** NsdManager 要的服务类型串（末尾带点）。 */
    const val LANE_SERVICE_TYPE_QUERY = "$LANE_SERVICE_TYPE."

    /** 配对入口路径的缺省值（与桌面 `buildLaneTxt` 的默认值一致）。 */
    const val DEFAULT_PAIR_PATH = "/pair"

    /**
     * 装配发现项；记录不成形时返回 null（调用方跳过这一条）。
     *
     * ## 地址以解析出的 IP 为准
     *
     * Android 对 `.local` 的普通解析不可靠（系统解析器与 App 用的解析栈不一致），
     * 因此**不用广播里的主机名拼地址**，只用 NsdManager 解析出的 IP。
     */
    fun toHost(record: LaneServiceRecord): DiscoveredHost? {
        val ip = record.ip?.trim().orEmpty()
        if (ip.isEmpty()) return null
        val port = if (record.port > 0) {
            record.port
        } else {
            record.attributes["port"]?.trim()?.toIntOrNull() ?: 0
        }
        if (port <= 0) return null
        return DiscoveredHost(
            serviceName = record.serviceName,
            label = displayLabel(record.serviceName),
            origin = "http://$ip:$port",
            ip = ip,
            port = port,
            host = record.attributes["host"]?.trim()?.takeIf { it.isNotEmpty() },
            path = record.attributes["path"]?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_PAIR_PATH,
        )
    }

    /** 实例名去掉服务类型后缀（系统有时把 `._dsh-lane._tcp.` 也算进实例名）。 */
    fun displayLabel(serviceName: String): String {
        val name = serviceName.trim()
        val suffix = ".$LANE_SERVICE_TYPE."
        return if (name.endsWith(suffix)) name.removeSuffix(suffix) else name
    }
}

/**
 * 局域网发现器：扫 `_dsh-lane._tcp`，把发现的桌面报给监听者。
 *
 * ## 生命周期
 *
 * 扫描是**用户触发**的（管理页点「扫描」），不常驻：NsdManager 的组播订阅一直开着
 * 会耗电，且系统对后台扫描有限制。
 *
 * ## 线程
 *
 * NsdManager 的回调在 binder 线程上，本类一律转回主线程再交给监听者——
 * 监听者多半直接改界面。
 */
class LaneDiscovery(
    context: Context,
    private val listener: Listener,
) {

    /** 发现结果的接收方。 */
    interface Listener {
        /** 发现一台桌面。 */
        fun onFound(host: DiscoveredHost)

        /** 一台桌面下线（服务记录消失）。 */
        fun onLost(serviceName: String)

        /** 扫描出错（权限、组播不可用等）。 */
        fun onError(message: String)
    }

    private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val handler = Handler(Looper.getMainLooper())

    /** 解析回调的执行器（Android 14 起的新接口要显式给执行器）。 */
    private val mainExecutor = context.mainExecutor

    private var scanning = false

    /** 待解析的服务记录（NsdManager 同时只允许一个 resolve，故排队）。 */
    private val pending = ArrayDeque<NsdServiceInfo>()
    private var resolving = false

    /** Android 16+ 的服务信息回调（按服务名登记，解析完即注销）。 */
    private val infoCallbacks = LinkedHashMap<String, NsdManager.ServiceInfoCallback>()

    /**
     * 开始扫描（幂等）。
     */
    fun start() {
        if (scanning) return
        scanning = true
        nsd.discoverServices(
            LaneDiscoveryMapper.LANE_SERVICE_TYPE_QUERY,
            NsdManager.PROTOCOL_DNS_SD,
            discoveryListener,
        )
        ShellLog.info("开始扫描局域网桌面（${LaneDiscoveryMapper.LANE_SERVICE_TYPE_QUERY}）")
    }

    /**
     * 停止扫描（幂等）。
     */
    fun stop() {
        if (!scanning) return
        scanning = false
        pending.clear()
        resolving = false
        infoCallbacks.keys.toList().forEach { unregisterInfoCallback(it) }
        runCatching { nsd.stopServiceDiscovery(discoveryListener) }
            .onFailure { ShellLog.warn("停止 mDNS 扫描失败", it) }
    }

    /** 发现回调（binder 线程 → 主线程）。 */
    private val discoveryListener = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
            post {
                scanning = false
                listener.onError("无法开始扫描（错误码 $errorCode）")
            }
        }

        override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
            post { listener.onError("停止扫描失败（错误码 $errorCode）") }
        }

        override fun onDiscoveryStarted(serviceType: String?) {
            ShellLog.info("mDNS 扫描已开始")
        }

        override fun onDiscoveryStopped(serviceType: String?) {
            ShellLog.info("mDNS 扫描已停止")
        }

        override fun onServiceFound(serviceInfo: NsdServiceInfo?) {
            if (serviceInfo == null) return
            post { enqueue(serviceInfo) }
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo?) {
            val name = serviceInfo?.serviceName ?: return
            post { listener.onLost(name) }
        }
    }

    /** 解析回调（binder 线程 → 主线程）。 */
    private val resolveListener = object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
            post {
                resolving = false
                ShellLog.warn("解析 mDNS 服务失败（错误码 $errorCode）")
                resolveNext()
            }
        }
        override fun onServiceResolved(serviceInfo: NsdServiceInfo?) {
            post {
                resolving = false
                if (serviceInfo != null) handleResolved(serviceInfo)
                resolveNext()
            }
        }
    }

    /** 排队并逐个解析。 */
    private fun enqueue(serviceInfo: NsdServiceInfo) {
        pending.addLast(serviceInfo)
        resolveNext()
    }

    /** 解析队列里的下一个（一次只解析一个）。 */
    private fun resolveNext() {
        if (resolving) return
        val next = pending.removeFirstOrNull() ?: return
        resolving = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
            // Android 16 起 resolveService 整族被废弃：改用「服务信息回调」——
            // 系统把解析结果直接推过来（还能拿到后续更新）。
            registerInfoCallback(next)
        } else {
            @Suppress("DEPRECATION")
            nsd.resolveService(next, resolveListener)
        }
    }

    /** 注册服务信息回调（Android 16+ 的解析路径）。 */
    private fun registerInfoCallback(serviceInfo: NsdServiceInfo) {
        val callback = object : NsdManager.ServiceInfoCallback {
            override fun onServiceUpdated(info: NsdServiceInfo) {
                post {
                    resolving = false
                    unregisterInfoCallback(info.serviceName.orEmpty())
                    handleResolved(info)
                    resolveNext()
                }
            }
            override fun onServiceLost() {
                post {
                    resolving = false
                    resolveNext()
                }
            }
            override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                post {
                    resolving = false
                    ShellLog.warn("注册 mDNS 服务信息回调失败（错误码 $errorCode）")
                    resolveNext()
                }
            }
            override fun onServiceInfoCallbackUnregistered() {
                post { resolving = false }
            }
        }
        infoCallbacks[serviceInfo.serviceName.orEmpty()] = callback
        nsd.registerServiceInfoCallback(serviceInfo, mainExecutor, callback)
    }

    /** 注销服务信息回调（拿过一次解析结果就够了）。 */
    private fun unregisterInfoCallback(serviceName: String) {
        val callback = infoCallbacks.remove(serviceName) ?: return
        runCatching { nsd.unregisterServiceInfoCallback(callback) }
            .onFailure { ShellLog.warn("注销 mDNS 服务信息回调失败", it) }
    }

    /** 解析结果 → 发现项 → 监听者。 */
    private fun handleResolved(serviceInfo: NsdServiceInfo) {
        val host = LaneDiscoveryMapper.toHost(
            LaneServiceRecord(
                serviceName = serviceInfo.serviceName.orEmpty(),
                ip = resolveAddress(serviceInfo),
                port = serviceInfo.port,
                attributes = decodeAttributes(serviceInfo),
            ),
        )
        if (host != null) {
            listener.onFound(host)
        } else {
            ShellLog.warn("mDNS 记录不成形，已跳过：${serviceInfo.serviceName}")
        }
    }


    /**
     * 解析出的地址（IP）。
     *
     * Android 14 起 [NsdServiceInfo.getHost] 被废弃，多地址形态走 [NsdServiceInfo.getHostAddresses]；
     * 旧版本只有单地址。**地址以这里的解析结果为准**，不用广播里的主机名拼。
     */
    private fun resolveAddress(serviceInfo: NsdServiceInfo): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return serviceInfo.hostAddresses.firstOrNull()?.hostAddress
        }
        @Suppress("DEPRECATION")
        return serviceInfo.host?.hostAddress
    }
    /** TXT 记录解码（键 → UTF-8 字符串）。 */
    private fun decodeAttributes(serviceInfo: NsdServiceInfo): Map<String, String> {
        val attributes = serviceInfo.attributes ?: return emptyMap()
        val result = LinkedHashMap<String, String>()
        attributes.forEach { (key, value) ->
            result[key] = String(value, Charsets.UTF_8)
        }
        return result
    }

    /** 转主线程回调。 */
    private fun post(action: () -> Unit) {
        handler.post { action() }
    }
}
