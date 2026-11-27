//! 打开外部链接（#150）：优先交给桌面壳用系统浏览器打开；纯浏览器环境退回新标签页。
//! 本期不在内嵌视图里打开远程 UI——那会让「这是另一台机器的 DSH」这件事变得看不出。

/**
 * 在系统浏览器里打开一个地址。
 * @param url 要打开的地址。
 * @param env 运行环境（测试可注入）：`shellChannelRpc` 是桌面插件挂在页面上的壳通道，`open` 是 window.open。
 *   形状：`{ shellChannelRpc?: (endpoint: string, payload: unknown) => Promise<unknown>, open?: (...args: unknown[]) => unknown }`。
 * @returns 以打开方式兑现：`external`（系统浏览器）或 `window`（新标签页）；两种都不可用时拒绝。
 */
export async function openInSystemBrowser(url, env = globalThis) {
  const rpc = env.shellChannelRpc
  if (typeof rpc === "function") {
    try {
      await rpc("shell.invoke", { method: "open_external", params: { url } })
      return "external"
    } catch {
      // 壳通道在但命令失败（比如纯浏览器复用了外部实例）：退回新标签页，不让用户点了没反应。
    }
  }
  const open = env.open
  if (typeof open === "function") {
    const handle = open.call(env, url, "_blank", "noopener,noreferrer")
    if (handle !== null && handle !== undefined) return "window"
    // 被拦截弹出时 open 返回 null：仍算交给了浏览器，调用方不必再报错。
    return "window"
  }
  throw new Error("当前环境无法打开外部链接")
}
