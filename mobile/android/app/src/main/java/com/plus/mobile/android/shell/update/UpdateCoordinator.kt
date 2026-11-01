package com.plus.mobile.android.shell.update

import android.content.Intent
import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.store.ShellPreferences
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 一次可安装的更新（提醒条上显示的就是它）。
 *
 * @param version plus 版本（显示用）
 * @param versionCode 由 plus 版本推导出的安装版本号（与本机已装版本号比大小用）
 * @param artifactUrl 产物的完整 URL
 * @param size 产物流字节数（进度条总量）
 * @param sha512 产物的 sha512（base64，下载后校验）
 */
data class UpdateOffer(
    val version: String,
    val versionCode: Int,
    val artifactUrl: String,
    val size: Long,
    val sha512: String,
)

/** 检查结果。 */
sealed class UpdateCheckResult {

    /** 总开关关着：什么都不做。 */
    object Disabled : UpdateCheckResult()

    /** 有更新但不该提醒（已拉黑 / 不是更新的版本 / 已提醒过）。 */
    data class Skipped(val decision: NoticeDecision) : UpdateCheckResult()

    /** 有更新，该提醒。 */
    data class Available(val offer: UpdateOffer) : UpdateCheckResult()

    /** 检查失败（没网 / 元数据不成形）：**静默降级**，只记日志。 */
    data class Failed(val reason: String) : UpdateCheckResult()
}

/** 下载与安装的结果。 */
sealed class InstallOutcome {

    /** 下载完成，可以拉起系统安装器（Intent 由 Activity 启动）。 */
    data class ReadyToInstall(val intent: Intent) : InstallOutcome()

    /** 没给「安装未知来源应用」的权限：需先去系统设置页授权。 */
    object NeedInstallPermission : InstallOutcome()

    /** 下载或校验失败。 */
    data class Failed(val reason: String) : InstallOutcome()
}

/**
 * 更新提醒的编排者：检查 → 提醒 → 下载 → 拉起安装器。
 *
 * ## 静默降级
 *
 * 没网、元数据拉取失败、元数据不成形、下载失败——全部只记日志并返回失败态，
 * **不弹窗、不抛异常、不阻塞启动**。检查在后台线程跑，壳的启动路径不受影响。
 *
 * ## 提醒语义
 *
 * 开关 / 拉黑版本 / 已提醒最高版本三件事都在 [UpdateNoticePolicy] 里判定，
 * 语义复用桌面 update-notice 契约。
 */
