package com.plus.mobile.android.shell

/**
 * 壳的全局常量。
 *
 * 这一层是「壳与页面之间那份契约」的唯一事实源：页面 origin、资产目录、壳自有端点、
 * 需要转发到 lane 的路径前缀。改这里等于改契约，其余代码只读。
 */
object ShellSettings {

    /**
     * 页面 origin 的主机名。`file://` 不可行（模块脚本 + 相对 fetch 都会被 CORS 拦），
     * 必须给页面一个真实 origin —— 依据 wayfinder #50 原型结论与
     * docs/agents/research/upstream-bundle-and-plugin-injection.md §1.3。
     */
    const val PAGE_HOST = "appassets.androidplatform.net"

    /** 页面 origin。壳内所有本地资产都以它为基准解析文档相对 URL。 */
    const val PAGE_ORIGIN = "https://$PAGE_HOST"

    /** 页面文档在页面 origin 下的路径。 */
    const val DOCUMENT_PATH = "/index.html"

    /** 壳自带的上游 web 产物在 assets 下的目录名（构建产物，由 tools/sync-web-dist.sh 同步）。 */
    const val DIST_ASSET_DIR = "dist"

    /** 壳内静态引导脚本（assets/shell/boot.js）：页面在 document-start 取注入行与传输配置。 */
    const val BOOT_SCRIPT_ASSET = "shell/boot.js"

    /** 壳自有的引导端点：注入行 + 传输配置从这里取（页面 origin 内，不出壳）。 */
    const val BOOT_PAYLOAD_PATH = "/__dsh-mobile-shell/boot.json"

    /**
     * lane 控制面的保留命名空间前缀。
     *
     * 与桌面端一致（packages/plus/desktop-remote-access/lib/lane-routes.mjs 的 LANE_PREFIX）：
     * lane 自己的控制面（配对 / 设备 / 隧道）住在这个命名空间里，永不与 dsh 路由同形。
     */
    const val LANE_PREFIX = "/__dsh-mobile"

    /**
     * 页面直连 lane 的 WS 路径前缀：`ws://<lane>/__dsh_ws/<令牌>/<原路径>`。
     *
     * 末尾斜杠是硬要求：页面用 `new URL('api/remote.mux', base)` 相对解析 mux 路径，
     * 少了它 `__dsh_ws/<令牌>` 整段会被当成文件名吃掉（令牌也一同丢失）。
     */
    const val LANE_WS_PREFIX = "/__dsh_ws/"

    /** 壳内原生请求桥的 JS 全局名（承载带请求体的 POST，见 bridge/NativeRequestBridge）。 */
    const val NATIVE_BRIDGE_NAME = "__dshShell"

    /** 移动端壳桥的 JS 全局名（hosts / current / switchHost）。 */
    const val MOBILE_BRIDGE_NAME = "dshMobile"

    /**
     * 需要转发到 lane 的路径前缀。
     *
     * 页面的一切数据面请求都是**文档相对**的（权威说明见 upstream
     * `.agents/notes/implemented/architecture/2026-09-14-web-document-relative-app-routes.md`）：
     *  - `/api/`    —— 一元 RPC、网关 HTTP 面
     *  - `/plugins/`—— 插件 bundle（combo URL 形如 `plugins/??a/client.js,b/client.js&rev=…`）
     *  - `/assets/` —— 页面资源（本地 dist 未命中时回退到 lane）
     *  - `/__dsh-mobile/` —— lane 自己的保留命名空间（主题同步等注入脚本会用到）
     *  - `/_loopback/`  —— lane 的回环端口映射（主机自己的 127.0.0.1:port 引用）
     * 不在白名单里的路径既不本地命中也不转发：宁可 404，也不要把未知路径盲转给主机。
     */
    val FORWARDED_PREFIXES: List<String> = listOf(
        "/api/",
        "/plugins/",
        "/assets/",
        "/__dsh-mobile/",
        "/_loopback/",
    )

    /** 判断一个页面路径是否属于「转发到 lane」的范畴。 */
    fun isForwardedPath(path: String): Boolean = FORWARDED_PREFIXES.any { path.startsWith(it) }
}
