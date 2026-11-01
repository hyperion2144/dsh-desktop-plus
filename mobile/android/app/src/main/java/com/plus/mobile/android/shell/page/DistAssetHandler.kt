package com.plus.mobile.android.shell.page

import android.content.res.AssetManager
import androidx.webkit.WebViewAssetLoader
import android.webkit.WebResourceResponse
import java.io.IOException

/**
 * 本地资产处理器：把页面 origin 下的请求映射到壳内自带的 upstream dist。
 *
 * 命中规则：页面路径去掉前导 `/` 后就是 dist 里的相对路径（dist 根 = assets/dist）。
 * 未命中返回 null → 由调用方回退到「转发到 lane」。
 */
class DistAssetHandler(
    private val assets: AssetManager,
    private val rootDir: String,
    /**
     * 文档变换：仅在「无法使用 document-start 注入」的旧 WebView 上启用——
     * 把引导脚本内联进 index.html，效果等价（见 DocumentStartInstaller）。
     */
    private val documentTransform: ((String) -> String)? = null,
) : WebViewAssetLoader.PathHandler {

    override fun handle(path: String): WebResourceResponse? {
        val relative = path.trimStart('/')
        if (relative.isEmpty() || relative.contains("..")) return null
        val mimeType = mimeTypeOf(relative)
        val stream = try {
            assets.open("$rootDir/$relative")
        } catch (_: IOException) {
            return null
        }
        return try {
            if (relative == DOCUMENT_NAME && documentTransform != null) {
                val html = stream.bufferedReader(Charsets.UTF_8).readText()
                stream.close()
                WebResourceResponse(mimeType, "utf-8", documentTransform(html).byteInputStream(Charsets.UTF_8))
            } else {
                // 流不能在这里关：WebView 之后才读它（提前关会让 Chromium 渲染进程崩）。
                WebResourceResponse(mimeType, encodingOf(mimeType), SafeInputStream(stream))
            }
        } catch (error: Exception) {
            runCatching { stream.close() }
            null
        }
    }

    private fun encodingOf(mimeType: String): String? = when {
        mimeType.startsWith("text/") -> "utf-8"
        mimeType == "application/javascript" || mimeType == "application/json" -> "utf-8"
        else -> null
    }

    private fun mimeTypeOf(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") || lower.endsWith(".webmanifest") -> "application/json"
            lower.endsWith(".map") -> "application/json"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".ico") -> "image/x-icon"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".ttf") -> "font/ttf"
            else -> "application/octet-stream"
        }
    }

    private companion object {
        const val DOCUMENT_NAME = "index.html"
    }
}
