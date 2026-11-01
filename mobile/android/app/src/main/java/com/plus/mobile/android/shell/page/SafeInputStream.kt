package com.plus.mobile.android.shell.page

import java.io.FilterInputStream
import java.io.InputStream

/**
 * 把流的 `available()` 变成「永不抛异常」。
 *
 * Chromium 的 `InputStreamUtil.available` 只捕获 IOException：被拦截的响应若返回一个
 * `available()` 会抛别的异常的流，整个渲染进程就会崩（jni_android.cc:
 * "Crashing due to uncaught Java exception"）。`AssetManager.AssetInputStream` 就是一个例子
 * ——流被提前关掉时它抛 `IllegalStateException: AssetInputStream is closed`。
 */
class SafeInputStream(delegate: InputStream) : FilterInputStream(delegate) {

    override fun available(): Int = try {
        super.available()
    } catch (_: Throwable) {
        0
    }
}
