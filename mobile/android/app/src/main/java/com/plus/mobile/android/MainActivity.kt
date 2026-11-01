package com.plus.mobile.android

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.ShellSettings
import com.plus.mobile.android.shell.boot.BootPayloadProvider
import com.plus.mobile.android.shell.boot.BootPayloadStore
import com.plus.mobile.android.shell.bridge.MobileBridge
import com.plus.mobile.android.shell.bridge.MobileBridgeHost
import com.plus.mobile.android.shell.bridge.NativeRequestBridge
import com.plus.mobile.android.shell.connect.HostConnector
import com.plus.mobile.android.shell.connect.KeepaliveService
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.host.HostForm
import com.plus.mobile.android.shell.host.HostStatus
import com.plus.mobile.android.shell.lock.LockController
import com.plus.mobile.android.shell.net.LaneHttpClient
import com.plus.mobile.android.shell.page.DistAssetHandler
import com.plus.mobile.android.shell.page.DocumentStartInstaller
import com.plus.mobile.android.shell.page.LaneRequestForwarder
import com.plus.mobile.android.shell.page.PageRequestRouter
import com.plus.mobile.android.shell.pair.LanePairingClient
import com.plus.mobile.android.shell.ui.HostVisuals
import com.plus.mobile.android.shell.ui.LockActivity
import com.plus.mobile.android.shell.ui.ManagementActivity
import com.plus.mobile.android.shell.ui.UpdateNoticeBar
import com.plus.mobile.android.shell.update.InstallOutcome
import com.plus.mobile.android.shell.update.UpdateCheckResult
import com.plus.mobile.android.shell.update.UpdateOffer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android 生产壳的主界面（票 #60 的骨架 + 票 #61 的多主机与凭证）。
 *
 * 结构（分层）：
 *  - 页面 origin：`https://appassets.androidplatform.net`（WebViewAssetLoader 提供真实 origin，
 *    `file://` 不可行——见 wayfinder #50 原型结论）；
 *  - 页面文档：壳内自带的 upstream dist（assets/dist，构建产物，不入库）；
 *  - 数据面：文档相对请求（`/api/`、`/plugins/`、`/assets/`）转发到当前主机 lane，
 *    凭证由壳附加；页面 JS 永远拿不到凭证；
 *  - WebSocket：页面带签名令牌直连 lane（`ws(s)://<lane>/__dsh_ws/<令牌>/`），壳不再中继；
 *  - 引导：注入行（facade / `__DSH_BOOT__` / bootstrap combo / 其余主机注入）从 lane 拉取，
 *    document-start 注入；`__DSH_TRANSPORT__` 装 streamBaseUrl / createWebSocket / ownsHost；
 *  - 壳桥：`window.dshMobile` 提供 hosts / current / switchHost；
 *  - 凭证：主机条目在 Keystore 加密存储里，cookie 不进 WebView 的 CookieManager。
 */
class MainActivity : AppCompatActivity(), MobileBridgeHost {

    private lateinit var webView: WebView
    private lateinit var statusView: TextView
    private lateinit var statusDot: View

    private val app: MobileApp get() = application as MobileApp

    /** 主机仓库（凭证在加密存储里）。 */
    private val registry get() = app.registry

    private val payloadStore = BootPayloadStore()
    private val httpClient = LaneHttpClient()
    private val payloadProvider = BootPayloadProvider(httpClient)
    private val pairingClient = LanePairingClient(httpClient)

    /** 连接器：候选地址重试 + 失效降级链（renew / accept / 标记需重配）。 */
    private val connector: HostConnector by lazy {
        HostConnector(registry, payloadProvider, pairingClient)
    }

    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    /** 更新提醒条（Snackbar 形态）。 */
    private lateinit var updateBar: UpdateNoticeBar

    /**
     * 浮层主机切换器（原型定稿变体 A）：右下角标 → 底部抽屉 → 主机列表。
     *
     * 叠在 WebView 之上；数据源是壳内的主机仓库（原生层，不经 JS 桥）。
     */
    private val hostSwitcher: HostSwitcherOverlay by lazy { HostSwitcherOverlay() }

    /** 当前待安装的更新（提醒条上的「下载安装」用它）。 */
    private var pendingOffer: UpdateOffer? = null

    /** 页面是否已经装载过（决定回前台要不要 reload）。 */
    private var pageLoaded = false

