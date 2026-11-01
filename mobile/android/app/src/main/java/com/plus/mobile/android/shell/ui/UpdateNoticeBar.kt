package com.plus.mobile.android.shell.ui

import android.content.Context
import android.util.AttributeSet
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.plus.mobile.android.R

/**
 * 更新提醒条（Snackbar 形态）。
 *
 * ## 为什么自绘而不用 Material 的 Snackbar
 *
 * 壳的依赖面只有 appcompat + webkit：Material 的 Snackbar 在 Material3 主题下取
 * `colorSurfaceInverse` / `colorPrimaryInverse` 等属性，而壳的主题是
 * `Theme.AppCompat.DayNight.NoActionBar`——那些属性不存在，Snackbar 会崩或退化成无色。
 * 自绘一条反而能沿用 dsh 的视觉 token（交互底 + 边框 + 圆角），且不引依赖。
 *
 * ## 状态
 *
 * - 有更新 → [showOffer]（版本号 + 大小 +「下载安装」）
 * - 下载中 → [showProgress]（进度条 + 已下载字节）
 * - 失败 → [showError]（原因 +「重试」）
 */
class UpdateNoticeBar @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    private val titleView: TextView
    private val detailView: TextView
    private val actionView: TextView
    private val progressView: ProgressBar
    private val ignoreView: TextView

    /** 「下载安装 / 重试」的点击回调。 */
    var onDownload: (() -> Unit)? = null

    /** 「不再提示此版本」的点击回调（拉黑该版本）。 */
    var onIgnore: (() -> Unit)? = null

    init {
        LayoutInflater.from(context).inflate(R.layout.view_update_notice, this, true)
        titleView = findViewById(R.id.notice_title)
        detailView = findViewById(R.id.notice_detail)
        actionView = findViewById(R.id.notice_action)
        progressView = findViewById(R.id.notice_progress)
        ignoreView = findViewById(R.id.notice_ignore)
        ignoreView.setText(R.string.update_notice_ignore)
        actionView.setOnClickListener { onDownload?.invoke() }
        ignoreView.setOnClickListener { onIgnore?.invoke() }
        visibility = View.GONE
    }

    /**
     * 展示一个可安装的更新。
     *
     * @param version 新版本号
     * @param sizeBytes 产物体积（字节）
     */
    fun showOffer(version: String, sizeBytes: Long) {
        titleView.text = context.getString(R.string.update_notice_title, version)
        detailView.text = context.getString(R.string.update_notice_size, formatBytes(sizeBytes))
        actionView.setText(R.string.update_notice_action_download)
        actionView.isEnabled = true
        actionView.alpha = 1f
        progressView.visibility = View.GONE
        ignoreView.visibility = View.VISIBLE
        visibility = View.VISIBLE
    }

    /**
     * 展示「已下载、待安装」状态（授权回来后再点一次即可直接拉起安装器）。
     */
    fun showInstallReady(version: String, sizeBytes: Long) {
        titleView.text = context.getString(R.string.update_notice_title, version)
        detailView.text = context.getString(R.string.update_notice_size, formatBytes(sizeBytes))
        actionView.setText(R.string.update_notice_action_install)
        actionView.isEnabled = true
        actionView.alpha = 1f
        progressView.visibility = View.GONE
        ignoreView.visibility = View.VISIBLE
        visibility = View.VISIBLE
    }

    /**
     * 展示下载进度。
     *
     * @param downloaded 已下载字节
     * @param total 总量（0 = 未知）
     */
    fun showProgress(downloaded: Long, total: Long) {
        val percent = if (total > 0) ((downloaded * 100) / total).toInt().coerceIn(0, 100) else 0
        detailView.text = context.getString(
            R.string.update_notice_progress,
            formatBytes(downloaded),
            formatBytes(total),
            percent,
        )
        actionView.setText(R.string.update_notice_action_downloading)
        actionView.isEnabled = false
        actionView.alpha = 0.6f
        progressView.visibility = View.VISIBLE
        progressView.progress = percent
        visibility = View.VISIBLE
    }

    /** 展示失败原因（可重试）。 */
    fun showError(reason: String) {
        detailView.text = context.getString(R.string.update_notice_failed, reason)
        actionView.setText(R.string.update_notice_action_retry)
        actionView.isEnabled = true
        actionView.alpha = 1f
        progressView.visibility = View.GONE
        visibility = View.VISIBLE
    }

    /** 隐藏提醒条。 */
    fun hide() {
        visibility = View.GONE
    }

    /** 字节数 → 人类可读（与壳内其它文案一致的单位）。 */
    private fun formatBytes(bytes: Long): String = when {
        bytes <= 0 -> "0 B"
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> String.format("%.1f KB", bytes / 1024.0)
        bytes < 1024L * 1024 * 1024 -> String.format("%.1f MB", bytes / (1024.0 * 1024))
        else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
    }
}
