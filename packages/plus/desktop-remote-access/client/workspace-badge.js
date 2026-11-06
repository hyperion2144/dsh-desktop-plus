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
function paintBadge(label, text, title, state, host = label.parentElement ?? label) {
  const color = STATE_COLORS[state] ?? "";
  // 徽标挂在标签的**父容器**上：标签本身是 overflow:hidden 的截断容器，
  // 挂进去会被省略号裁掉——名字一长就完全看不见。
  const existing = host.querySelector(`[${BADGE_ATTR}]`);
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
    "flex:none",
    "max-width:96px",
    "overflow:hidden",
    "text-overflow:ellipsis",
  ].join(";");
  badge.append(dot, caption);
  host.appendChild(badge);
}

/**
 * 安装远程工作区徽标。
 * @param options.hostCall 与 host 的控制面通道。
 * @param options.intervalMs 重新拉取登记表的间隔（毫秒）。
 * @returns 卸载函数。
 */
export function installRemoteWorkspaceBadge({ hostCall, intervalMs = 0 }) {
  if (typeof document === "undefined") return () => { };
  /** title → { 主机展示名, 主机标识 } */
  let titles = new Map();
  /** 当前登记表涉及的主机标识 */
  let hostIds = new Map();
  /** hostId → 在线状态（online / offline / unpaired / incompatible） */
  let states = new Map();
  /** hostId → 三态的可读说法（来自宿主的 remoteStatus.probe，与设备管理里的文案同源）。 */
  let reasons = new Map();
  /** sessionId → { 主机展示名, 主机标识 }：B 侧镜像会话行的来源点（#106）。 */
  let sources = new Map();
  /** sessionId → 分享给了几台设备（A 端会话行徽标用） */
  let shareCounts = new Map();
  let stopped = false;
  let observer = null;
  /** SSE 事件源：host 侧变更推过来就重画。 */
  let source = null;

  const repaint = () => {
    if (stopped || titles.size === 0) return;
    // 按**工作区 id** 认行，不按标题：本机可能有一个同名工作区（比如对端也登记了同名目录），
    // 按标题匹配会把「远程」徽标画到本机工作区上。
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const workspaceId = key.slice("workspace:".length);
      const entry = titles.get(workspaceId);
      if (entry === undefined) continue;
      const name = entry.name;
      const state = states.get(entry.hostId);
      const offline = state === "offline";
      // 被别的设备使用中：显示「N 台设备」；否则显示「远程 · <主机>」。
      if (entry.claimed === true) {
        paintBadge(row, `${String(entry.claimCount)} 台设备`, name, "online", row);
        continue;
      }
      // 徽标写「远程 · <主机>」：改过名用名字，没改名用去掉协议的地址（ip:port），
      // 只写「远程」的话看不出是哪台设备。
      const shortName = name !== "" && !name.startsWith("http") ? name : "";
      const shortOrigin = name.startsWith("http") ? name.replace(/^https?:\/\//, "") : "";
      const caption = shortName !== "" ? shortName : shortOrigin;
      // 离线：条目变灰但仍列出；悬停给出可读原因（与三态同源的说法），不出现错误码。
      row.style.opacity = offline ? "0.55" : "";
      const reason = offline ? (reasons.get(entry.hostId) ?? "设备离线，可重试") : "";
      paintBadge(row, caption === "" ? BADGE_PREFIX : `${BADGE_PREFIX} · ${caption}`, reason === "" ? name : `${name}：${reason}；会话仍可查看`, state, row);
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
      // 会话行本身是 flex 容器：徽标直接挂在行上，不塞进会被截断的标题里。
      paintBadge(row, `分享 · ${count}`, `已分享给 ${count} 台设备`, 'online', row);
    }
  };


  // 本地分支标记（#154）：接管出来的本地会话，行上挂「本地分支」，悬停给出它来自哪台设备的哪条会话。
  // 集合由入口的分支轮询放在全局（会话 id → 出处）；没有分支时什么都不画。
  const repaintBranches = () => {
    const branches = globalThis.__DSH_REMOTE_BRANCHES__;
    if (stopped || !(branches instanceof Map) || branches.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute("data-row-key") ?? "";
      const origin = branches.get(key.slice("session:".length));
      if (typeof origin !== "string") continue;
      paintBadge(row, "本地分支", origin, "online", row);
    }
  };
  /** 来源点属性：镜像会话行行首的圆点，标出这条会话来自哪台设备。 */
  const SOURCE_ATTR = "data-dsh-remote-source";
  // 会话行来源点（#106）：远程工作区下的镜像会话，行首画一个来源点，颜色跟设备三态走。
  const repaintSources = () => {
    if (stopped || sources.size === 0) return;
    for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
      const key = row.getAttribute('data-row-key') ?? '';
      const source = sources.get(key.slice('session:'.length));
      if (source === undefined) continue;
      const color = STATE_COLORS[states.get(source.hostId)] ?? "";
      const shown = source.name.replace(/^https?:\/\//, "");
      let dot = row.querySelector(`[${SOURCE_ATTR}]`);
      if (dot === null) {
        dot = document.createElement("span");
        dot.setAttribute(SOURCE_ATTR, "1");
        dot.style.cssText = [
          "display:inline-block", "width:6px", "height:6px", "border-radius:50%",
          "margin-inline-end:5px", "flex:none", "vertical-align:middle",
        ].join(";");
        row.insertBefore(dot, row.firstChild);
      }
      dot.style.background = color === "" ? "currentColor" : color;
      dot.setAttribute("title", `来自 ${shown}`);
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
        // 键用工作区 id：标题会重名，id 不会。
        const workspaceId = typeof workspace.id === "string" ? workspace.id : "";
        if (workspaceId === "") continue;
        // claimed = 本机目录被别的设备使用中（对端 claim 写入），徽标显示设备数而不是「远程」。
        // 同一个工作区 id 会在清单里出现两次：远程登记（带 localDirectory）与「本机目录被别的设备使用」（claimed）。
        // 归并时任一条说明它是本机的，它就是本机的：被别的设备使用的本机目录本来就是本地工作区。
        const previous = next.get(workspaceId);
        next.set(workspaceId, { name, hostId, claimed: workspace.claimed === true || previous?.claimed === true, claimCount: typeof workspace.claimCount === "number" ? workspace.claimCount : 0, path: typeof workspace.path === "string" && workspace.path !== "" ? workspace.path : (previous?.path ?? ""), localDirectory: workspace.localDirectory === true || workspace.claimed === true || previous?.localDirectory === true });
        // 连接状态以下面的逐台探测为准。探测进行期间不改 states：提前按流的连接状态改写，
        // 会让这一行每次刷新都先灰一下，悬停说明却还是上一次探测的结论。
        if (hostId !== "") hostIdsNext.add(hostId);
      }
      titles = next;
      hostIds = hostIdsNext;
      // 诊断：确认 host 返回了多少条、侧栏此刻有多少行可匹配。
      // 远程会话 id 集合：流式转发（job/list、terminal/attach 等）只对**远程会话**接管，
      // 本地会话必须回落到官方 mux——否则后台任务列表这类全局流会被打到远端，界面直接空掉。
      const remoteIds = new Set();
      for (const workspace of list) {
        for (const sessionId of workspace?.sessionIds ?? []) {
          if (typeof sessionId === "string" && sessionId !== "") remoteIds.add(sessionId);
        }
      }
      globalThis.__DSH_REMOTE_SESSIONS__ = remoteIds;
      // 远程工作区 id 集合：工作区类操作（改名/删除/归档）只对这些 id 转发到远端。
      globalThis.__DSH_REMOTE_WORKSPACES__ = new Set(next.keys());
      // 远端专属的工作区（本机没有这个目录的）：同路径的本地与远程工作区在官方里并成同一个，在里面新建会话默认建在本机（见 remote-gate）。
      globalThis.__DSH_REMOTE_ONLY_WORKSPACES__ = new Set([...next].filter(([, entry]) => entry.localDirectory !== true).map(([id]) => id));
      // 远程工作区的目录：远程工作区上点「新会话」要按它认出来（见 remote-gate）；本机也有这个目录的不算。
      globalThis.__DSH_REMOTE_WORKSPACE_PATHS__ = new Set(list
        .filter((workspace) => workspace?.claimed !== true && workspace.localDirectory !== true && typeof workspace?.path === "string" && workspace.path !== "")
        .map((workspace) => workspace.path));
      // 镜像会话 → 来源主机：会话行的来源点据此绘制（#106）。
      const nextSources = new Map();
      for (const workspace of list) {
        if (workspace?.claimed === true) continue;
        const hostId = typeof workspace.hostId === "string" ? workspace.hostId : "";
        const name = typeof workspace.hostName === "string" && workspace.hostName !== "" ? workspace.hostName : "";
        for (const sessionId of workspace?.sessionIds ?? []) {
          if (typeof sessionId === "string" && sessionId !== "") nextSources.set(sessionId, { name, hostId });
        }
      }
      sources = nextSources;
      // 在线状态单独探测：探测失败只影响圆点颜色，不影响徽标本身。
      const probed = new Map();
      const described = new Map();
      await Promise.all([...hostIds].map(async (hostId) => {
        try {
          const result = await hostCall("remoteStatus.probe", { hostId });
          const state = result?.status?.state;
          if (typeof state === "string") probed.set(hostId, state);
          // 可读原因与设备管理同源：宿主按三态给出一句话，徽标悬停直接用它。
          if (typeof result?.description === "string") described.set(hostId, result.description);
        } catch {
          // 探测不到就是不可达：徽标声称的是「现在连得上」，宁可显示灰色也不能停在绿色。
          probed.set(hostId, "offline");
          described.set(hostId, "连不上设备，可重试");
        }
      }));
      states = probed;
      reasons = described;
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
      repaintSources();
      repaintBranches();
    } catch (error) {
      // 不静默：徽标是装饰，但刷新失败会让整个远程入口看起来没数据，必须留下原因。
      try { console.warn('dsh-remote-access: 徽标刷新失败：' + String(error && error.message ? error.message : error)) } catch { /* noop */ }
    }
  };

  void refresh();
  // 启动补刷：首次 refresh 可能早于控制面就绪或早于侧栏行挂载，
  // 而事件驱动在没有变更时不会自己触发——补两拍把「刚启动」这个窗口盖住。
  setTimeout(() => { void refresh(); }, 1200);
  setTimeout(() => { void refresh(); }, 4000);
  // 外部（添加/删除远程工作区之后）可以立刻催一次刷新，不用等 15 秒定时器。
  globalThis.__DSH_REMOTE_BADGE_REFRESH__ = () => { void refresh(); };

  // 供转发闸门查询「这个远程工作区所属设备此刻连不连得上」（#153：设备离线时远程工作区下的「新会话」禁用并说明原因）。
  // 还没探测过时返回 null：不拿未知状态去拦人，交给宿主报具体错误。
  globalThis.__DSH_REMOTE_LINK__ = (target) => {
    const workspaceId = target && typeof target.workspaceId === "string" ? target.workspaceId : "";
    const path = target && typeof target.path === "string" ? target.path : "";
    let hostId = "";
    if (workspaceId !== "" && titles.has(workspaceId)) hostId = titles.get(workspaceId).hostId;
    else if (path !== "") {
      for (const entry of titles.values()) {
        if (entry.path === path) { hostId = entry.hostId; break; }
      }
    }
    if (hostId === "") return null;
    const state = states.get(hostId);
    if (state === undefined) return null;
    return { state, reason: reasons.get(hostId) ?? "连不上设备，可重试" };
  };
  // 事件驱动：向 host 挂一个长轮询——没有变化时请求一直挂着，事件一到立刻返回。
  // 不是定时轮询：不会平白醒来，也不会漏掉「刚好在两次轮询之间」的变更。
  let waiting = true;
  const waitLoop = async () => {
    while (waiting && !stopped) {
      try {
        const result = await hostCall('remoteEvents.wait', {});
        if (Array.isArray(result?.events) && result.events.length > 0) await refresh();
      } catch {
        // 通道暂时不可用：退避一下再来，别打成忙等。
        await new Promise((resolve) => { setTimeout(resolve, 3000); });
      }
    }
  };
  void waitLoop();
  // 兜底：页面重新可见时刷一次（切换回来时状态可能已经变了）。
  const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
  document.addEventListener('visibilitychange', onVisible);
  observer = new MutationObserver(() => { repaint(); repaintSources(); });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    waiting = false;
    document.removeEventListener('visibilitychange', onVisible);
    observer?.disconnect();
    for (const node of document.querySelectorAll(`[${BADGE_ATTR}], [data-dsh-remote-source]`)) node.remove();
    for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) row.style.opacity = "";
  };
}
