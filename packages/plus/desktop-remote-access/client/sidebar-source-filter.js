//! 侧栏「本地 / 远程 / 全部」切换（#149）。
//!
//! 官方侧栏没有槽位，只能在 DOM 层注入：按「远程工作区 / 远程会话」的标记过滤官方已有的行，
//! 不另建第二套列表。主题插件 dsh-claude-style 自带同类下拉（DOM 带 `data-dsh-claude-*`），
//! 两个下拉叠在一起会互相遮挡，所以检测到它时不注入，回退为「单列表 + 设备徽标」。
//! 检测信号与回退都写日志，不静默。上次选择记在 localStorage，按 profile 隔离。

/** 三种来源视图，顺序即界面顺序。 */
export const SIDEBAR_SOURCES = Object.freeze([
  { value: "all", label: "全部" },
  { value: "local", label: "本地" },
  { value: "remote", label: "远程" },
]);

/** 缺省视图：全部——不替用户做任何隐藏。 */
export const DEFAULT_SIDEBAR_SOURCE = "all";

/** 我们注入的那条切换栏的标记：幂等、可被本模块自己认出来。 */
export const SOURCE_BAR_ATTRIBUTE = "data-dsh-remote-source-bar";

/** 我们隐藏行时打的标记：恢复时只动自己隐藏过的。 */
const HIDDEN_ATTRIBUTE = "data-dsh-remote-source-hidden";

/**
 * 把存下来或传进来的取值归一到合法视图。
 * @param value 任意值。
 * @returns `all` / `local` / `remote` 之一。
 */
export function parseSidebarSource(value) {
  return SIDEBAR_SOURCES.some((item) => item.value === value) ? value : DEFAULT_SIDEBAR_SOURCE;
}

/**
 * 记住上次选择用的存储键：按 profile 隔离，没有 profile 名时落到 default。
 * @param profile profile 名。
 * @returns localStorage 键。
 */
export function sidebarSourceStorageKey(profile) {
  const scope = typeof profile === "string" && profile !== "" ? profile : "default";
  return `dsh-remote-access.sidebar-source:${scope}`;
}

/**
 * 从侧栏行的 key 里取工作区 id；不是工作区行返回空串。
 * @param rowKey 行的 `data-row-key`，形如 `workspace:<id>` 或 `session:<id>`。
 * @returns 工作区 id。
 */
export function workspaceIdOfRowKey(rowKey) {
  return typeof rowKey === "string" && rowKey.startsWith("workspace:") ? rowKey.slice("workspace:".length) : "";
}

/**
 * 一个工作区是不是远程工作区（#106 的标记，由徽标维护在全局集合里）。
 * @param workspaceId 工作区 id。
 * @param known 已知的远程会话 / 远程工作区集合。
 * @returns 是远程工作区为 true；集合还没就绪时一律当本机，宁多显示不误隐藏。
 */
export function isRemoteWorkspace(workspaceId, known) {
  return workspaceId !== "" && known?.workspaces instanceof Set && known.workspaces.has(workspaceId);
}

/**
 * 某个来源视图下一行是否可见。
 * @param source 来源视图。
 * @param isRemote 这一行是不是远程的。
 * @returns 可见为 true。
 */
export function rowVisibleInSource(source, isRemote) {
  if (source === "local") return !isRemote;
  if (source === "remote") return isRemote;
  return true;
}

/**
 * 主题插件的同类下拉是否在场（互斥检查）：任一元素的属性名以 `data-dsh-claude-` 开头即算。
 * 优先用 XPath（浏览器里一次查询即可）；没有文档对象时退回逐个扫描（测试用假根）。
 * @param root 要检查的根；浏览器里传 document。
 * @returns 命中的属性名；不在场返回 null。
 */
export function detectThemeDropdown(root) {
  if (!root) return null;
  const doc = root.querySelector ? root.querySelector("html")?.ownerDocument ?? undefined : undefined;
  const document_ = typeof root.evaluate === "function" ? root : doc;
  if (document_ && typeof document_.evaluate === "function") {
    try {
      const result = document_.evaluate(
        '//*[@*[starts-with(name(.), "data-dsh-claude-")]]',
        document_.documentElement ?? document_,
        null,
        0, // XPathResult.ORDERED_NODE_ITERATOR_TYPE 的常量值；不直接引用全局，便于测试环境
        null,
      );
      const hit = result?.iterateNext?.();
      if (!hit) return null;
      for (const attr of hit.attributes ?? []) if (attr.name.startsWith("data-dsh-claude-")) return attr.name;
      return "data-dsh-claude-";
    } catch {
      // XPath 不可用（极少见）：退回逐个扫描。
    }
  }
  if (typeof root.querySelectorAll !== "function") return null;
  for (const element of root.querySelectorAll("*")) {
    for (const attr of element?.attributes ?? []) {
      if (attr.name.startsWith("data-dsh-claude-")) return attr.name;
    }
  }
  return null;
}

