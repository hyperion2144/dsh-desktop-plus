package com.plus.mobile.android.shell.boot

/**
 * 当前生效的引导载荷。
 *
 * 页面在 document-start 通过壳自有端点取它；换主机时由 [com.plus.mobile.android.shell.page.PageRequestRouter]
 * 读出并返回。换主机的瞬间旧载荷会被新的替换——页面随后 reload，重新取到新载荷。
 */
class BootPayloadStore {

    @Volatile
    private var current: BootPayload? = null

    fun set(payload: BootPayload?) {
        current = payload
    }

    fun get(): BootPayload? = current
}
