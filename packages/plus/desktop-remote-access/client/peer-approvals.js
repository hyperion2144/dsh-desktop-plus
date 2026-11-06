//! 设备组网在界面上的呈现（#156）。
//!
//! - 被介绍方：有人经介绍人来敲门时，在会话区上方弹一张审批卡，写明「经谁介绍」，由本机用户同意或拒绝；
//!   绝不因为双方都信任介绍人就自动配对。
//! - 发起方：设备管理里每位介绍人的卡片下列出同组设备与请求进度（见 peer-group.jsx）。

/** 审批卡上的一句话与两个动作。 */
export function peerApprovalModel(request) {
  if (!request || typeof request !== "object" || typeof request.id !== "string" || request.id === "") return null;
  const from = request.from ?? {};
  const introducer = request.introducer ?? {};
  const who = typeof from.name === "string" && from.name !== "" ? from.name : typeof from.origin === "string" ? from.origin : "一台设备";
  const via = typeof introducer.name === "string" && introducer.name !== "" ? introducer.name : typeof introducer.origin === "string" ? introducer.origin : "";
  return {
    id: request.id,
    text: via === "" ? `设备「${who}」请求与你配对。` : `设备「${who}」（经 ${via} 介绍）请求与你配对。`,
    detail: "同意后双方互相登记，可以同步彼此的工作区与会话；拒绝则对方什么也拿不到。",
    actions: [{ id: "reject", label: "拒绝" }, { id: "approve", label: "同意" }],
  };
}

/** 审批卡的文字：去重与比对用。 */
function keyOf(model) {
  return model === null ? "" : `${model.id}:${model.text}`;
}

/**
 * 把审批卡挂到会话区上方（输入区在就挂它上面，否则挂侧栏列表上面）。
 * @param model 审批卡模型。
 * @param handlers.onAction 点了同意或拒绝。
 * @returns 卸下卡片的函数；找不到挂载点时返回 null。
 */
export function mountPeerApprovalCard(model, handlers) {
  const composer = document.querySelector('[contenteditable="true"][role="textbox"]') ?? document.querySelector("textarea");
  const host = composer?.parentElement ?? document.querySelector('[role="tree"][aria-label="会话"]')?.parentElement?.parentElement ?? null;
  if (!host || !model) return null;
  const root = document.createElement("div");
  root.setAttribute("data-dsh-remote-peer-approval", model.id);
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-label", "配对请求");
  root.style.cssText = [
    "display:flex", "align-items:center", "gap:10px", "flex-wrap:wrap",
    "margin:0 0 8px", "padding:10px 12px", "border-radius:10px",
    "border:1px solid var(--dsw-alias-label-primary, #e7eaf0)",
    "font-size:12px", "color:inherit", "background:var(--dsw-alias-background, transparent)",
  ].join(";");
  const text = document.createElement("div");
  text.style.cssText = "flex:1;min-width:0;";
  const title = document.createElement("p");
  title.style.cssText = "margin:0;font-weight:600;";
  title.textContent = model.text;
  const detail = document.createElement("p");
  detail.style.cssText = "margin:2px 0 0;color:var(--dsw-alias-label-secondary, #9aa4b2);";
  detail.textContent = model.detail;
  text.appendChild(title);
  text.appendChild(detail);
  root.appendChild(text);
  for (const action of model.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-dsh-remote-peer-action", action.id);
    button.textContent = action.label;
    button.style.cssText = [
      "font:inherit", "font-size:12px", "padding:4px 12px", "border-radius:8px", "cursor:pointer",
      action.id === "approve"
        ? "border:1px solid var(--dsw-alias-label-primary, #e7eaf0);background:transparent;color:inherit;font-weight:600;"
        : "border:1px solid var(--dsw-alias-border-secondary, #3a3a3f);background:transparent;color:inherit;",
    ].join(";");
    button.addEventListener("click", () => handlers.onAction(action.id));
    root.appendChild(button);
  }
  host.insertBefore(root, host.firstChild);
  return () => { root.remove(); };
}

/**
 * 轮询等本机用户决定的配对请求并弹出审批卡（浏览器专用）。
 * @param options.hostCall 控制面通道。
 * @param options.intervalMs 轮询间隔，缺省 2000。
 * @param options.mount 挂载函数（测试可替换）。
 * @param options.toast 提示函数。
 * @returns 卸载函数。
 */
export function installPeerApprovals(options = {}) {
  if (typeof document === "undefined") return () => {};
  const hostCall = options.hostCall;
  const intervalMs = options.intervalMs ?? 2000;
  const mount = options.mount ?? mountPeerApprovalCard;
  const toast = options.toast ?? (() => {});
  let shown = "";
  let unmount = null;
  let busy = false;
  const dismiss = () => {
    if (unmount !== null) { unmount(); unmount = null; }
    shown = "";
  };
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      let requests = [];
      try {
        const state = await hostCall("remotePeer.pending");
        requests = Array.isArray(state?.requests) ? state.requests : [];
      } catch { requests = []; }
      const model = requests.length === 0 ? null : peerApprovalModel(requests[0]);
      const key = keyOf(model);
      if (key === shown) return;
      dismiss();
      if (model === null) return;
      const mounted = mount(model, {
        onAction: (action) => {
          void (async () => {
            try {
              await hostCall("remotePeer.decide", { id: model.id, approve: action === "approve" });
              toast(action === "approve" ? "已同意，对方正在完成配对" : "已拒绝这次配对请求");
            } catch (error) {
              toast(`没有处理成功：${String(error?.message ?? error)}`);
            } finally {
              dismiss();
              void tick();
            }
          })();
        },
      });
      if (mounted !== null && mounted !== undefined) { unmount = mounted; shown = key; }
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => { void tick(); }, intervalMs);
  return () => { clearInterval(timer); dismiss(); };
}

/** 同组设备条目的展示状态：配对的 / 等待确认的 / 被拒或失败的 / 可以请求的。 */
export function peerGroupState(peer) {
  if (!peer || typeof peer !== "object") return { kind: "idle", text: "" };
  if (peer.paired === true) return { kind: "paired", text: "已配对" };
  if (peer.request === "pending") return { kind: "pending", text: "等待对方确认…" };
  if (peer.request === "failed") return { kind: "failed", text: peer.detail ?? "请求没有送到" };
  if (peer.request === "expired") return { kind: "expired", text: "对方没有处理，可以重新请求" };
  return { kind: "idle", text: "" };
}
