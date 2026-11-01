/**
 * 壳的全局常量：壳与页面之间那份契约的唯一事实源。
 *
 * 这一层是「壳 ↔ 页面 ↔ lane」三方的边界定义：页面 origin、壳自有端点、
 * 壳桥的 JS 全局名、需要转发到 lane 的路径前缀。改这里等于改契约，其余代码只读。
 *
 * 与 Android 壳（mobile/android）的差别只有一处本质：
 * Android 壳用 `WebViewAssetLoader` 在 `https://appassets.androidplatform.net` 上提供本地资产；
 * 鸿蒙壳改为**壳内自带一个回环 HTTP 服务**（见 shell/page/PageServer），
 * 页面 origin 是 `http://127.0.0.1:<运行时端口>`。
 *
 * 为什么不是 ArkWeb 的请求拦截：
 *  - 拦截拿不到主文档（主框架走 onLoadIntercept，无法直接替换响应体）；
 *  - 拦截的响应体必须完整备好，**流式响应（SSE）无法透传**；
 *  - 拦截同样拿不到 POST 请求体。
 * 回环服务把三件事一次解决：真实 origin、完整请求体、流式响应；
 * 页面 origin 与 lane 不同源（WS 带令牌直连），HTTP 仍同源转发所以没有混合内容问题。
 */
export class ShellSettings {
  /**
   * 页面 origin 的主机名。
   *
   * 壳内 HTTP 服务绑在 127.0.0.1 上，端口运行时分配（见 PageServer）。
   * 回环主机名让页面**天然具备特权 origin**：上游客户端按 hostname 判定
   * `isLoopback`（upstream/packages/client/connection/src/client/index.ts），
   * 壳另外再显式声明 `ownsHost: true`。
   */
  static readonly PAGE_HOST: string = '127.0.0.1';

  /** 壳自有端点：引导载荷（注入行 + 传输配置）。页面 origin 内，不出壳。 */
  static readonly BOOT_PAYLOAD_PATH: string = '/__dsh-mobile-shell/boot.json';

  /**
   * lane 控制面的保留命名空间前缀。
   *
   * 与桌面端一致（packages/plus/desktop-remote-access/lib/lane-routes.mjs 的 LANE_PREFIX）：
   * lane 自己的控制面（配对 / 设备 / 隧道）住在这个命名空间里，永不与 dsh 路由同形。
   */
  static readonly LANE_PREFIX: string = '/__dsh-mobile';

  /**
   * 页面直连 lane 的 WS 路径前缀：`ws://<lane>/__dsh_ws/<令牌>/<原路径>`。
   *
   * 令牌放路径（WS 无法带请求头），lane 命中后先剥前缀再按原路径转发；
   * 见 packages/plus/desktop-remote-access/src/host/ws-token.ts。
   */
  static readonly LANE_WS_PREFIX: string = '/__dsh_ws/';

  /** lane 的回环端口映射前缀（lane 把 `127.0.0.1:<port>` 改写成这个前缀再转发）。 */
  static readonly LOOPBACK_PREFIX: string = '/_loopback/';

  /** 壳内原生请求桥的 JS 全局名（承载带请求体的 POST，见 bridge/NativeRequestBridge）。 */
  static readonly NATIVE_BRIDGE_NAME: string = '__dshShell';

  /** 移动端壳桥的 JS 全局名（hosts / current / switchHost）。 */
  static readonly MOBILE_BRIDGE_NAME: string = 'dshMobile';

  /** 桌面端设备列表里显示的名字（配对时上报给 lane）。 */
  static readonly DEVICE_NAME: string = 'DSH Desktop PlusM';

  /** 后台超时阈值：1 分钟（原型定稿：「离开超过 1 分钟」）。 */
  static readonly BACKGROUND_TIMEOUT_MS: number = 60000;

  /**
   * 壳当前的 plus 版本（更新比对的基准）。
   *
   * 鸿蒙壳不随发版（本壳用 DevEco 自建直装），但更新检查仍要知道自己「是哪个版本」，
   * 否则每次都会把同一个版本当成新版本反复提醒。默认值与 Android 壳的 `plusVersion`
   * 默认值一致（`mobile/android/app/build.gradle.kts`）；自建直装时改成对应的 plus 版本。
   */
  static readonly CURRENT_VERSION: string = '0.2.2-alpha.2.plus.1';

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
  static readonly FORWARDED_PREFIXES: string[] = [
    '/api/',
    '/plugins/',
    '/assets/',
    '/__dsh-mobile/',
    '/_loopback/',
  ];

  /** 判断一个页面路径是否属于「转发到 lane」的范畴。 */
  static isForwardedPath(path: string): boolean {
    for (let index = 0; index < ShellSettings.FORWARDED_PREFIXES.length; index++) {
      if (path.startsWith(ShellSettings.FORWARDED_PREFIXES[index])) {
        return true;
      }
    }
    return false;
  }
}
