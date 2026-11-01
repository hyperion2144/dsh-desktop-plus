package com.plus.mobile.android.shell.bridge

import android.webkit.JavascriptInterface

/**
 * 壳桥的宿主契约。
 *
 * 页面内的主机切换器（下一票的移动端补丁注入）只认这三个方法，不碰壳的其它实现。
 */
interface MobileBridgeHost {

    /** 全部主机（JSON 数组字符串）。 */
    fun hostsJson(): String

    /** 当前主机（JSON 对象字符串）。 */
    fun currentJson(): String

    /** 切换到指定主机：壳改代理目标 + 重载页面。 */
    fun switchHost(id: String): Boolean
}

/**
 * `window.dshMobile` 壳桥。
 *
 * 契约（spec #55「UI」与票 #60）：
 *  - `dshMobile.hosts()` → 主机列表（不含凭证）
 *  - `dshMobile.current()` → 当前主机
 *  - `dshMobile.switchHost(id)` → 壳切代理目标并重载页面
 *
 * 凭证（会话 cookie）**永不出壳**（spec #55「凭证与安全」第 17 条）。
 */
class MobileBridge(private val host: MobileBridgeHost) {

    @JavascriptInterface
    fun hosts(): String = host.hostsJson()

    @JavascriptInterface
    fun current(): String = host.currentJson()

    @JavascriptInterface
    fun switchHost(id: String): Boolean = host.switchHost(id)
}
