package com.plus.mobile.android.shell.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import com.plus.mobile.android.MobileApp
import com.plus.mobile.android.R
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.pair.PairFailure
import com.plus.mobile.android.shell.pair.PairLink
import com.plus.mobile.android.shell.pair.PairingService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * 配对屏（四态：入口 / 验证中 / 成功 / 失败）。
 *
 * 两个入口：**扫描二维码** 与 **粘贴配对链接**。两者拿到的是同一条链接——
 * 桌面端「远程访问」面板签发的一次性链接（10 分钟有效、一次性）。
 * **没有任何令牌手输入口**（spec #55「配对」）。
 *
 * 失败文案区分两类：**链接过期** 与 **设备被移除**（两者的补救动作不同）。
 */
class PairingActivity : AppCompatActivity() {

    private val scope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

    /** 扫码结果：内容就是一条配对链接。 */
    private val scanLauncher = registerForActivityResult(ScanContract()) { result ->
        val content = result.contents
        if (content.isNullOrBlank()) {
            Toast.makeText(this, R.string.pair_fail_malformed_title, Toast.LENGTH_SHORT).show()
        } else {
            onLink(content)
        }
    }

    /** 相机权限。 */
    private val cameraPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            launchScanner()
        } else {
            Toast.makeText(this, R.string.pair_no_camera, Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pairing)

        findViewById<ImageView>(R.id.btn_back).setOnClickListener { finish() }
        findViewById<View>(R.id.card_scan).setOnClickListener { startScan() }
        findViewById<TextView>(R.id.btn_use_link).setOnClickListener {
            onLink(findViewById<EditText>(R.id.input_link).text.toString())
        }
        findViewById<TextView>(R.id.btn_retry).setOnClickListener { showEntry() }
        findViewById<TextView>(R.id.btn_enter).setOnClickListener { finish() }

        showEntry()
        // 从发现列表进来时，提示这台桌面的地址（发现不带授权，链接仍要桌面签发）。
        val discovered = intent.getStringExtra(EXTRA_DISCOVERED_ORIGIN)?.trim().orEmpty()
        if (discovered.isNotEmpty()) {
            findViewById<TextView>(R.id.hint_discovered).apply {
                text = getString(R.string.pair_discovered_hint, discovered)
                visibility = View.VISIBLE
            }
        }
    }

    // ── 入口 ────────────────────────────────────────────────────────────────

    /** 扫码入口：先看有没有相机，再要权限。 */
    private fun startScan() {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) {
            Toast.makeText(this, R.string.pair_no_camera, Toast.LENGTH_LONG).show()
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            cameraPermission.launch(Manifest.permission.CAMERA)
            return
        }
        launchScanner()
    }

    private fun launchScanner() {
        val options = ScanOptions()
        options.setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        options.setPrompt(getString(R.string.pair_scan_desc))
        options.setBeepEnabled(false)
        options.setOrientationLocked(true)
        scanLauncher.launch(options)
    }

    // ── 四态 ────────────────────────────────────────────────────────────────

    /** 拿到一条配对链接（扫码或粘贴）。 */
    private fun onLink(raw: String) {
        val link = PairLink.parse(raw)
        if (link == null) {
            showFailure(PairFailure.MALFORMED)
            return
        }
        showVerifying()
        scope.launch {
            when (val outcome = app.pairing.pair(link)) {
                is PairingService.PairOutcome.Paired -> showSuccess(outcome.host)
                is PairingService.PairOutcome.Failed -> showFailure(outcome.failure)
            }
        }
    }

    /** 状态一：入口。 */
    private fun showEntry() {
        showPane(R.id.pane_enter)
        step(1)
    }

    /** 状态二：验证中。 */
    private fun showVerifying() {
        showPane(R.id.pane_verify)
        step(2)
    }

    /** 状态三：成功。 */
    private fun showSuccess(host: HostEntry) {
        showPane(R.id.pane_ok)
        step(3)
        findViewById<TextView>(R.id.ok_title).text = getString(R.string.pair_ok_title) + " " + host.displayName
        findViewById<TextView>(R.id.ok_detail).text = getString(R.string.pair_ok_detail_host, host.displayName)
        ShellLog.info("配对成功：${host.displayName}")
    }

    /** 状态四：失败（文案区分链接过期与设备被移除）。 */
    private fun showFailure(failure: PairFailure) {
        showPane(R.id.pane_fail)
        step(3)
        val titleRes: Int
        val detailRes: Int
        when (failure) {
            PairFailure.INVALID_TOKEN -> {
                titleRes = R.string.pair_fail_expired_title
                detailRes = R.string.pair_fail_expired_detail
            }
            PairFailure.DEVICE_REMOVED -> {
                titleRes = R.string.pair_fail_removed_title
                detailRes = R.string.pair_fail_removed_detail
            }
            PairFailure.UNREACHABLE -> {
                titleRes = R.string.pair_fail_unreachable_title
                detailRes = R.string.pair_fail_unreachable_detail
            }
            else -> {
                titleRes = R.string.pair_fail_malformed_title
                detailRes = R.string.pair_fail_malformed_detail
            }
        }
        findViewById<TextView>(R.id.fail_title).setText(titleRes)
        findViewById<TextView>(R.id.fail_detail).setText(detailRes)
    }

    /** 显示某一态（其余隐藏）。 */
    private fun showPane(paneId: Int) {
        listOf(R.id.pane_enter, R.id.pane_verify, R.id.pane_ok, R.id.pane_fail).forEach { id ->
            findViewById<View>(id).visibility = if (id == paneId) View.VISIBLE else View.GONE
        }
    }

    /** 步骤条高亮。 */
    private fun step(active: Int) {
        val steps = listOf(R.id.step_1, R.id.step_2, R.id.step_3)
        steps.forEachIndexed { index, id ->
            val view = findViewById<TextView>(id)
            view.setTextColor(
                ContextCompat.getColor(
                    this,
                    if (index + 1 <= active) R.color.dsh_deepseek_400 else R.color.dsh_label_tertiary,
                ),
            )
        }
    }

    private val app: MobileApp get() = application as MobileApp

    companion object {
        /** 从发现列表带过来的候选地址（只是地址，不含任何授权）。 */
        const val EXTRA_DISCOVERED_ORIGIN = "discovered_origin"
    }
}
