package com.plus.mobile.android

import android.app.Application
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.connect.HostProbe
import com.plus.mobile.android.shell.host.EncryptedHostRegistry
import com.plus.mobile.android.shell.host.HostRegistry
import com.plus.mobile.android.shell.lock.LockController
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.pair.LanePairingClient
import com.plus.mobile.android.shell.pair.PairingService
import com.plus.mobile.android.shell.store.KeyValueStore
import com.plus.mobile.android.shell.store.MemoryKeyValueStore
import com.plus.mobile.android.shell.store.SecurePreferences
import com.plus.mobile.android.shell.store.ShellPreferences
import com.plus.mobile.android.shell.ui.AppearanceSettings
import com.plus.mobile.android.shell.update.ApkDownloader
import com.plus.mobile.android.shell.update.ApkInstaller
import com.plus.mobile.android.shell.update.UpdateCoordinator
import com.plus.mobile.android.shell.update.UpdateFeedClient
import com.plus.mobile.android.shell.update.UpdateNoticeStore

/**
 * 壳的装配点：进程级单例都在这里建。
 *
 * 依赖方向是单向的：
 * `store`（加密存储） → `host`（主机仓库） → `pair` / `connect`（配对与连接） → `ui`（界面）。
 * 界面之间不直接互相调用：管理页改「当前主机」，主界面回前台时自己发现并切代理目标。
 */
class MobileApp : Application() {

    /** 主机仓库（凭证在加密存储里）。 */
    lateinit var registry: HostRegistry
        private set

    /** 非凭证偏好（生物锁开关、更新提醒开关）。 */
    lateinit var preferences: ShellPreferences
        private set

    /** 配对服务（链接 → 凭证 → 主机条目）。 */
    lateinit var pairing: PairingService
        private set

    /** 生物锁状态机。 */
    lateinit var lock: LockController
        private set

    /** 主机探测（往返延迟）。 */
    lateinit var probe: HostProbe
        private set

    /** 更新提醒编排者（检查 → 提醒 → 下载 → 拉起系统安装器）。 */
    lateinit var updates: UpdateCoordinator
        private set

    override fun onCreate() {
        super.onCreate()

        // 外观（跟随系统 / 浅色 / 深色）：要在任何界面起来之前定下来。
        AppearanceSettings.applyToApp(AppearanceSettings.load(this))
        val store: KeyValueStore = SecurePreferences.open(this) ?: MemoryKeyValueStore()
        registry = EncryptedHostRegistry(store)
        preferences = ShellPreferences(store)
        val client = LaneHttpClient()
        pairing = PairingService(registry, LanePairingClient(client))
        lock = LockController(preferences)
        probe = HostProbe(client)
        updates = UpdateCoordinator(
            preferences = preferences,
            noticeStore = UpdateNoticeStore(preferences),
            // feed 地址可被本地 override 换掉（验证时指向本机 http 服务）。
            feedClient = UpdateFeedClient(feedUrlProvider = {
                preferences.updateFeedOverride?.takeIf { it.isNotBlank() } ?: BuildConfig.UPDATE_FEED_URL
            }),
            downloader = ApkDownloader(this),
            installer = ApkInstaller(this),
            currentVersion = BuildConfig.VERSION_NAME,
        )
        ShellLog.info(
            "壳已启动：主机 ${registry.list().size} 台，当前 ${registry.current()?.displayName ?: "无"}",
        )
    }
}
