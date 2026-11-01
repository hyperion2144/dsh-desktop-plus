package com.plus.mobile.android.shell.connect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.content.ContextCompat
import com.plus.mobile.android.R
import com.plus.mobile.android.shell.ShellLog

/**
 * 连接保活前台服务（connectedDevice 类型）。
 *
 * 页面工作台活跃期间把进程提到前台服务级：后台期间 WebView 的 socket 不被冻结/回收，
 * 配合放宽后的网关心跳（判死窗 2×10s≈20s，见 mobile/STABILITY-PLAN.md B1/B5），
 * 常规后台停留与网络抖动不再触发重连。
 *
 * 无通知权限时（Android 13+ 未授予 POST_NOTIFICATIONS）通知不展示、服务照常运行，
 * 因此不向用户索取通知权限。
 */
class KeepaliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        startAsForeground()
        return START_STICKY
    }

    private fun startAsForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                getString(R.string.keepalive_channel),
                NotificationManager.IMPORTANCE_MIN,
            ),
        )
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.keepalive_text))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .build()
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        ShellLog.info("连接保活前台服务已启动")
    }

    companion object {
        private const val CHANNEL_ID = "dsh_keepalive"
        private const val NOTIFICATION_ID = 41
        private const val ACTION_STOP = "com.plus.mobile.android.shell.KEEPALIVE_STOP"

        /** 页面工作台活跃期间启动（前台调用，不受后台启动限制）。 */
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, KeepaliveService::class.java))
        }

        /** 主机移除 / 界面销毁时停止。 */
        fun stop(context: Context) {
            context.startService(
                Intent(context, KeepaliveService::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
