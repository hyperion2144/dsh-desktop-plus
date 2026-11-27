//! 会话菜单里「分享到远程…」的可见性判定。
//!
//! 只有**本机会话**能分享：它的本体在这台机器上，分享给另一台设备是「同一份日志的另一个视图」。
//! 远程会话的本体在别的设备上，再分享出去既没有语义也没有数据源，因此整个菜单项不渲染。

/**
 * 该会话是否应当隐藏分享入口。
 *
 * @param sessionId 当前会话标识。
 * @param remoteSessions 已知的远程会话集合（来自 remoteWorkspace.list 的 sessionIds）。
 * @returns 远程会话返回 true，本机会话（或集合尚未就绪）返回 false。
 */
export function shouldHideShareMenu(sessionId, remoteSessions) {
  if (typeof sessionId !== "string" || sessionId === "") return false;
  if (!(remoteSessions instanceof Set)) return false;
  return remoteSessions.has(sessionId);
}