/**
 * 在侧栏里装上「本地 / 远程 / 全部」切换（浏览器专用）。
 *
 * - 切换栏插在滚动列表之前：不盖住官方头部按钮，也不随列表滚走。
 * - 只按标记隐藏 / 恢复官方已有的分组与行，并给自己隐藏过的元素打标记，恢复时只动这些。
 * - 点击同步生效；列表后来新增的行由 MutationObserver 在绘制前补上同样的处理，切换不闪烁。
 * - 主题插件的同类下拉在场时撤掉切换栏、恢复全部行，并写日志；它卸载后自动恢复。
 * - 上次选择记在 localStorage，按 profile 隔离（profile 名异步取自宿主）。
 *
 * @param options.hostCall 控制面通道（取 profile 名用）。
 * @param options.intervalMs 复查间隔（侧栏重挂、主题插件装上/卸下），缺省 3000。
 * @param options.log 日志函数，缺省 console.info。
 * @returns 卸载函数：撤掉切换栏并恢复所有行。
 */
export function installSidebarSourceFilter(options = {}) {
  if (typeof document === "undefined") return () => { };
  const hostCall = options.hostCall;
  const intervalMs = typeof options.intervalMs === "number" ? options.intervalMs : 3000;
  const log = typeof options.log === "function"
    ? options.log
    : (message) => { try { console.info("[dsh-remote-access] " + message); } catch { /* 日志写不出去不影响功能 */ } };

  let source = DEFAULT_SIDEBAR_SOURCE;
  let storageKey = sidebarSourceStorageKey(undefined);
  let bar = null;
  let fallbackLogged = false;
  let injectedLogged = false;
  let pending = false;
  let stopped = false;

  const readSaved = () => {
    try { source = parseSidebarSource(localStorage.getItem(storageKey)); } catch { /* 存储不可用：保持缺省 */ }
  };
  const save = () => {
    try { localStorage.setItem(storageKey, source); } catch { /* 存储不可用：只对本次生效 */ }
  };
  readSaved();
  // profile 名只有宿主知道：拿到后换成按 profile 隔离的键再读一次。
  void (async () => {
    try {
      const info = typeof hostCall === "function" ? await hostCall("info") : null;
      if (typeof info?.profile === "string" && info.profile !== "") {
        storageKey = sidebarSourceStorageKey(info.profile);
        readSaved();
        paint();
      }
    } catch { /* 控制面没就绪：沿用 default 键 */ }
  })();

  const knownRemote = () => ({ workspaces: globalThis.__DSH_REMOTE_WORKSPACES__, sessions: globalThis.__DSH_REMOTE_SESSIONS__ });
  const findTree = () => document.querySelector('[role="tree"][aria-label="会话"]');
  const setHidden = (element, hidden) => {
    if (hidden) {
      if (element.hasAttribute(HIDDEN_ATTRIBUTE)) return;
      element.setAttribute(HIDDEN_ATTRIBUTE, "1");
      element.style.display = "none";
      return;
    }
    if (!element.hasAttribute(HIDDEN_ATTRIBUTE)) return;
    element.removeAttribute(HIDDEN_ATTRIBUTE);
    element.style.display = "";
  };
  const restoreAll = (scope) => {
    for (const element of (scope ?? document).querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) setHidden(element, false);
  };
  const isRemoteSessionRow = (row, known) => {
    const key = row.getAttribute("data-row-key") ?? "";
    return key.startsWith("session:") && known.sessions instanceof Set && known.sessions.has(key.slice("session:".length));
  };

  const ensureBar = (tree) => {
    const body = tree.parentElement;
    const owner = body?.parentElement;
    const anchor = owner && owner !== document.body ? owner : body;
    if (!anchor) return null;
    if (bar && bar.isConnected && bar.parentElement === anchor) return bar;
    if (bar === null) {
      // 切换栏全局唯一：页面上已经有同一条（上一次安装留下的、热重载前的实例放的、或页面里另一份客户端放的），
      // 就接手这个节点、只换掉里面的按钮（让点击落到本次安装）；再放一条就会出现两行一模一样的切换。
      const existing = document.querySelector(`[${SOURCE_BAR_ATTRIBUTE}]`);
      if (existing !== null) {
        bar = existing;
        bar.replaceChildren();
      }
    }
    if (bar === null) {
      bar = document.createElement("div");
      bar.setAttribute(SOURCE_BAR_ATTRIBUTE, "1");
      bar.setAttribute("role", "tablist");
      bar.setAttribute("aria-label", "工作区来源");
      bar.style.cssText = "display:flex;gap:4px;padding:4px 10px;flex:none;";
    }
    if (bar.childElementCount === 0) {
      for (const item of SIDEBAR_SOURCES) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("data-source", item.value);
        button.textContent = item.label;
        button.style.cssText = "font:inherit;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid transparent;background:transparent;color:inherit;cursor:pointer;";
        button.addEventListener("click", () => setSource(item.value));
        bar.appendChild(button);
      }
    }
    anchor.insertBefore(bar, anchor.firstChild);
    if (!injectedLogged) {
      injectedLogged = true;
      log("侧栏已注入「本地 / 远程 / 全部」切换");
    }
    return bar;
  };
  const paintBar = () => {
    if (!bar) return;
    for (const button of bar.querySelectorAll("button[data-source]")) {
      const active = button.getAttribute("data-source") === source;
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.style.fontWeight = active ? "600" : "400";
      button.style.borderColor = active ? "var(--dsw-alias-label-primary, #e7eaf0)" : "transparent";
    }
  };
  const setSource = (value) => {
    source = parseSidebarSource(value);
    save();
    paint();
    // 被隐藏过的行重新出现时徽标要重画一遍，三种视图里的设备胶囊才一致。
    try { globalThis.__DSH_REMOTE_BADGE_REFRESH__?.(); } catch { /* 徽标不在场不影响过滤 */ }
    log(`侧栏来源切换为「${SIDEBAR_SOURCES.find((item) => item.value === source)?.label ?? source}」`);
  };

  const paint = () => {
    if (stopped) return;
    const tree = findTree();
    if (!tree) return;
    const theme = detectThemeDropdown(document);
    if (theme !== null) {
      // 互斥：主题插件自带同类下拉，叠在一起会互相遮挡。退让为单列表 + 设备徽标。
      restoreAll(tree);
      if (bar?.isConnected) bar.remove();
      if (!fallbackLogged) {
        fallbackLogged = true;
        injectedLogged = false;
        log(`检测到主题插件的分组下拉（${theme}），不注入来源切换，回退为单列表 + 设备徽标`);
      }
      return;
    }
    if (fallbackLogged) {
      fallbackLogged = false;
      log("主题插件的分组下拉已不在，恢复「本地 / 远程 / 全部」切换");
    }
    ensureBar(tree);
    paintBar();
    if (source === "all") {
      restoreAll(tree);
      return;
    }
    const known = knownRemote();
    for (const section of tree.children) {
      const header = section.querySelector?.('[data-row-key^="workspace:"]');
      if (header) {
        // 工作区分组整组同源：远程工作区下只有镜像会话，本机工作区下只有本机会话。
        const remote = isRemoteWorkspace(workspaceIdOfRowKey(header.getAttribute("data-row-key")), known);
        setHidden(section, !rowVisibleInSource(source, remote));
        continue;
      }
      // 没有工作区头行的分组（未分组）：按会话逐行判。
      for (const row of section.querySelectorAll?.('[data-row-key^="session:"]') ?? []) {
        setHidden(row, !rowVisibleInSource(source, isRemoteSessionRow(row, known)));
      }
    }
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    // MutationObserver 的回调在绘制之前跑：新出现的行在被看到之前就已按视图处理，切换不闪烁。
    queueMicrotask(() => { pending = false; paint(); });
  };
  const observer = typeof MutationObserver === "function" ? new MutationObserver(schedule) : null;
  const start = () => {
    const tree = findTree();
    if (tree && observer) observer.observe(tree, { childList: true, subtree: true });
    paint();
  };
  start();
  // 侧栏可能重挂、主题插件可能装上或卸下：定期复查。定时器不阻止进程退出。
  const timer = setInterval(() => {
    if (observer) { observer.disconnect(); start(); } else paint();
  }, intervalMs);
  // 首次：侧栏可能还没挂载，补两拍。
  setTimeout(paint, 1200);
  setTimeout(paint, 4000);
  return () => {
    stopped = true;
    clearInterval(timer);
    observer?.disconnect();
    if (bar?.isConnected) bar.remove();
    restoreAll();
  };
}
