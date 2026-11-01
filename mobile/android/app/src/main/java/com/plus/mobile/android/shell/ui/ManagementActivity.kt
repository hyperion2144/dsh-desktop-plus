package com.plus.mobile.android.shell.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import com.plus.mobile.android.MobileApp
import com.plus.mobile.android.R
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.discovery.DiscoveredHost
import com.plus.mobile.android.shell.discovery.LaneDiscovery
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.host.HostForm
import com.plus.mobile.android.shell.host.HostStatus
import com.plus.mobile.android.shell.lock.LockController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay

/**
 * 原生管理页（原型定稿变体 A）。
 *
 * 结构：当前主机大卡 → 主机卡片列表 → 偏好分组 → 右下 FAB 进配对。
 *
 * ## 与主界面的关系
 *
 * 管理页不直接操作 WebView：切主机 = 改「当前主机」，主界面（[com.plus.mobile.android.MainActivity]）
 * 回前台时发现当前主机变了，就切代理目标 + 重载页面。**会话在桌面侧，不丢。**
 *
 * 敏感操作（配对、移除主机）要先过生物锁。
 */
class ManagementActivity : AppCompatActivity() {

    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    /** 待执行的敏感动作：解锁通过后才跑。 */
    private var pendingAction: (() -> Unit)? = null

    /** 局域网发现器（mDNS；用户点「扫描」时才开）。 */
    private var discovery: LaneDiscovery? = null

    /** 已发现的桌面（按服务名去重）。 */
    private val discovered = LinkedHashMap<String, DiscoveredHost>()

