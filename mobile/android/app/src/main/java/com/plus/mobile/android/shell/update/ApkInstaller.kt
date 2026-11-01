package com.plus.mobile.android.shell.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * 系统安装器拉起器。
 *
 * ## 为什么要 FileProvider
 *
 * Android 7.0 起，跨进程传文件 URI 必须走 content:// 且临时授权；
 * `file://` 会被系统直接拒（`FileUriExposedException`）。
 * 壳把 apk 放在自己的私有目录里，靠 FileProvider 把它暴露成 content:// 交给系统安装器。
 *
 * ## 未知来源授权
 *
 * 拉起安装器前要确认用户已给本 App「安装未知来源应用」的权限
 * （`PackageManager.canRequestPackageInstalls()`）；没有就去系统设置页引导授权。
 */
class ApkInstaller(private val context: Context) {

    /** 是否已获准安装来自未知来源的应用。 */
    fun canRequestInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    /**
     * 拉起系统安装器的 Intent。
     *
     * 调用方（Activity）负责 `startActivity`。
     */
    @Suppress("DEPRECATION")
    fun installIntent(apk: File): Intent {
        val uri = FileProvider.getUriForFile(context, authority, apk)
        // ACTION_INSTALL_PACKAGE 已废弃，但系统安装器仍认它（票 #62 明确要求这条路径）。
        return Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    /** 未获准时的授权引导 Intent（系统「安装未知来源应用」设置页）。 */
    fun permissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
        }

    /** FileProvider 的 authority（与清单里的声明一致）。 */
    val authority: String get() = "${context.packageName}.fileprovider"

    private companion object {

        /** apk 的 MIME 类型。 */
        const val APK_MIME = "application/vnd.android.package-archive"
    }
}
