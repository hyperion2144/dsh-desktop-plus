// 远程工作区徽标：官方侧栏没有「工作区行」的徽标槽位（只有 directoryFlow / session.row.* 几个洞），
// 所以来源标记只能在插件侧补——用 MutationObserver 盯住侧栏树，给已登记的远程工作区行挂一个标记。
//
// 识别方式：插件登记远程工作区时写下的 title 就是侧栏渲染的那串文字，按它精确匹配叶子标签。
// 不注入样式表、不写死颜色：徽标只用官方 --dsw-alias-* 语义变量着色。
const BADGE_ATTR = "data-dsh-remote-workspace";
/** 记住这一行原本的工作区名：徽标挂进去以后 textContent 会带上徽标文字。 */
const LABEL_ATTR = "data-dsh-remote-label";

/** 徽标文案（与侧栏语言无关的短标记）。 */
/** 徽标前缀（与侧栏语言无关的短标记）。 */
const BADGE_PREFIX = "远程";

/** 在线状态对应的圆点颜色；未知状态不画颜色，沿用文字色。 */
const STATE_COLORS = {
  online: "#16a34a",
  offline: "#9ca3af",
  unpaired: "#f59e0b",
  incompatible: "#ef4444",
};

/**
 * 主机的展示名：没改过名就用远程地址（不带令牌），改过名用用户起的名字。
 * @param host 主机记录。
 * @returns 展示名。
 */
function displayNameOf(host) {
  const name = typeof host?.name === "string" ? host.name : "";
  const origin = typeof host?.origin === "string" ? host.origin : "";
  return host?.renamedAt !== undefined && name !== "" ? name : origin;
}

/**
 * 给一个标签节点挂徽标（幂等）。
 * @param label 侧栏里显示工作区名的那一行元素。
 * @param text 徽标文案。
 * @param title 悬停提示（主机展示名）。
 */
function paintBadge(label, text, title, state) {
  const color = STATE_COLORS[state] ?? "";
  const existing = label.querySelector(`[${BADGE_ATTR}]`);
  if (existing !== null) {
    if (existing.getAttribute("title") !== title) existing.setAttribute("title", title);
    const dot = existing.querySelector("[data-dsh-remote-dot]");
    const caption = existing.querySelector("[data-dsh-remote-text]");
    if (caption !== null && caption.textContent !== text) caption.textContent = text;
    if (dot !== null) dot.style.background = color === "" ? "currentColor" : color;
    return;
  }
  const badge = document.createElement("span");
  badge.setAttribute(BADGE_ATTR, "1");
  // 状态点：在线绿、离线灰、未配对橙、版本不兼容红；未知状态用文字色。
  const dot = document.createElement("span");
  dot.setAttribute("data-dsh-remote-dot", "1");
  dot.style.cssText = [
    "display:inline-block",
    "width:5px",
    "height:5px",
    "border-radius:50%",
    "margin-inline-end:4px",
    "vertical-align:middle",
    `background:${color === "" ? "currentColor" : color}`,
  ].join(";");
  const caption = document.createElement("span");
  caption.setAttribute("data-dsh-remote-text", "1");
  caption.textContent = text;
  // 徽标必须挂在标题文字内部：侧栏那一行是纵向 flex，作为兄弟节点会被拉成整行宽。
  badge.style.cssText = [
    "display:inline-block",
    "margin-inline-start:6px",
    "padding:0 5px",
    "border-radius:999px",
    "border:1px solid currentColor",
    "font-size:10px",
    "line-height:13px",
    "font-weight:500",
    "letter-spacing:0.02em",
    "opacity:0.55",
    "color:var(--dsw-alias-label-tertiary)",
    "vertical-align:middle",
    "white-space:nowrap",
    "pointer-events:none",
    "user-select:none",
  ].join(";");
  badge.append(dot, caption);
  label.appendChild(badge);
}

/**
 * 安装远程工作区徽标。
 * @param options.hostCall 与 host 的控制面通道。
 * @param options.intervalMs 重新拉取登记表的间隔（毫秒）。
 * @returns 卸载函数。
 */