    private val unlockLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val action = pendingAction
            pendingAction = null
            action?.invoke()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_management)

        findViewById<ImageView>(R.id.btn_back).setOnClickListener { finish() }
        findViewById<ImageButton>(R.id.fab_pair).setOnClickListener {
            requireUnlock { startActivity(Intent(this, PairingActivity::class.java)) }
        }

        discovery = LaneDiscovery(this, discoveryListener)
        findViewById<TextView>(R.id.btn_discovery_scan).setOnClickListener { scanForHosts() }

        val updateSwitch = findViewById<SwitchCompat>(R.id.switch_update)
        updateSwitch.isChecked = app.preferences.updateReminderEnabled
        updateSwitch.setOnCheckedChangeListener { _, checked ->
            app.preferences.updateReminderEnabled = checked
        }

        val lockSwitch = findViewById<SwitchCompat>(R.id.switch_lock)
        lockSwitch.isChecked = app.lock.enabled
        lockSwitch.setOnCheckedChangeListener { _, checked ->
            app.lock.enabled = checked
        }
        // 外观：跟随系统 / 浅色 / 深色（选中即生效，不用重启）。
        findViewById<View>(R.id.pref_appearance_row).setOnClickListener { showAppearanceDialog() }
        bindAppearance()
    }

    override fun onResume() {
        super.onResume()
        render()
        // 后台超时回前台：这一屏也要过锁。
        val reason = app.lock.needsUnlock()
        if (reason != null) {
            promptUnlock(
                if (reason == LockController.LockReason.BACKGROUND) {
                    LockActivity.REASON_BACKGROUND
                } else {
                    LockActivity.REASON_COLD
                },
            )
        }
        measureLatency()
    }

    override fun onStop() {
        super.onStop()
        app.lock.onBackground()
        // 扫描是用户触发的，离开页面就停（组播订阅不能一直挂着）。
        discovery?.stop()
    }

    // ── 渲染 ────────────────────────────────────────────────────────────────

    /** 重建当前主机大卡与主机列表。 */
    private fun render() {
        val registry = app.registry
        val hosts = registry.list()
        val current = registry.current()

        findViewById<TextView>(R.id.group_hosts).text =
            getString(R.string.management_group_hosts) + "（${hosts.size}）"

        val list = findViewById<LinearLayout>(R.id.host_list)
        list.removeAllViews()
        hosts.forEachIndexed { index, host ->
            if (index > 0) {
                list.addView(divider())
            }
            list.addView(hostRow(host, current?.id == host.id))
        }

        bindCurrent(current)
        renderDiscovery()
    }

    /** 当前主机大卡：状态点 / 名字 / origin / 形态徽标 / 延迟。 */
    private fun bindCurrent(host: HostEntry?) {
        val nameView = findViewById<TextView>(R.id.name_current)
        val formView = findViewById<TextView>(R.id.form_current)
        val detailView = findViewById<TextView>(R.id.detail_current)
        val latencyView = findViewById<TextView>(R.id.latency_current)
        val dotView = findViewById<View>(R.id.dot_current)

        if (host == null) {
            nameView.text = getString(R.string.management_no_host)
            detailView.text = ""
            latencyView.text = ""
            formView.visibility = View.GONE
            HostVisuals.bindDot(dotView, HostStatus.UNKNOWN)
            return
        }

        nameView.text = host.displayName
        detailView.text = detailLine(host)
        latencyView.text = host.latencyMs?.let { getString(R.string.host_latency, it) }.orEmpty()
        HostVisuals.bindDot(dotView, host.status)
        HostVisuals.bindBadge(formView, host.form)
    }

    /** 大卡的副标题：地址 · 状态 · （已配对）· （需重配原因）。 */
    private fun detailLine(host: HostEntry): String {
        val parts = mutableListOf(host.displayOrigin, stateLabel(host.status))
        if (host.deviceId != null) parts.add(getString(R.string.host_paired_hint))
        host.statusReason?.let { parts.add(it) }
        if (host.form == HostForm.TUNNEL) {
            host.tunnelReachable?.let {
                parts.add(if (it) "隧道可达" else "隧道不可达")
            }
        }
        return parts.joinToString(" · ")
    }

    /** 状态文案。 */
    private fun stateLabel(status: HostStatus): String = getString(
        when (status) {
            HostStatus.CONNECTED -> R.string.host_state_connected
            HostStatus.OFFLINE -> R.string.host_state_offline
            HostStatus.NEEDS_REPAIR -> R.string.host_state_needs_repair
            HostStatus.UNKNOWN -> R.string.host_state_unknown
        },
    )

    /** 主机列表的一行。 */
    private fun hostRow(host: HostEntry, isCurrent: Boolean): View {
        val row = LayoutInflater.from(this).inflate(R.layout.item_host_row, null, false)
        row.findViewById<TextView>(R.id.name_row).text = host.displayName
        row.findViewById<TextView>(R.id.origin_row).text = host.displayOrigin
        HostVisuals.bindDot(row.findViewById(R.id.dot_row), host.status)
        HostVisuals.bindBadge(row.findViewById(R.id.form_row), host.form)
        row.findViewById<TextView>(R.id.current_row).visibility = if (isCurrent) View.VISIBLE else View.GONE

        row.setOnClickListener {
            if (isCurrent) {
                Toast.makeText(this, R.string.toast_already_current, Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            app.registry.setCurrent(host.id)
            Toast.makeText(this, getString(R.string.toast_switching_host, host.displayName), Toast.LENGTH_SHORT).show()
            finish()
        }
        row.setOnLongClickListener {
            showHostMenu(host)
            true
        }
        return row
    }

    /** 行之间的分隔线。 */
    private fun divider(): View = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            1,
        )
        setBackgroundColor(getColor(R.color.dsh_border_l1))
    }

    // ── 外观 ────────────────────────────────────────────────────────────────

    /** 外观行：当前值文案。 */
    private fun bindAppearance() {
        findViewById<TextView>(R.id.pref_appearance_value).text =
            getString(AppearanceSettings.labelRes(AppearanceSettings.load(this)))
    }

    /** 选外观：跟随系统 / 浅色 / 深色；选中即写盘并生效，不用重启。 */
    private fun showAppearanceDialog() {
        val values = AppearanceSettings.VALUES
        val labels = values.map { getString(AppearanceSettings.labelRes(it)) }.toTypedArray()
        val checked = values.indexOf(AppearanceSettings.load(this)).coerceAtLeast(0)
        AlertDialog.Builder(this)
            .setTitle(R.string.pref_appearance_title)
            .setSingleChoiceItems(labels, checked) { dialog, which ->
                val picked = values[which]
                // 先关对话框：换模式会重建界面，挂着对话框会被算成窗口泄漏。
                dialog.dismiss()
                AppearanceSettings.save(this, picked)
                bindAppearance()
                AppearanceSettings.applyToApp(picked)
            }
            .setNegativeButton(R.string.dialog_cancel, null)
            .show()
    }

    // ── 动作 ────────────────────────────────────────────────────────────────

    /** 移除主机（敏感操作）。 */
    private fun confirmRemove(host: HostEntry) {
        AlertDialog.Builder(this)
            .setTitle(R.string.dialog_remove_host_title)
            .setMessage(getString(R.string.dialog_remove_host_message, host.displayName))
            .setNegativeButton(R.string.dialog_cancel, null)
            .setPositiveButton(R.string.dialog_confirm) { _, _ ->
                app.registry.remove(host.id)
                Toast.makeText(this, getString(R.string.toast_host_removed, host.displayName), Toast.LENGTH_SHORT).show()
                render()
            }
            .show()
    }


    /** 主机长按菜单：重命名 / 移除。 */
    private fun showHostMenu(host: HostEntry) {
        val values = arrayOf(
            getString(R.string.host_menu_rename),
            getString(R.string.host_menu_remove),
        )
        AlertDialog.Builder(this)
            .setTitle(host.displayName)
            .setItems(values) { _, which ->
                when (which) {
                    0 -> promptRename(host)
                    else -> requireUnlock { confirmRemove(host) }
                }
            }
            .show()
    }

    /** 重命名主机（空名视为放弃）。 */
    private fun promptRename(host: HostEntry) {
        val input = EditText(this)
        input.setText(host.label)
        AlertDialog.Builder(this)
            .setTitle(R.string.host_menu_rename)
            .setView(input)
            .setNegativeButton(R.string.dialog_cancel, null)
            .setPositiveButton(R.string.dialog_save) { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty() && name != host.label) {
                    app.registry.upsert(host.copy(label = name))
                    Toast.makeText(this, R.string.toast_host_renamed, Toast.LENGTH_SHORT).show()
                    render()
                }
            }
            .show()
    }
    /** 敏感动作：先过生物锁。 */
    private fun requireUnlock(action: () -> Unit) {
        if (!app.lock.enabled) {
            action()
            return
        }
        pendingAction = action
        app.lock.lock()
        promptUnlock(LockActivity.REASON_SENSITIVE)
    }

    /** 拉起锁屏。 */
    private fun promptUnlock(reason: String) {
        unlockLauncher.launch(
            Intent(this, LockActivity::class.java).putExtra(LockActivity.EXTRA_REASON, reason),
        )
    }

    /** 探测当前主机的往返延迟。 */
    private fun measureLatency() {
        val host = app.registry.current() ?: return
        scope.launch {
            val latency = app.probe.latency(host.laneOrigin)
            if (latency == null) return@launch
            app.registry.markLatency(host.id, latency)
            render()
        }
    }


    // ── 发现 ────────────────────────────────────────────────────────────────

    /** 发现结果的接收方（回调已在主线程）。 */
    private val discoveryListener = object : LaneDiscovery.Listener {
        override fun onFound(host: DiscoveredHost) {
            discovered[host.serviceName] = host
            renderDiscovery()
        }

        override fun onLost(serviceName: String) {
            discovered.remove(serviceName)
            renderDiscovery()
        }

        override fun onError(message: String) {
            Toast.makeText(
                this@ManagementActivity,
                getString(R.string.discovery_error, message),
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    /** 扫描局域网（mDNS 发现；发现不带授权）。 */
    private fun scanForHosts() {
        val scanner = discovery ?: return
        discovered.clear()
        renderDiscovery()
        findViewById<TextView>(R.id.btn_discovery_scan).setText(R.string.discovery_scanning)
        scanner.start()
        scope.launch {
            delay(SCAN_DURATION_MS)
            scanner.stop()
            findViewById<TextView>(R.id.btn_discovery_scan).setText(R.string.discovery_scan)
        }
    }

    /** 重建发现列表。 */
    private fun renderDiscovery() {
        val list = findViewById<LinearLayout>(R.id.discovery_list)
        list.removeAllViews()
        if (discovered.isEmpty()) {
            list.addView(discoveryEmptyRow())
            return
        }
        discovered.values.forEachIndexed { index, host ->
            if (index > 0) list.addView(divider())
            list.addView(discoveryRow(host))
        }
    }

    /** 列表为空时的一行提示。 */
    private fun discoveryEmptyRow(): View = TextView(this).apply {
        text = getString(R.string.discovery_empty)
        setTextColor(getColor(R.color.dsh_label_caption))
        textSize = 12f
        val padding = resources.getDimensionPixelSize(R.dimen.dsh_row_padding)
        setPadding(padding, padding, padding, padding)
    }

    /** 发现列表的一行：名称 + 候选地址。 */
    private fun discoveryRow(host: DiscoveredHost): View {
        val row = LayoutInflater.from(this).inflate(R.layout.item_discovery_row, null, false)
        row.findViewById<TextView>(R.id.name_discovery).text = host.label
        row.findViewById<TextView>(R.id.origin_discovery).text = host.displayAddress
        HostVisuals.bindDot(row.findViewById(R.id.dot_discovery), HostStatus.UNKNOWN)
        row.setOnClickListener { confirmDiscovered(host) }
        return row
    }

    /** 选中发现项：引导去补授权（扫码 / 粘贴桌面签发的配对链接）。 */
    private fun confirmDiscovered(host: DiscoveredHost) {
        AlertDialog.Builder(this)
            .setTitle(R.string.discovery_pick_title)
            .setMessage(getString(R.string.discovery_pick_message, host.label, host.displayAddress))
            .setNegativeButton(R.string.dialog_cancel, null)
            .setPositiveButton(R.string.discovery_pick_action) { _, _ ->
                startActivity(
                    Intent(this, PairingActivity::class.java)
                        .putExtra(PairingActivity.EXTRA_DISCOVERED_ORIGIN, host.origin),
                )
            }
            .show()
    }

    private val app: MobileApp get() = application as MobileApp

    private companion object {
        /** 扫描时长（毫秒）：组播订阅不长期挂着。 */
        const val SCAN_DURATION_MS = 6_000L
    }
}
