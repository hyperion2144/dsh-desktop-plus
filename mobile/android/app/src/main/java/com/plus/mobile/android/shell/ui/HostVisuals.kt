package com.plus.mobile.android.shell.ui

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.plus.mobile.android.R
import com.plus.mobile.android.shell.host.HostForm
import com.plus.mobile.android.shell.host.HostStatus

/**
 * 管理页的视觉词汇：状态点与形态徽标。
 *
 * 色值全部来自 `values/colors.xml`（dsh token，出处见该文件注释），这里只做「语义 → token」的映射。
 */
object HostVisuals {

    /** 状态点的颜色。 */
    fun statusColor(context: Context, status: HostStatus): Int = when (status) {
        HostStatus.CONNECTED -> ContextCompat.getColor(context, R.color.dsh_state_success)
        HostStatus.NEEDS_REPAIR -> ContextCompat.getColor(context, R.color.dsh_state_error)
        HostStatus.OFFLINE -> ContextCompat.getColor(context, R.color.dsh_label_tertiary)
        HostStatus.UNKNOWN -> ContextCompat.getColor(context, R.color.dsh_label_caption)
    }

    /** 形态徽标的颜色（原型：lan 绿 / mdns 链接蓝 / tunnel 紫）。 */
    fun formColor(context: Context, form: HostForm): Int = when (form) {
        HostForm.LAN -> ContextCompat.getColor(context, R.color.dsh_state_success)
        HostForm.MDNS -> ContextCompat.getColor(context, R.color.dsh_deepseek_400)
        HostForm.TUNNEL -> ContextCompat.getColor(context, R.color.dsh_violet)
        HostForm.DIRECT -> ContextCompat.getColor(context, R.color.dsh_deepseek_400)
    }

    /** 绑定状态点。 */
    fun bindDot(dot: View, status: HostStatus) {
        dot.backgroundTintList = ColorStateList.valueOf(statusColor(dot.context, status))
    }

    /** 绑定形态徽标：胶囊底 + 同色描边 + 同色文字。 */
    fun bindBadge(badge: TextView, form: HostForm) {
        val color = formColor(badge.context, form)
        badge.text = form.code
        badge.setTextColor(color)
        badge.visibility = View.VISIBLE
        badge.background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = badge.resources.getDimension(R.dimen.dsh_radius_pill)
            setColor(Color.TRANSPARENT)
            setStroke(1, color)
        }
        val horizontal = badge.resources.getDimensionPixelSize(R.dimen.dsh_badge_padding)
        badge.setPadding(horizontal, badge.paddingTop, horizontal, badge.paddingBottom)
    }
}