export function installRemoteWorkspaceBadge({ hostCall, intervalMs = 15000 }) {
  if (typeof document === "undefined") return () => { };
  /** title → { 主机展示名, 主机标识 } */
  let titles = new Map();
  /** 当前登记表涉及的主机标识 */
  let hostIds = new Map();
  /** hostId → 在线状态（online / offline / unpaired / incompatible） */
  let states = new Map();
  /** sessionId → 分享给了几台设备（A 端会话行徽标用） */
  let shareCounts = new Map();
  let stopped = false;
  let observer = null;
  let timer = null;

  const repaint = () => {
    if (stopped || titles.size === 0) return;
    // 侧栏工作区行是 treeitem；「选择工作区」下拉是 menuitem/option。两处都要标。
    const labels = document.querySelectorAll(
      '[role="treeitem"] span, [role="treeitem"] div,' +
      '[role="menuitem"] span, [role="menuitem"] div,' +
      '[role="option"] span, [role="option"] div',
    );
    for (const label of labels) {
      // 只跳过真正的容器：徽标自己也是子元素，不能因此把这一行排除掉。
      const foreign = [...label.children].some((child) => !child.hasAttribute(BADGE_ATTR));
      if (foreign) continue;
      // 徽标文字会混进 textContent，所以优先用挂徽标时记下的原名。
      const text = label.getAttribute(LABEL_ATTR) ?? (label.textContent ?? "").trim();
      const entry = titles.get(text);
      if (entry === undefined) continue;
      const name = entry.name;
      const state = states.get(entry.hostId);
      // 记下原名再挂徽标：徽标文字会混进 textContent，下次靠这个属性认回这一行。
      label.setAttribute(LABEL_ATTR, text);
      paintBadge(label, name === "" ? BADGE_PREFIX : `${BADGE_PREFIX} · ${name}`, name, state);
    }
  };


  // 会话行徽标：行上有 data-row-key="session:<id>"，据此认出是哪个会话。
  const repaintShares = () => {
    if (stopped || shareCounts.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute('data-row-key') ?? '';
      const sessionId = key.slice('session:'.length);
      const count = shareCounts.get(sessionId);
      if (count === undefined || count === 0) continue;
      const label = row.querySelector('span, div');
      if (label === null) continue;
      paintBadge(label, `分享 · ${count}`, `已分享给 ${count} 台设备`, 'online');
    }
  };

  const refresh = async () => {
    try {
      const state = await hostCall("remoteWorkspace.list");
      const list = Array.isArray(state?.workspaces) ? state.workspaces : [];
      const next = new Map();
      const hostIdsNext = new Set();
      for (const workspace of list) {
        if (typeof workspace?.title !== "string" || workspace.title === "") continue;
        // 主机展示名随列表一起下发：徽标只靠这一次调用就能画出「远程 · <主机>」，
        // 不再二次拉主机表——那次调用失败会让徽标退化成只有「远程」。
        const name = typeof workspace.hostName === "string" && workspace.hostName !== ""
          ? workspace.hostName
          : typeof workspace.hostOrigin === "string" ? workspace.hostOrigin : "";
        const hostId = typeof workspace.hostId === "string" ? workspace.hostId : "";
        next.set(workspace.title, { name, hostId });
        // SSE 连接状态优先：它比一次性探测更能反映「现在能不能收到推送」。
        const streamState = typeof workspace.streamState === "string" ? workspace.streamState : ""
        if (streamState !== "") {
          const mapped = streamState === "connected" ? "online"
            : streamState === "connecting" ? "unpaired"
              : "offline"
          if (hostId !== "") states.set(hostId, mapped)
          for (const sessionId of workspace.sessionIds ?? []) {
            if (typeof sessionId === "string") sessionStates.set(sessionId, mapped)
          }
        }
        // SSE 连接状态优先：它比一次性探测更能反映「现在能不能收到推送」。
        if (typeof workspace.streamState === "string") {
          const mapped = workspace.streamState === "connected" ? "online"
            : workspace.streamState === "connecting" ? "unpaired"
              : "offline"
          if (hostId !== "") states.set(hostId, mapped)
        }
        if (hostId !== "") hostIdsNext.add(hostId);
      }
      titles = next;
      hostIds = hostIdsNext;
      // 在线状态单独探测：探测失败只影响圆点颜色，不影响徽标本身。
      const probed = new Map();
      await Promise.all([...hostIds].map(async (hostId) => {
        try {
          const result = await hostCall("remoteStatus.probe", { hostId });
          const state = result?.status?.state;
          if (typeof state === "string") probed.set(hostId, state);
        } catch {
          // 探测失败保持上一次的状态，不把在线误画成离线。
          const previous = states.get(hostId);
          if (previous !== undefined) probed.set(hostId, previous);
        }
      }));
      states = probed;
      // 分享计数：A 端会话行据此画「分享 · N」。
      try {
        const shareState = await hostCall("remoteShare.list", {})
        const shares = Array.isArray(shareState?.shares) ? shareState.shares : []
        const counts = new Map()
        for (const share of shares) {
          if (typeof share?.sessionId !== "string") continue
          counts.set(share.sessionId, (counts.get(share.sessionId) ?? 0) + 1)
        }
        shareCounts = counts
      } catch {
        // 分享表拿不到时保留上一次的计数。
      }
      repaint();
      // 分享徽标与远程工作区无关：A 端可能一个远程工作区都没有，必须单独重画。
      repaintShares();
    } catch {
    // 控制面还没就绪时静默跳过：徽标是装饰，不该影响侧栏。
    }
  };

  void refresh();
  timer = setInterval(() => { void refresh(); }, intervalMs);
  observer = new MutationObserver(() => { repaint(); });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    observer?.disconnect();
    for (const badge of document.querySelectorAll(`[${BADGE_ATTR}]`)) badge.remove();
  };
}
