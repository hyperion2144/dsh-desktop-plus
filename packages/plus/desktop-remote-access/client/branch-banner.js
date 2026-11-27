//! 会话接管在会话页上的呈现（#154）。
//!
//! 两种横幅，都挂在输入区上方（与交互卡片同一个位置，不同时出现）：
//! - 镜像会话 + 设备离线：说明设备不可达，并给出唯一的显式动作「接管为本地分支」；
//! - 本地分支：标明出处「本地分支（来自 <主机> / <原会话>，自 seq N）」。
//! 入口只在设备离线时出现，不做自动切换。

/**
 * 由宿主给出的状态得到横幅模型；不需要横幅时返回 null。
 * @param status `remoteBranch.status` 的返回。
 * @param conflict {{ message?: string, exits?: string[] } | null} 回推被拒时带回的说明与出口；没有则为 null。
 * @returns 横幅模型或 null。
 */
export function branchBannerModel(status, conflict = null) {
  if (!status || typeof status !== "object") return null;
  if (status.kind === "mirror" && status.canTakeover === true) {
    const reason = typeof status.reason === "string" && status.reason !== "" ? status.reason : "设备不可达";
    return { kind: "mirror", text: `设备离线：${reason}。可以把它接管成本地分支，用本机模型继续。`, actions: [{ id: "takeover", label: "接管为本地分支" }] };
  }
  if (status.kind === "branch") {
    if (typeof status.label !== "string" || status.label === "") return null;
    // 回推被拒且带出口（设备上的会话又前进了 / 别的分支已回推过）：把说明与两个出口摆出来，不自动合并。
    const exits = Array.isArray(conflict?.exits) ? conflict.exits : [];
    if (conflict !== null && typeof conflict.message === "string" && conflict.message !== "" && exits.length > 0) {
      const labels = { "keep-local": "保持本地", "fork-on-device": "在设备上另起一条" };
      return { kind: "branch", text: `${status.label}。${conflict.message}`, actions: exits.map((id) => ({ id: id === "fork-on-device" ? "fork" : "keep", label: labels[id] ?? id })) };
    }
    const push = status.push;
    if (push?.state === "ready") return { kind: "branch", text: `${status.label}。设备已恢复，可以把分支里的新内容回推回去。`, actions: [{ id: "push", label: "回推到设备" }] };
    if (push?.state === "offline" || push?.state === "unreachable") return { kind: "branch", text: `${status.label}。设备离线，恢复后可以回推。`, actions: [] };
    return { kind: "branch", text: status.label, actions: [] };
  }
  return null;
}

/**
 * 把横幅挂到输入区上方（幂等由调用方保证：同一模型不重复挂）。
 * @param composer 输入框元素。
 * @param model 横幅模型。
 * @param handlers.onAction 点横幅上的某个动作（接管 / 回推 / 保持本地 / 在设备上另起一条）。
 * @returns 卸下横幅的函数；输入区还没渲染出来时返回 null。
 */
export function mountBranchBanner(composer, model, handlers) {
  const host = composer?.parentElement;
  if (!host || !model) return null;
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-branch", model.kind);
  root.setAttribute("role", "status");
  root.style.cssText = [
    "display:flex", "align-items:center", "gap:10px", "flex-wrap:wrap",
    "margin:0 0 8px", "padding:8px 12px", "border-radius:10px",
    "border:1px solid var(--dsw-alias-border-secondary, #3a3a3f)",
    "font-size:12px", "color:var(--dsw-alias-label-secondary, #9aa4b2)",
  ].join(";");
  const text = document.createElement("span");
  text.style.cssText = "flex:1;min-width:0;";
  text.textContent = model.text;
  root.appendChild(text);
  for (const action of Array.isArray(model.actions) ? model.actions : []) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-dsh-remote-action", action.id);
    button.textContent = action.label;
    button.style.cssText = [
      "font:inherit", "font-size:12px", "padding:4px 12px", "border-radius:8px",
      "border:1px solid var(--dsw-alias-label-primary, #e7eaf0)", "background:transparent",
      "color:inherit", "cursor:pointer",
    ].join(";");
    button.addEventListener("click", () => handlers.onAction(action.id));
    root.appendChild(button);
  }
  host.insertBefore(root, host.firstChild);
  return () => { root.remove(); };
}

/**
 * 等侧栏里出现某条会话的行并点开它（接管后把用户带到分支上）。
 * @param sessionId 会话 id。
 * @param options.timeoutMs 最长等待；缺省 6000。
 * @param options.intervalMs 轮询间隔；缺省 400。
 * @returns 是否点开了。
 */
export async function openSessionRow(sessionId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 6000;
  const intervalMs = options.intervalMs ?? 400;
  const key = `session:${sessionId ?? ""}`;
  for (const deadline = Date.now() + timeoutMs; ; await new Promise((resolve) => setTimeout(resolve, intervalMs))) {
    const row = document.querySelector(`[data-row-key="${key}"]`);
    if (row) {
      // 先展开它所在的工作区分组（折叠时行不在树上），再点行。
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      return true;
    }
    if (Date.now() >= deadline) return false;
  }
}