class UpdateCoordinator(
    private val preferences: ShellPreferences,
    private val noticeStore: UpdateNoticeStore,
    private val feedClient: UpdateFeedClient,
    private val downloader: ApkDownloader,
    private val installer: ApkInstaller,
    /** 本机已装版本（plus 版本，来自 BuildConfig.VERSION_NAME）。 */
    private val currentVersion: String,
    /** 两次检查之间的最小间隔（默认 6 小时，与偏好里的说明一致）。 */
    private val checkIntervalMs: Long = DEFAULT_CHECK_INTERVAL_MS,
) {

    /** 已下载的 apk（授权回来后重试不必重下）。 */
    private var downloadedApk: java.io.File? = null

    /** [downloadedApk] 对应的版本。 */
    private var downloadedVersion: String? = null

    /** 当前提醒状态。 */
    fun noticeState(): UpdateNoticeState = noticeStore.read()

    /**
     * 是否到了该检查的时候（距上次检查不足间隔则跳过）。
     *
     * 启动与回前台都会调检查；不设间隔的话每次切前台都打一次网络。
     */
    fun shouldCheckNow(now: Long = System.currentTimeMillis()): Boolean {
        if (!preferences.updateReminderEnabled) return false
        val last = preferences.updateLastCheckAt
        return last <= 0L || now - last >= checkIntervalMs
    }

    /**
     * 检查更新。
     *
     * 永远不抛异常：失败以 [UpdateCheckResult.Failed] 返回，由调用方决定要不要提示。
     */
    suspend fun check(): UpdateCheckResult {
        val state = noticeStore.read()
        if (!state.enabled) return UpdateCheckResult.Disabled

        val metadata = try {
            withContext(Dispatchers.IO) { feedClient.fetch() }
        } catch (error: Exception) {
            ShellLog.warn("更新检查失败（静默降级）：${error.message}")
            return UpdateCheckResult.Failed(error.message ?: "更新源不可达")
        }

        // 检查过了就记下时刻：无论有没有更新，6 小时内不再重复拉（离线失败不记，下次照常重试）。
        preferences.updateLastCheckAt = System.currentTimeMillis()
        val candidate = metadata.version
        val decision = try {
            UpdateNoticePolicy.decide(state, UpdateNoticeKind.SHELL, candidate, currentVersion)
        } catch (error: Exception) {
            ShellLog.warn("版本比对失败（静默降级）：${error.message}")
            return UpdateCheckResult.Failed(error.message ?: "版本无法比对")
        }
        if (decision != NoticeDecision.NOTIFY) {
            return UpdateCheckResult.Skipped(decision)
        }

        val file = metadata.file
        if (file == null) {
            return UpdateCheckResult.Failed("元数据里没有产物")
        }

        // 覆盖安装要求安装版本号更高：语义比较说「新」，推导出来的版本号也要更大。
        // 两者不一致说明公式或元数据有问题——宁可不提醒，也不给一个装不上的更新。
        val candidateCode = MobileVersion.versionCode(candidate)
        val installedCode = runCatching { MobileVersion.versionCode(currentVersion) }.getOrNull()
        if (installedCode != null && candidateCode <= installedCode) {
            ShellLog.warn(
                "候选版本的安装版本号不高于本机（$candidateCode ≤ $installedCode），不提醒",
            )
            return UpdateCheckResult.Skipped(NoticeDecision.NOT_NEWER)
        }

        return UpdateCheckResult.Available(
            UpdateOffer(
                version = candidate,
                versionCode = candidateCode,
                artifactUrl = feedClient.artifactUrl(file.url),
                size = file.size,
                sha512 = file.sha512,
            ),
        )
    }

    /**
     * 下载并准备安装。
     *
     * @param onProgress 进度回调（主线程）
     */
    suspend fun downloadAndInstall(
        offer: UpdateOffer,
        onProgress: (downloaded: Long, total: Long) -> Unit,
    ): InstallOutcome {
        return try {
            val apk = cachedApk(offer) ?: downloader.download(offer.artifactUrl, offer.size, offer.sha512) { downloaded, total ->
                withContext(Dispatchers.Main) { onProgress(downloaded, total) }
            }.also {
                downloadedApk = it
                downloadedVersion = offer.version
            }
            if (!installer.canRequestInstall()) {
                InstallOutcome.NeedInstallPermission
            } else {
                InstallOutcome.ReadyToInstall(installer.installIntent(apk))
            }
        } catch (error: Exception) {
            ShellLog.warn("apk 下载失败：${error.message}")
            InstallOutcome.Failed(error.message ?: "下载失败")
        }
    }

    /** 已经下过同一个版本就直接用（授权回来后重试不必再下一遍）。 */
    private fun cachedApk(offer: UpdateOffer): java.io.File? {
        val file = downloadedApk ?: return null
        if (downloadedVersion != offer.version) return null
        if (!file.exists()) return null
        return file
    }

    /** 未获准安装时的授权引导 Intent（系统「安装未知来源应用」设置页）。 */
    fun installPermissionIntent(): Intent = installer.permissionIntent()

    /** 记下「已提醒过这个版本」（只保留最高版本）。 */
    fun markNotified(version: String) {
        val state = UpdateNoticePolicy.markNotified(
            noticeStore.read(),
            UpdateNoticeKind.SHELL,
            version,
        )
        noticeStore.write(state)
    }

    /** 拉黑某个版本（「不再提示此版本」）。 */
    fun ignoreVersion(version: String) {
        val state = UpdateNoticePolicy.ignore(
            noticeStore.read(),
            UpdateNoticeKind.SHELL,
            version,
        )
        noticeStore.write(state)
    }

    companion object {

        /** 检查间隔：6 小时（与偏好项「每 6 小时检查 GitHub Releases」一致）。 */
        const val DEFAULT_CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000
    }
}
