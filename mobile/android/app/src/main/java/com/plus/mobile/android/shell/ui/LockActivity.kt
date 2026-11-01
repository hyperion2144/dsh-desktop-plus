package com.plus.mobile.android.shell.ui

import android.os.Bundle
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.plus.mobile.android.MobileApp
import com.plus.mobile.android.R
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.lock.BiometricGate

/**
 * 生物锁屏（原型定稿第④屏）。
 *
 * 三个触发场景共用这一屏：冷启动 / 后台超时回前台 / 敏感操作（配对、删主机）。
 *
 * 不可绕过：返回键被吃掉，唯一出口是验证通过（设备既没生物特征也没 PIN 时放行并记录，
 * 否则用户会被自己的 App 锁死）。
 */
class LockActivity : AppCompatActivity() {

    private lateinit var gate: BiometricGate


    /** 锁屏原因（冷启动 / 后台超时 / 敏感操作）：文案与系统验证框的副标题共用。 */
    private var reasonRes: Int = R.string.lock_reason_cold
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reasonRes = reasonText()
        setContentView(R.layout.activity_lock)

        findViewById<TextView>(R.id.lock_reason).setText(reasonRes)
        findViewById<TextView>(R.id.btn_unlock).setOnClickListener { authenticate() }

        // 锁屏不可绕过：吃掉返回键。
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })

        gate = BiometricGate(this)
        if (!gate.available()) {
            ShellLog.warn("设备没有可用的验证方式（无生物特征 / 无 PIN），本次跳过锁屏")
            succeed()
            return
        }
        authenticate()
    }

    /** 发起验证。 */
    private fun authenticate() {
        gate.authenticate(
            title = getString(R.string.lock_title),
            subtitle = getString(reasonRes),
        ) { ok ->
            if (ok) succeed() else ShellLog.info("生物锁验证未通过")
        }
    }

    /** 验证通过：解锁并回传结果。 */
    private fun succeed() {
        (application as? MobileApp)?.lock?.unlock()
        setResult(RESULT_OK)
        finish()
    }

    /** 锁屏原因文案（按触发场景）。 */
    private fun reasonText(): Int = when (intent.getStringExtra(EXTRA_REASON)) {
        REASON_BACKGROUND -> R.string.lock_reason_background
        REASON_SENSITIVE -> R.string.lock_reason_sensitive
        else -> R.string.lock_reason_cold
    }

    companion object {
        /** 触发原因：冷启动。 */
        const val REASON_COLD = "cold"

        /** 触发原因：后台超时回前台。 */
        const val REASON_BACKGROUND = "background"

        /** 触发原因：敏感操作。 */
        const val REASON_SENSITIVE = "sensitive"

        /** Intent 里的触发原因键。 */
        const val EXTRA_REASON = "reason"
    }
}
