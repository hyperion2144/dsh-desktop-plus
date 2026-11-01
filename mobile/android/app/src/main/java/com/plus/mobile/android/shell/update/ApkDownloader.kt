package com.plus.mobile.android.shell.update

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Base64

/**
 * apk 下载器：流式落盘 + 进度回调 + sha512 校验。
 *
 * ## 为什么不用 DownloadManager
 *
 * DownloadManager 的进度查询要靠轮询 `DownloadManager.Query`，而且下载完成后拿到的
 * 是 `content://` URI，跨进程读给系统安装器要再套一层 FileProvider 授权；
 * 壳自己流式下载可以直接拿到文件路径与精确进度，提醒条上的进度条才准。
 *
 * ## 落盘位置
 *
 * 落在 App 私有目录 `filesDir/updates/`（不是外部存储）：私有目录需要显式授权才能被
 * 系统安装器读，而 [ApkInstaller] 正是通过 FileProvider 做这次授权。
 */
class ApkDownloader(private val context: Context) {

    /**
     * 下载 apk。
     *
     * @param url 产物完整 URL
     * @param expectedSize 元数据里的字节数（用于进度总量；服务端不给 Content-Length 时兜底）
     * @param expectedSha512 元数据里的 sha512（base64）；空串表示不校验
     * @param onProgress 进度回调（挂起式；在下载器的 IO 上下文里调用）
     * @return 下载完成的 apk 文件
     * @throws IOException 网络失败或校验不通过
     */
    suspend fun download(
        url: String,
        expectedSize: Long,
        expectedSha512: String,
        onProgress: suspend (downloaded: Long, total: Long) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "dsh-mobile-android")
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                throw IOException("apk 下载失败：HTTP $code（$url）")
            }
            val total = if (connection.contentLengthLong > 0) connection.contentLengthLong else expectedSize
            val target = targetFile(url)
            val digest = MessageDigest.getInstance("SHA-512")
            var downloaded = 0L

            connection.inputStream.use { input ->
                target.outputStream().use { output ->
                    val chunk = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(chunk)
                        if (read <= 0) break
                        output.write(chunk, 0, read)
                        digest.update(chunk, 0, read)
                        downloaded += read
                        onProgress(downloaded, total)
                    }
                }
            }

            if (expectedSha512.isNotBlank()) {
                val actual = Base64.getEncoder().encodeToString(digest.digest())
                if (actual != expectedSha512) {
                    target.delete()
                    throw IOException("apk 校验失败：sha512 与元数据不一致")
                }
            }
            target
        } finally {
            connection.disconnect()
        }
    }

    /** 目标文件：`filesDir/updates/<产物文件名>`。 */
    private fun targetFile(url: String): File {
        val name = url.substringAfterLast('/').substringBefore('?').ifBlank { "update.apk" }
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val dir = File(context.filesDir, DOWNLOAD_DIR)
        if (!dir.exists()) dir.mkdirs()
        return File(dir, safe)
    }

    private companion object {

        /** 私有目录下的下载子目录（FileProvider 的 `files-path` 指向它）。 */
        const val DOWNLOAD_DIR = "updates"
    }
}