    /** 正在换主机（载荷未就位）：此时回前台不重载，避免用旧载荷重载。 */
    private var switching = false

    /** 当前已装载的主机 id（用来发现「当前主机」被换掉了）。 */
    private var loadedHostId: String? = null

    /** 解锁结果。 */
    private val unlockLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            syncCurrentHost()
            hostSwitcher.refresh()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildLayout()
        configureWebView()
        installBridges()
        applyHostFromIntent(intent)
        applyUpdateFeedFromIntent(intent)
        maybeCheckUpdate()
    }

    override fun onDestroy() {
        super.onDestroy()
        KeepaliveService.stop(this)
    }

    /** singleTop 启动时新意图走这里：adb 重新带主机参数时能切到新主机。 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyHostFromIntent(intent)
        applyUpdateFeedFromIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        // 生物锁：冷启动与后台超时回前台都要验证。
        val reason = app.lock.needsUnlock()
        if (reason != null) {
            promptUnlock(
                if (reason == LockController.LockReason.BACKGROUND) {
                    LockActivity.REASON_BACKGROUND
                } else {
                    LockActivity.REASON_COLD
                },
            )
            return
        }
        syncCurrentHost()
        maybeCheckUpdate()
        hostSwitcher.refresh()
    }

    override fun onStop() {
        super.onStop()
        app.lock.onBackground()
    }

    /**
     * 回前台后的同步：当前主机被换掉了就切代理目标 + 重载页面；否则按需重连。
     */
    private fun syncCurrentHost() {
        val current = registry.current()
        if (current == null) {
            statusView.text = getString(R.string.status_no_host)
            HostVisuals.bindDot(statusDot, HostStatus.UNKNOWN)
            KeepaliveService.stop(this)
            return
        }
        if (current.id != loadedHostId) {
            applyHost(current)
            return
        }
        // 回前台不重载页面：页面状态保全交给官方 generation 重连机制——
        // 进程活着时 WS 断线由页面按退避自愈；壳的任何主动 reload 都会摧毁页面状态。
    }

    /** 拉起锁屏。 */
    private fun promptUnlock(reason: String) {
        unlockLauncher.launch(
            Intent(this, LockActivity::class.java).putExtra(LockActivity.EXTRA_REASON, reason),
        )
    }

    // ── 界面 ────────────────────────────────────────────────────────────────

    private fun buildLayout() {
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.web_view)
        // WebView 默认白底，页面没装载时是一块白；改成基面深色。
        webView.setBackgroundColor(getColor(R.color.dsh_bg_base))
        statusView = findViewById(R.id.status_text)
        statusDot = findViewById(R.id.status_dot)
        findViewById<TextView>(R.id.btn_manage).setOnClickListener {
            startActivity(Intent(this, ManagementActivity::class.java))
        }
        updateBar = findViewById(R.id.update_notice)
        updateBar.onDownload = { startUpdateDownload() }
        updateBar.onIgnore = { ignoreUpdateVersion() }
        // 浮层切换器：视图已就位，这里做首次渲染。
        hostSwitcher.refresh()
    }

    // ── WebView ─────────────────────────────────────────────────────────────

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            // 页面是本地资产的 https origin，而 lane 是局域网明文 http：
            // 页面里的 WebSocket（网关 mux）因此是「混合内容」，Chromium 默认直接拦掉
            // （“attempted to connect to the insecure WebSocket endpoint ws://…/api/remote.mux”），
            // 对话与流式输出就完全不可用。壳的信任边界是「本地资产 + 用户自配的那台主机」，
            // 故放开混合内容：WebView 侧只有本壳的页面与用户指定的主机。
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        // 凭证不进 WebView 的 CookieManager：cookie 只存在 Keystore 加密存储里，
        // 出站时由壳解密附加（转发器 / 原生请求桥 / WS 中继）。
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val bootScript = assets.open(ShellSettings.BOOT_SCRIPT_ASSET).bufferedReader().readText()
        val documentStartAvailable = DocumentStartInstaller(webView).install(bootScript)

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler(
                "/",
                DistAssetHandler(
                    assets = assets,
                    rootDir = ShellSettings.DIST_ASSET_DIR,
                    // 旧 WebView 没有 document-start 注入时，把引导脚本内联进文档（等价效果）。
                    documentTransform = if (documentStartAvailable) {
                        null
                    } else {
                        { html -> inlineBootScript(html, bootScript) }
                    },
                ),
            )
            .build()
        val forwarder = LaneRequestForwarder(
            hostProvider = { registry.current() },
            client = httpClient,
            documentBasePath = "",
        )
        val router = PageRequestRouter(assetLoader, payloadStore, forwarder)

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = router.route(request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // 页面 origin 之外的导航（release 链接等）交给系统浏览器。
                if (request.url.host != ShellSettings.PAGE_HOST) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                    return true
                }
                return false
            }
        }
    }

    private fun inlineBootScript(html: String, script: String): String {
        val head = Regex("<head(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE).find(html) ?: return html
        val at = head.range.first + head.value.length
        val inline = "<script>\n$script\n</script>\n"
        return html.substring(0, at) + inline + html.substring(at)
    }

    // ── 壳桥 ────────────────────────────────────────────────────────────────

    private fun installBridges() {
        webView.addJavascriptInterface(
            NativeRequestBridge({ registry.current() }, httpClient, ""),
            ShellSettings.NATIVE_BRIDGE_NAME,
        )
        webView.addJavascriptInterface(MobileBridge(this), ShellSettings.MOBILE_BRIDGE_NAME)
    }

    override fun hostsJson(): String {
        val array = JSONArray()
        val currentId = registry.current()?.id
        registry.list().forEach { host ->
            array.put(
                JSONObject()
                    .put("id", host.id)
                    .put("label", host.label.ifBlank { host.displayOrigin })
                    .put("origin", host.laneOrigin)
                    .put("address", host.displayOrigin)
                    .put("form", host.form.code)
                    .put("candidates", JSONArray().apply {
                        host.candidates.forEach { put(HostEntry.displayAddress(it)) }
                    })
                    .put("status", host.status.code)
                    .put("current", host.id == currentId),
            )
        }
        return array.toString()
    }

    override fun currentJson(): String {
        val host = registry.current() ?: return JSONObject().toString()
        return JSONObject()
            .put("id", host.id)
            .put("label", host.label.ifBlank { host.displayOrigin })
            .put("origin", host.laneOrigin)
            .put("address", host.displayOrigin)
            .put("form", host.form.code)
            .put("status", host.status.code)
            .toString()
    }

    override fun switchHost(id: String): Boolean {
        val host = registry.find(id) ?: return false
        runOnUiThread {
            Toast.makeText(this, getString(R.string.toast_switching_host, host.displayName), Toast.LENGTH_SHORT).show()
            applyHost(host)
        }
        return true
    }

    // ── 主机 ────────────────────────────────────────────────────────────────

    /**
     * 从启动参数取主机（调试 / 联调入口）。
     *
     * 正式路径是配对（扫二维码 / 粘贴链接）；这条入口保留给自动化验证与本地联调：
     * `adb shell am start -n io.github.hyperion2144.dsh.plusm/com.plus.mobile.android.MainActivity --es lane_origin http://<host>:3093 --es host_cookie <cookie>`
     * 地址候选（可选）：`--es host_candidates "<base1>,<base2>"`，逗号分隔，按序重试。
     */
    private fun applyHostFromIntent(intent: Intent?) {
        val origin = intent?.getStringExtra(EXTRA_LANE_ORIGIN)?.trim().orEmpty()
        if (origin.isEmpty()) {
            // 没有注入参数：当前主机由 syncCurrentHost 统一处理（回前台时连接），避免连两次。
            return
        }
        val trimmed = origin.trimEnd('/')
        val host = HostEntry(
            id = trimmed,
            label = intent?.getStringExtra(EXTRA_HOST_LABEL)?.trim().orEmpty().ifEmpty { trimmed },
            laneOrigin = trimmed,
            sessionCookie = intent?.getStringExtra(EXTRA_HOST_COOKIE)?.trim()?.ifEmpty { null },
            form = HostForm.of(trimmed),
            candidates = intent?.getStringExtra(EXTRA_HOST_CANDIDATES)
                ?.split(',')
                ?.map { it.trim().trimEnd('/') }
                ?.filter { it.isNotEmpty() }
                ?.takeIf { it.isNotEmpty() }
                ?: listOf(trimmed),
        )
        registry.upsert(host)
        applyHost(host)
    }

    /**
     * 从启动参数取更新源 override（调试 / 验证入口）。
     *
     * `adb shell am start -n io.github.hyperion2144.dsh.plusm/com.plus.mobile.android.MainActivity \
     *   --es update_feed http://10.0.2.2:8765/nightly-android.yml`
     *
     * 生产地址是 BuildConfig.UPDATE_FEED_URL；本机验证时把 feed 指到本地 http 服务。
     */
    private fun applyUpdateFeedFromIntent(intent: Intent?) {
        val feed = intent?.getStringExtra(EXTRA_UPDATE_FEED)?.trim().orEmpty()
        if (feed.isEmpty()) return
        app.preferences.updateFeedOverride = feed
        ShellLog.info("更新源 override：$feed")
    }

    /** 应用一台主机：连接（含降级链）→ 取引导载荷 → 装载页面。 */
    private fun applyHost(host: HostEntry) {
        registry.setCurrent(host.id)
        switching = true
        statusView.text = getString(R.string.status_connecting, host.displayName)
        HostVisuals.bindDot(statusDot, HostStatus.UNKNOWN)
        scope.launch {
            when (val outcome = connector.connect(host)) {
                is HostConnector.ConnectOutcome.Connected -> {
                    payloadStore.set(outcome.payload)
                    switching = false
                    loadedHostId = outcome.host.id
                    statusView.text = getString(R.string.status_connected, outcome.host.displayName)
                    HostVisuals.bindDot(statusDot, HostStatus.CONNECTED)
                    loadPage()
                    KeepaliveService.start(this@MainActivity)
                }
                is HostConnector.ConnectOutcome.NeedsRepair -> {
                    switching = false
                    // 不改 loadedHostId：这一台没连上，下次回前台要重试，而不是当成「已装载」。
                    statusView.text = getString(R.string.status_needs_repair, outcome.reason)
                    HostVisuals.bindDot(statusDot, HostStatus.NEEDS_REPAIR)
                    Toast.makeText(
                        this@MainActivity,
                        getString(R.string.toast_needs_repair, outcome.host.displayName, outcome.reason),
                        Toast.LENGTH_LONG,
                    ).show()
                }
                is HostConnector.ConnectOutcome.Offline -> {
                    switching = false
                    // 同上：没连上就不算已装载，下次回前台重试。
                    statusView.text = getString(R.string.status_failed, outcome.reason)
                    HostVisuals.bindDot(statusDot, HostStatus.OFFLINE)
                }
            }
            // 连接结论落地：角标与列表里的状态点跟着更新。
            hostSwitcher.refresh()
        }
    }

    private fun loadPage() {
        webView.loadUrl(ShellSettings.PAGE_ORIGIN + ShellSettings.DOCUMENT_PATH)
        pageLoaded = true
    }

    /**
     * 切换到指定主机：改代理目标 + 重载页面。
     *
     * 会话在桌面侧，切壳不丢会话；页面重载后由新主机的引导载荷重建连接。
     * 走的是与顶栏「主机」入口同一套连接逻辑（[applyHost]）。
     */
    private fun switchToHost(host: HostEntry) {
        registry.setCurrent(host.id)
        hostSwitcher.refresh()
        Toast.makeText(
            this,
            getString(R.string.toast_switching_host, host.displayName),
            Toast.LENGTH_SHORT,
        ).show()
        applyHost(host)
    }

    // ── 更新提醒 ────────────────────────────────────────────────────────────────

    /**
     * 启动 / 回前台检查更新。
     *
     * 没网、元数据拉取失败、已是最新——全部**静默降级**：只记日志，不弹窗、不阻塞启动。
     */
    private fun maybeCheckUpdate() {
        val updates = app.updates
        if (!updates.shouldCheckNow()) return
        scope.launch {
            when (val result = updates.check()) {
                is UpdateCheckResult.Available -> {
                    // 记下已提醒过的最高版本：同一个版本不重复提醒（桌面 update-notice 契约）。
                    updates.markNotified(result.offer.version)
                    pendingOffer = result.offer
                    updateBar.showOffer(result.offer.version, result.offer.size)
                }
                else -> Unit
            }
        }
    }

    /** 下载 apk → 校验 → 拉起系统安装器。 */
    private fun startUpdateDownload() {
        val offer = pendingOffer ?: return
        scope.launch {
            when (val outcome = app.updates.downloadAndInstall(offer) { downloaded, total ->
                updateBar.showProgress(downloaded, total)
            }) {
                is InstallOutcome.ReadyToInstall -> {
                    Toast.makeText(this@MainActivity, R.string.update_install_started, Toast.LENGTH_SHORT).show()
                    runCatching { startActivity(outcome.intent) }
                        .onFailure { updateBar.showError(it.message ?: "无法拉起安装器") }
                }
                InstallOutcome.NeedInstallPermission -> {
                    Toast.makeText(this@MainActivity, R.string.update_permission_needed, Toast.LENGTH_LONG).show()
                    // 已下载完，只差授权：回来再点一次就直接拉起安装器。
                    updateBar.showInstallReady(offer.version, offer.size)
                    runCatching { startActivity(app.updates.installPermissionIntent()) }
                        .onFailure { updateBar.showError(it.message ?: "无法打开系统设置") }
                }
                is InstallOutcome.Failed -> updateBar.showError(outcome.reason)
            }
        }
    }

    /** 「不再提示此版本」：拉黑该版本（桌面 update-notice 契约）。 */
    private fun ignoreUpdateVersion() {
        val offer = pendingOffer ?: return
        app.updates.ignoreVersion(offer.version)
        Toast.makeText(this, getString(R.string.update_ignored_version, offer.version), Toast.LENGTH_SHORT).show()
        pendingOffer = null
        updateBar.hide()
    }

    /**
     * 浮层主机切换器（原型定稿变体 A）。
     *
     * 结构：右下角胶囊（「⇄ 切换」）→ 底部抽屉（主机列表）→ 选中即切换。
     *
     * ## 视觉与数据
     *
     * - 颜色：状态点与形态徽标走 [HostVisuals]（与管理页同一套映射），其余用 dsh token；
     * - 数据：壳内的主机仓库（原生层），不经 JS 桥；主机列表变化时 [refresh] 重建。
     *
     * ## 切换语义
     *
     * 切换 = 壳改代理目标 + 页面重载（见 [switchToHost]）；会话在桌面侧，不丢。
     */
    private inner class HostSwitcherOverlay {
        private val scrim: View = findViewById(R.id.host_switcher_scrim)
        private val sheet: View = findViewById(R.id.host_switcher_sheet)
        private val list: LinearLayout = findViewById(R.id.host_switcher_list)
        private val scroll: ScrollView = findViewById(R.id.host_switcher_scroll)

        /** 抽屉是否打开。 */
        var isOpen: Boolean = false
            private set

        /** 返回键：抽屉开着时先关抽屉，不退出界面。 */
        private val backCallback = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                closeDrawer()
            }
        }

        init {
            scrim.setOnClickListener { closeDrawer() }
            onBackPressedDispatcher.addCallback(this@MainActivity, backCallback)
        }

        /** 刷新角标与列表（主机列表或连接状态变化时）。 */
        fun refresh() {
            val current = registry.current()
            // 页面内不再放悬浮切换按钮（会遮挡 DSH 内容）；切主机走顶栏入口进管理页。
            if (isOpen) renderRows()
        }

        /** 开合切换。 */
        fun toggleDrawer() {
            if (isOpen) closeDrawer() else openDrawer()
        }

        /** 打开抽屉。 */
        fun openDrawer() {
            if (isOpen) return
            isOpen = true
            backCallback.isEnabled = true
            renderRows()
            scrim.animate().cancel()
            sheet.animate().cancel()
            scrim.visibility = View.VISIBLE
            scrim.alpha = 0f
            sheet.visibility = View.VISIBLE
            sheet.alpha = 0f
            sheet.post {
                if (!isOpen) return@post
                val sheetHeight = sheet.height.toFloat()
                sheet.translationY = sheetHeight
                sheet.animate()
                    .translationY(0f)
                    .alpha(1f)
                    .setDuration(SHEET_ANIMATION_MS)
                    .setInterpolator(DecelerateInterpolator())
                    .start()
            }
            scrim.animate().alpha(1f).setDuration(SCRIM_ANIMATION_MS).start()
        }

        /** 关闭抽屉（遮罩点击 / 返回键 / 选中主机都走这里）。 */
        fun closeDrawer() {
            if (!isOpen) return
            isOpen = false
            backCallback.isEnabled = false
            scrim.animate().cancel()
            sheet.animate().cancel()
            scrim.visibility = View.VISIBLE
            scrim.alpha = 1f
            sheet.visibility = View.VISIBLE
            sheet.alpha = 1f
            scrim.animate()
                .alpha(0f)
                .setDuration(SCRIM_ANIMATION_MS)
                .withEndAction { if (!isOpen) scrim.visibility = View.GONE }
                .start()
            sheet.animate()
                .translationY(sheet.height.toFloat())
                .alpha(0f)
                .setDuration(SHEET_ANIMATION_MS)
                .withEndAction { if (!isOpen) sheet.visibility = View.GONE }
                .start()
        }


        /** 渲染主机行列表。 */
        private fun renderRows() {
            list.removeAllViews()
            val hosts = registry.list()
            if (hosts.isEmpty()) {
                list.addView(emptyRow())
                return
            }
            val currentId = registry.current()?.id
            hosts.forEach { host ->
                list.addView(hostRow(host, host.id == currentId))
            }
            clampListHeight()
        }

        /** 主机列表的一行：状态点 / 名字 / 副行 / 形态徽标 /「当前」。 */
        private fun hostRow(host: HostEntry, isCurrent: Boolean): View {
            val row = LayoutInflater.from(this@MainActivity)
                .inflate(R.layout.item_host_switcher_row, list, false)
            row.findViewById<TextView>(R.id.switcher_name).text = host.displayName
            row.findViewById<TextView>(R.id.switcher_detail).text = detailLine(host)
            HostVisuals.bindDot(row.findViewById(R.id.switcher_dot), host.status)
            HostVisuals.bindBadge(row.findViewById(R.id.switcher_form), host.form)
            row.findViewById<TextView>(R.id.switcher_current).visibility =
                if (isCurrent) View.VISIBLE else View.GONE
            row.setOnClickListener {
                closeDrawer()
                if (isCurrent) {
                    Toast.makeText(
                        this@MainActivity,
                        R.string.toast_already_current,
                        Toast.LENGTH_SHORT,
                    ).show()
                    return@setOnClickListener
                }
                switchToHost(host)
            }
            return row
        }

        /** 副行：地址 · 状态 · （设备已配对）。 */
        private fun detailLine(host: HostEntry): String {
            val parts = mutableListOf(host.displayOrigin, stateLabel(host.status))
            if (host.deviceId != null) parts.add(getString(R.string.host_paired_hint))
            return parts.joinToString(" · ")
        }

        /** 状态文案（与管理页同一套字符串）。 */
        private fun stateLabel(status: HostStatus): String = getString(
            when (status) {
                HostStatus.CONNECTED -> R.string.host_state_connected
                HostStatus.OFFLINE -> R.string.host_state_offline
                HostStatus.NEEDS_REPAIR -> R.string.host_state_needs_repair
                HostStatus.UNKNOWN -> R.string.host_state_unknown
            },
        )

        /** 没有主机时的一行提示。 */
        private fun emptyRow(): View = TextView(this@MainActivity).apply {
            text = getString(R.string.dialog_no_host)
            setTextColor(getColor(R.color.dsh_label_caption))
            textSize = 11f
            val padding = resources.getDimensionPixelSize(R.dimen.dsh_row_padding)
            setPadding(padding, padding, padding, padding)
        }

        /** 主机很多时限制列表高度（抽屉不越过屏幕的六成）。 */
        private fun clampListHeight() {
            val maxHeight = (resources.displayMetrics.heightPixels * LIST_HEIGHT_RATIO).toInt()
            list.measure(
                View.MeasureSpec.makeMeasureSpec(
                    resources.displayMetrics.widthPixels,
                    View.MeasureSpec.AT_MOST,
                ),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            val params = scroll.layoutParams
            params.height = if (list.measuredHeight > maxHeight) {
                maxHeight
            } else {
                ViewGroup.LayoutParams.WRAP_CONTENT
            }
            scroll.layoutParams = params
        }
    }

    private companion object {
        const val EXTRA_LANE_ORIGIN = "lane_origin"
        const val EXTRA_HOST_LABEL = "host_label"
        const val EXTRA_HOST_COOKIE = "host_cookie"
        const val EXTRA_UPDATE_FEED = "update_feed"
        const val EXTRA_HOST_CANDIDATES = "host_candidates"

        /** 抽屉滑入 / 滑出的时长（毫秒）。 */
        const val SHEET_ANIMATION_MS = 220L
        /** 遮罩淡入 / 淡出的时长（毫秒）。 */
        const val SCRIM_ANIMATION_MS = 180L
        /** 主机列表最多占屏幕的成数（抽屉不越过这个高度）。 */
        const val LIST_HEIGHT_RATIO = 0.55f
    }
}
