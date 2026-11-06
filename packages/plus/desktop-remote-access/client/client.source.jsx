// dsh-remote-access client 半区：注册 settings.section「远程访问」行。
// 与 host 的 lane 走直 fetch（同机 loopback 直连，Host=127.0.0.1:lanePort；CORS 按 Origin 反射放行）。
// 早期尝试过 ctx.connection.rpc.call('/dsh-remote-access', ...)，carrier 已把 result 解包后客户端再 .result/.value 易错位，
// 故采用直 fetch，与 HEAD 已验证版本一致。
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import qrcodeFactory from "qrcode-generator";
import { RemoteAccessI18nProvider, useRemoteAccessT } from "../src/client/i18n/provider.tsx";
import { installRemoteAccessCopy } from "../src/client/i18n/install.ts";
import { RemoteDeviceManager } from "./remote-device-manager.jsx";
import { RemoteDirectoryFlow } from "./remote-directory-flow.jsx";
import { installRemoteWorkspaceBadge } from "./workspace-badge.js";

/** 硬依赖：slots（注册 settings.section 槽位）与 connection（client→host RPC）。
 *  Cordis Guard 拒绝未声明 ctx.<service> 访问；两者缺一，面板就不能工作。 */
export const inject = [
  "slots", "connection", "locale", "remote",
  // 会话级转发要用的远端命名空间：Cordis Guard 对嵌套属性同样要求声明。
  "remote.session", "remote.commands", "remote.fileUploads", "remote.fileReferences", "remote.permissionPresets",
];

export function apply(ctx) {
  // 面板文案：向官方 locale 服务注册本插件词典并绑定命名空间。
  const t = installRemoteAccessCopy(ctx);

  // 控制面通道：面板所有读写都走它（lane 只做反代，不再承载控制面）。
  const rpc = ctx?.connection?.rpc;
  if (rpc && typeof rpc.call === "function") {
    hostRpc = (channel, endpoint, payload) => rpc.call(channel, endpoint, payload);
  } else {
    ctx?.logger?.warn?.(
      "dsh-remote-access: connection.rpc 不可用，远程访问面板无法与 host 通信",
    );
  }
  const slots = ctx?.slots;
  if (
    !slots ||
    typeof slots.inject !== "function" ||
    typeof slots.register !== "function"
  ) {
    ctx?.logger?.warn?.("dsh-remote-access: slots 服务不可用，跳过设置入口");
    return;
  }
  // 远程设备管理：一个设置 tab，内部双 tab（设备分享 / 设备管理）。
  // 设备分享 = 原「远程访问」面板去掉已配对设备列表；设备管理 = 新增设备 + 设备卡片。
  slots.inject("settings.section", () =>
    slots.register(
      {
        name: "settings.section",
        id: "dsh-remote-devices",
        order: 20,
        label: () => t("远程设备管理"),
      },
      () => (
        <RemoteAccessI18nProvider t={t}>
          <RemoteDevicesSection hostCall={hostCall} />
        </RemoteAccessI18nProvider>
      ),
    ),
  );
  // 会话菜单：推送到远程 / 同步最新状态（#93）。
  slots.inject("sidebar.workspaces.session.menu.item", () =>
    slots.register(
      { name: "sidebar.workspaces.session.menu.item", id: "dsh-remote-sync", order: 900 },
      (menuProps) => (
        <RemoteAccessI18nProvider t={t}>
          <RemoteSyncMenu
            sessionId={menuProps.sessionId}
            hostCall={hostCall}
            dismiss={() => menuProps.menuOpenState?.[1]?.(false)}
          />
        </RemoteAccessI18nProvider>
      ),
    ),
  );
  // 添加工作区（#106）：官方 ui-workspace 把「添加工作区…」入口交给 directoryFlow 洞的占位者，
  // 官方占位者注册在 priority 0 且是 renderless 的（直接弹系统选择器）。single 槽位只在**同优先级**
  // 冲突，所以这里用 priority -1 遮蔽它（**最低者渲染**，官方在 0）：不改 upstream，也不产生第二个同优先级占位者。
  const pick = () => {
    const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
    if (desktop && typeof desktop.pick === "function") return desktop.pick();
    const uiWorkspace = ctx.get?.("uiWorkspace");
    return uiWorkspace?.pickDirectory?.() ?? Promise.resolve(null);
  };
  const flowInjected = () => ({ hostCall, pick });
  for (const hole of ["sidebar.workspaces.directoryFlow", "conversation.hero.workspace.directoryFlow"]) {
    slots.inject(hole, () =>
      slots.register({ name: hole, priority: -1, inject: flowInjected }, (flowProps) => (
        <RemoteAccessI18nProvider t={t}>
          <RemoteDirectoryFlow {...flowProps} />
        </RemoteAccessI18nProvider>
      )),
    );
  }
  // 远程工作区徽标：官方侧栏没有工作区行的徽标槽位，只能在插件侧补（DOM 注入，不改上游）。
  try {
    const uninstallBadge = installRemoteWorkspaceBadge({ hostCall });
    ctx?.on?.('dispose', uninstallBadge);
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: 远程工作区徽标未安装（${String(error)}）`);
  }
  // 会话级双向转发：远程会话上所有「会改变远端状态」的调用都转给 A 机。
  // 读与流（page/events/state/follow/observe*）留在本地——本地镜像已经提供同样的数据。
  // remote 命名空间是异步挂载的：apply 时可能还没就绪，所以轮询等到出现再包。
  const installForwarding = () => {
  try {
    const remote = ctx?.remote;
    if (remote) {
      const forward = async (namespace, method, args) => {
        const result = await hostCall('remoteSession.invoke', { namespace, method, args });
        return result && result.value !== undefined ? result.value : undefined;
      };
      const wrap = (name, table) => {
        const ns = remote[name];
        if (!ns) return;
        const wrapped = Object.create(ns);
        for (const [method, toArgs] of Object.entries(table)) {
          if (typeof ns[method] !== 'function') continue;
          const original = ns[method].bind(ns);
          wrapped[method] = async (...args) => {
            try {
              const value = await forward(name, method, toArgs(args));
              if (value !== undefined) {
                // 远端还没有活体 agent 时命令先排队，给界面一个成功回执。
                if (value && value.queued === true) return { commandId: 'queued', result: { kind: 'success' } };
                return value;
              }
            } catch (error) {
              // 只有「不是远程会话」才退回本地；远程会话失败绝不能本地执行——
              // 本地执行会往镜像会话里写一份事件，和远端回流的事件撞车（commandId 重复）。
              const message = String(error?.message ?? error);
              if (!message.includes('not-found')) {
                console.warn('dsh-remote-access: 远程调用失败，已忽略本地回退：' + message);
                return { commandId: 'remote-failed', result: { kind: 'success' } };
              }
              // 不是远程会话：退回官方本地实现。
            }
            return original(...args);
          };
        }
        Object.defineProperty(remote, name, { value: wrapped, configurable: true, writable: true });
      };
      const request = (args) => ({ request: args[0] });
      // 会话级：改名、分叉、队列、附件、打开路径、路径候选。
      wrap('session', {
        rename: request,
        fork: request,
        updateQueue: request,
        attachment: request,
        openWorkspacePath: request,
        workspacePathApplications: request,
      });
      // 命令：/permission 等必须在 A 机执行。
      wrap('commands', {
        execute: (args) => ({ agentId: args[0], line: args[1], submittedAttachments: args[2] ?? [] }),
        list: (args) => ({ agentId: args[0] }),
      });
      // 附件上传（输入框的 + 号）：文件必须落在 A 机。
      wrap('fileUploads', {
        upload: (args) => ({ agentId: args[0], request: args[1] }),
      });
      // @ 引用候选：要读 A 机的文件系统。
      wrap('fileReferences', {
        list: (args) => ({ agentId: args[0], query: args[1] ?? '' }),
      });
      // 权限预设目录：A 机装了哪些预设。
      wrap('permissionPresets', {
        catalog: () => ({}),
      });
      ctx?.logger?.info?.('dsh-remote-access: 会话级转发已安装（session/commands/fileUploads/fileReferences/permissionPresets）');
    }
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: 会话级转发未安装（${String(error)}）`);
    }
  };
    // 最多等 30 秒：remote 挂载完成后立刻装，装好就停。
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const ready = ctx?.remote && ctx.remote.session && ctx.remote.commands;
      if (ready) {
        clearInterval(timer);
        installForwarding();
        return;
      }
      if (tries >= 60) clearInterval(timer);
    }, 500);
  ctx?.on?.('dispose', () => clearInterval(timer));

  // 传输层转发：官方所有远端调用都走 connection.rpc.call('/api', endpoint, {args})。
  // 在命名空间上打补丁不可靠（调用方可能早就抓住了旧对象），所以直接拦这一层。
  try {
    const rpcService = ctx?.connection?.rpc;
    if (rpcService && typeof rpcService.call === 'function') {
      const originalCall = rpcService.call.bind(rpcService);
      // 只转这些：控制器已经包过 create/prompt/cancel/selectModel，重复转会绕过镜像登记。
      const FORWARD = new Set([
        'session/rename', 'session/fork', 'session/updateQueue', 'session/attachment',
        'session/openWorkspacePath', 'session/workspacePathApplications',
        'commands/execute', 'commands/list',
        'fileUploads/upload', 'fileReferences/list', 'permissionPresets/catalog',
        // 后台任务：杀掉远端任务必须发到 A 机。
        'job/kill',
        // 子代理：提示与打断都在 A 机上执行。
        'subagents/prompt', 'subagents/interruptByParent',
        // 右侧边栏的工作区文件：读的是 A 机的磁盘。
        'workspaceFiles/list', 'workspaceFiles/read', 'workspaceFiles/stat', 'workspaceFiles/readBytes',
        // 终端：pty 必须开在 A 机上。
        'terminal/create', 'terminal/close', 'terminal/rename', 'terminal/list',
        'terminal/shells', 'terminal/environment',
        // 工作区与会话的菜单操作：改名、删除、归档、置顶都要落到 A 机。
        'workspace/rename', 'workspace/delete', 'workspace/archiveSession', 'workspace/unarchiveSession',
        'workspace/pinSession', 'workspace/unpinSession',
      ]);
      let inside = false;
      rpcService.call = async (channel, endpoint, payload, signal) => {
        if (inside || channel !== '/api' || !FORWARD.has(endpoint)) return originalCall(channel, endpoint, payload, signal);
        const args = payload && payload.args ? payload.args : {};
        const slash = endpoint.indexOf('/');
        const namespace = endpoint.slice(0, slash);
        const method = endpoint.slice(slash + 1);
        inside = true;
        try {
          const result = await hostCall('remoteSession.invoke', { namespace, method, args });
          if (result && result.value !== undefined) return { ok: true, value: result.value };
        } catch (error) {
          const message = String(error?.message ?? error);
          if (!message.includes('not-found')) {
            console.warn('dsh-remote-access: 远程调用失败 ' + endpoint + '：' + message);
            return { ok: false, error: { code: 'remote-failed', message } };
          }
        } finally {
          inside = false;
        }
        return originalCall(channel, endpoint, payload, signal);
      };
      console.info('dsh-remote-access: 传输层转发已安装');

      // 流式接口：官方流走 WebSocket 流载体，本机没有远端数据。
      // 定义 rpc.open 后网关会优先用它；返回 undefined 表示「不接管」，
      // 网关会自己回落到原来的 mux，所以本地会话的流不受影响。
      const STREAM_FORWARD = new Set([
        'terminal/attach', 'terminal/retain',
        'job/list', 'job/follow',
        'workspaceFiles/changes',
      ]);
      const pickSession = (args) => {
        const request = args && args.request ? args.request : {};
        const candidates = [args && args.agentId, args && args.sessionId, args && args.workspaceFileScopeId, request.sessionId, request.parentSessionId];
        for (const value of candidates) if (typeof value === 'string' && value !== '') return value;
        return undefined;
      };
      const openRemoteStream = (endpoint, args, sessionId, signal, uplink) => {
        const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/remote-access.stream?sessionId=' + encodeURIComponent(sessionId);
        const socket = new WebSocket(url);
        const streamId = 'rs-' + Math.random().toString(36).slice(2);
        const queue = [];
        let finished = false;
        let wake = null;
        const push = (frame) => { queue.push(frame); if (wake) { const w = wake; wake = null; w(); } };
        socket.addEventListener('message', (event) => {
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.streamId !== streamId) return;
          if (message.type === 'item') push({ kind: 'item', value: message.value });
          else if (message.type === 'error') { push({ kind: 'error', error: message.error }); finished = true; }
          else if (message.type === 'end') { push({ kind: 'end' }); finished = true; }
        });
        socket.addEventListener('close', () => { finished = true; if (wake) { const w = wake; wake = null; w(); } });
        const ready = new Promise((resolve) => {
          socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
            resolve();
          });
          socket.addEventListener('error', () => resolve());
        });
        // 上行：把调用方的 uplink 逐条转给 A 机。
        if (uplink) {
          void (async () => {
            try {
              for await (const value of uplink) {
                await ready;
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'item', streamId, value }));
              }
              await ready;
              if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'end', streamId }));
            } catch { /* 上行结束不影响下行 */ }
          })();
        }
        const abort = () => { finished = true; if (wake) { const w = wake; wake = null; w(); } };
        if (signal) signal.addEventListener('abort', abort);
        return (async function* relay() {
          try {
            await ready;
            while (true) {
              if (queue.length === 0) {
                if (finished) return;
                await new Promise((resolve) => { wake = resolve; });
                continue;
              }
              const frame = queue.shift();
              if (frame.kind === 'item') { yield frame.value; continue; }
              if (frame.kind === 'error') throw new Error((frame.error && frame.error.message) || (endpoint + ' 远端流失败'));
              return;
            }
          } finally {
            if (signal) signal.removeEventListener('abort', abort);
            try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel', streamId })); } catch { /* 已关闭 */ }
            try { socket.close(); } catch { /* 已关闭 */ }
          }
        })();
      };
      rpcService.open = (channel, endpoint, payload, signal, uplink) => {
        if (channel !== '/api' || !STREAM_FORWARD.has(endpoint)) return undefined;
        const args = payload && payload.args ? payload.args : {};
        const sessionId = pickSession(args);
        if (sessionId === undefined) return undefined;
        return openRemoteStream(endpoint, args, sessionId, signal, uplink);
      };
      console.info('dsh-remote-access: 流式转发已安装');
    }
  } catch (error) {
    ctx?.logger?.warn?.(`dsh-remote-access: 传输层转发未安装（${String(error)}）`);
  }
}

const lanePort = Number(globalThis.__DSH_REMOTE_LANE_PORT__) || 3091;

/**
 * 设置面板与 host 的**唯一**通道：dsh 同源 connection RPC（通道 `/dsh-remote-access`）。
 *
 * #154 定稿：lane（反代端口）**只做反代**，不再承载控制面——面板上所有操作（铸造令牌 /
 * 设备列表 / 隧道地址 / cloudflared）都走 client→host，与其它设置面同构。`apply(ctx)` 里
 * 把 rpc caller 注入进来；缺失就明确报错，**不回退 HTTP 直连 lane**。
 */
let hostRpc = null;

async function hostCall(endpoint, payload = {}) {
  if (!hostRpc) throw new Error("host 通道不可用（connection.rpc 缺失）");
  const r = await hostRpc("/api", "remote-access." + endpoint, payload);
  if (!r || !r.ok) throw new Error(r?.error?.message ?? "rpc-error");
  return r.value;
}

/** 读 CSS 变量（mount 时取一次），避免每次 render 走 getComputedStyle。 */
function readCssVar(name, fallback) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

// 按钮交互样式：hover/active/busy/flash。原始 cssText 原样保留，仅重组形式。
// 注入到 <head> 的 <style>（data-remote-access 标记），面板卸载时随 effect 清理函数移除。
const BUTTON_CSS = `
[data-remote-access-btn] {
transition: transform .08s ease, filter .15s ease, background .15s ease, border-color .15s ease, color .15s ease;
user-select: none;
}
[data-remote-access-btn]:hover { filter: brightness(1.18); }
[data-remote-access-btn]:active {
transform: translateY(1px) scale(0.97);
filter: brightness(0.92);
}
[data-remote-access-btn][data-busy="1"] {
opacity: 0.55;
cursor: progress;
}
[data-remote-access-btn][data-flash="ok"] {
background: #2fbf71 !important;
border-color: #2fbf71 !important;
color: #fff !important;
}
[data-remote-access-btn][data-flash="err"] {
background: #e5484d !important;
border-color: #e5484d !important;
color: #fff !important;
}
`;

/** 面板按钮：data-remote-access-btn + busy/flash 反馈。
 *  onClick({ flash }) —— 通过 flash(kind, newText?, ms?) 触发瞬时反馈；busy 由内层包装自动管理。
 */
function PanelButton({ text, ghost, cssVars, onClick }) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // 'ok' | 'err' | null
  const [flashText, setFlashText] = useState(null);
  const flashTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const handleClick = async () => {
    if (busy || !onClick) return;
    setBusy(true);
    try {
      await onClick({
        flash: (kind, newText, ms = 1500) => {
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          if (newText != null) setFlashText(newText);
          setFlash(kind);
          flashTimerRef.current = setTimeout(() => {
            setFlash(null);
            setFlashText(null);
            flashTimerRef.current = null;
          }, ms);
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const style = {
    background: ghost ? "transparent" : cssVars.accent,
    color: ghost ? cssVars.text2 : "#fff",
    border: `1px solid ${ghost ? cssVars.line : "transparent"}`,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
  };

  return (
    <button
      type="button"
      data-remote-access-btn="1"
      data-busy={busy ? "1" : undefined}
      data-flash={flash ?? undefined}
      style={style}
      onClick={handleClick}
    >
      {flashText ?? text}
    </button>
  );
}

/** 二维码数据 URL：qrcode-generator createDataURL 不产生 DOM，纯数据 → 直接用于 <img src>。
 *  本文件唯一一个二维码库的产出点；其余 UI 全部 JSX。
 */
function makeQr(link) {
  if (!link) return null;
  try {
    const qr = qrcodeFactory(0, "M");
    qr.addData(link);
    qr.make();
    return qr.createDataURL(4, 8);
  } catch {
    return null;
  }
}

/** 通道卡片：标题 + 描述 + 输入区 + 链接文本 + 二维码 + hint + 操作行。
 *  - beforeLink：插在描述与链接之间的内容（输入框、状态文本等）
 *  - link：mint 后的配对链接
 *  - qrSrc：qrcode.createDataURL 数据（image src）
 *  - hint：{ text, color }
 *  - actions：底部按钮行（Fragment 或元素数组）
 */
function ChannelCard({
  label,
  desc,
  cssVars,
  beforeLink,
  link,
  qrSrc,
  hint,
  actions,
}) {
  const t = useRemoteAccessT();
  return (
    <div
      style={{
        border: `1px solid ${cssVars.line}`,
        borderRadius: 10,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      {desc && <div style={{ color: cssVars.text2, fontSize: 12 }}>{desc}</div>}
      {beforeLink}
      {link && (
        <code
          style={{
            color: cssVars.text,
            fontSize: 12,
            wordBreak: "break-all",
            background: cssVars.panel,
            border: `1px solid ${cssVars.line}`,
            borderRadius: 6,
            padding: 6,
            display: "block",
          }}
        >
          {link}
        </code>
      )}
      {qrSrc && (
        <img
          alt={t("{label} 配对二维码", { label })}
          src={qrSrc}
          style={{
            width: 180,
            height: 180,
            imageRendering: "pixelated",
            borderRadius: 8,
            border: `1px solid ${cssVars.line}`,
          }}
        />
      )}
      {hint?.text && (
        <div style={{ color: hint.color, fontSize: 12 }}>{hint.text}</div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>
    </div>
  );
}

/** settings.section 的 React 组件契约：返回 JSX 树，状态由 hooks 维护。 */
function RemoteAccessPanel() {
  const t = useRemoteAccessT();
  // 读 CSS 变量一次（mount 时取）
  const cssVars = useMemo(
    () => ({
      text: readCssVar("--dsw-alias-label-primary", "#e7eaf0"),
      text2: readCssVar("--dsw-alias-label-secondary", "#9aa4b2"),
      panel: readCssVar("--dsw-alias-bg-layer-1", "#171a21"),
      line: readCssVar("--dsw-alias-border-l2", "#2a2f3a"),
      accent: readCssVar("--dsw-alias-state-accent-primary", "#4d6bfe"),
    }),
    [],
  );

  // 注入按钮交互 CSS（hover/active/busy/flash），卸载时清理避免 <head> 污染
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-remote-access", "1");
    styleEl.textContent = BUTTON_CSS;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, []);

  // ---- LAN state ----
  // lanBase 只在 mint handler 内被读，不参与渲染 → 用 ref 避免触发重渲染
  const lanBaseRef = useRef(null);
  const [lanLink, setLanLink] = useState(null);
  const [lanHint, setLanHint] = useState(null);

  // ---- Tunnel state ----
  const [tunInputValue, setTunInputValue] = useState("");
  const [tunSavedUrl, setTunSavedUrl] = useState("");
  const [tunResult, setTunResult] = useState({ text: "", color: "" });
  const [tunLink, setTunLink] = useState(null);
  const [tunHint, setTunHint] = useState(null);

  // ---- Cloudflared state ----
  const [cfState, setCfState] = useState({
    bin: "",
    url: null,
    running: false,
    reason: null,
    phase: "idle",
    detail: "",
    message: "",
  });
  const [cfInputValue, setCfInputValue] = useState("");
  const [cfInFlight, setCfInFlight] = useState(null); // 异步进行中显示：{ text, color }
  const [cfStatusError, setCfStatusError] = useState(null); // 轮询/动作错误覆盖
  const [cfLink, setCfLink] = useState(null);
  const [cfHint, setCfHint] = useState(null);

  // ---- Devices state ----
  const [devices, setDevices] = useState([]);
  const [devicesError, setDevicesError] = useState(null);
  const [deviceErrors, setDeviceErrors] = useState({}); // deviceId → 行内移除失败信息

  // ---- refresh helpers（stable useCallback，2s 轮询复用）----
  // tunSavedUrl 在 refreshLanBase 中按"首次填充"语义读取，需要读到最新值 → ref
  const tunSavedUrlRef = useRef("");
  tunSavedUrlRef.current = tunSavedUrl;

  const refreshDevices = useCallback(async () => {
    try {
      const st = await hostCall("devices.list");
      setDevices(st.devices ?? []);
      setDevicesError(null);
      setDeviceErrors({}); // 刷新成功清掉行内错误（与原版 refresh() 重建 DOM 一致）
    } catch (e) {
      setDevices([]);
      setDevicesError(t("配对服务不可达：{message}", { message: e.message }));
    }
  }, []);

  const refreshCf = useCallback(async () => {
    try {
      const st = await hostCall("cloudflared.get");
      setCfState({
        bin: st.bin ?? "",
        url: st.url ?? null,
        running: !!st.running,
        reason: st.reason ?? null,
        message: st.message,
        phase: st.phase ?? "idle",
        detail: st.detail ?? "",
      });
      setCfStatusError(null);
    } catch (e) {
      setCfStatusError(t("查询失败：{message}", { message: e.message }));
    }
  }, []);

  const refreshLanBase = useCallback(async () => {
    try {
      const info = await hostCall("info");
      const port = info.lanePort ?? lanePort;
      // 地址候选：`.local` 主机名 + 多网卡 IP（桌面下发；手机壳按平台择优：iOS 用 .local，
      // Android/鸿蒙用 IP）。链接本身仍用可达的 IP 打开——.local 只作候选，不做主地址。
      const candidates = Array.isArray(info.baseCandidates) ? info.baseCandidates : [];
      lanBaseRef.current = {
        base: info.lanIp ? info.lanIp + ":" + port : "127.0.0.1:" + port,
        candidates,
        scheme: "http",
      };
      if (!tunSavedUrlRef.current && info.customTunnelUrl) {
        setTunSavedUrl(info.customTunnelUrl);
        setTunInputValue(info.customTunnelUrl);
      }
    } catch {
      /* noop */
    }
  }, []);

  // 首次拉取 + 2s 轮询（设备 + cloudflared）；lanBase 仅首次（mint 时按需 refreshLanBase）
  useEffect(() => {
    void refreshDevices();
    void refreshCf();
    void refreshLanBase();
    const id = setInterval(() => {
      void refreshDevices();
      void refreshCf();
    }, 2000);
    return () => clearInterval(id);
  }, [refreshDevices, refreshCf, refreshLanBase]);

  // cfState.bin 由 server 同步到本地 input（与原版 renderCf 行为一致）
  useEffect(() => {
    setCfInputValue(cfState.bin || "");
  }, [cfState.bin]);

  // ---- 派生：CF 状态显示 ----
  // 优先级：in-flight 文本 > 错误覆盖 > cfState 计算结果
  const cfStatus = useMemo(() => {
    if (cfInFlight) return cfInFlight;
    if (cfStatusError) return { text: cfStatusError, color: "#e5484d" };
    const s = cfState;
    if (s.running || s.url) {
      return {
        text: s.url
          ? t("运行中 · {url}", { url: s.url })
          : s.detail || t("运行中 · 等待隧道地址…"),
        color: "#2fbf71",
      };
    }
    if (s.phase === "error") {
      return {
        text: t("启动失败：{message}", { message: s.message || s.detail || t("cloudflared 无法启动") }),
        color: "#e5484d",
      };
    }
    if (s.phase === "resolving" || s.phase === "downloading") {
      return {
        text:
          s.phase === "downloading"
            ? t("下载中 · {detail}", { detail: s.detail || "…" })
            : t("解析中 · {detail}", { detail: s.detail || "…" }),
        color: "#4d6bfe",
      };
    }
    if (s.phase === "starting" || s.phase === "registering") {
      return { text: s.detail || t("启动中…"), color: "#4d6bfe" };
    }
    if (s.bin) return { text: t("已配置 · 未运行"), color: cssVars.text2 };
    return { text: t("未配置 · 未运行"), color: cssVars.text2 };
  }, [cfState, cfStatusError, cfInFlight, cssVars.text2, t]);

  // ---- 派生：QR data URL ----
  const lanQr = useMemo(() => makeQr(lanLink), [lanLink]);
  const tunQr = useMemo(() => makeQr(tunLink), [tunLink]);
  const cfQr = useMemo(() => makeQr(cfLink), [cfLink]);

  // ---- helpers ----
  // 配对链接地址**刻意用历史形态 `/pair`**（不带命名空间前缀）：已安装的旧壳解析器只认裸
  // `/pair`，给命名空间形态它会把它当目录拼错地址 → 401（实机踩过）；lane 两种都服务。
  // 候选列表以 `base` 参数随链接下发（与 dsh-mobile:// 形态同名字段、逗号分隔）。
  const pairLink = (base, scheme, token, candidates = []) =>
    scheme + "://" + base + "/pair?token=" + encodeURIComponent(token) +
    (candidates.length ? "&base=" + encodeURIComponent(candidates.join(",")) : "");

  /** 铸造一次性配对链接：mint → 写 link/hint；失败写 hint。 */
  const mintFor = async (base, scheme, setLink, setHint, candidates = []) => {
    try {
      const r = await hostCall("token.mint");
      const link = pairLink(base, scheme, r.token, candidates);
      setLink(link);
      setHint({
        text: t("10 分钟有效 · 一次性 · 扫码/打开即配对"),
        color: "#2fbf71",
      });
    } catch (e) {
      setHint({ text: t("铸造失败：{message}", { message: e.message }), color: "#e5484d" });
    }
  };

  return (
    <div
      data-remote-access-panel="1"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        maxWidth: 640,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t("远程访问")}</div>
      <div style={{ color: cssVars.text2, fontSize: 13 }}>
        {t("三个通道独立维护配对二维码：扫码/打开链接即可配对（一次性令牌 + 设备身份）。此页面供手机/其它设备连接本机。")}
      </div>

      {/* 1. 局域网 */}
      <ChannelCard
        label={t("局域网")}
        desc={t("手机连同一 WiFi，扫此码直连（仅局域网可达）。")}
        cssVars={cssVars}
        link={lanLink}
        qrSrc={lanQr}
        hint={lanHint}
        actions={
          <>
            <PanelButton
              text={t("铸造局域网令牌")}
              cssVars={cssVars}
              onClick={async () => {
                if (!lanBaseRef.current) await refreshLanBase();
                if (lanBaseRef.current) {
                  await mintFor(
                    lanBaseRef.current.base,
                    lanBaseRef.current.scheme,
                    setLanLink,
                    setLanHint,
                    lanBaseRef.current.candidates,
                  );
                } else {
                  setLanHint({ text: t("无法确定局域网地址"), color: "#e5484d" });
                }
              }}
            />
            <PanelButton
              text={t("复制链接")}
              ghost
              cssVars={cssVars}
              onClick={async ({ flash }) => {
                if (!lanLink) return;
                try {
                  await navigator.clipboard?.writeText(lanLink);
                } catch {
                  /* noop */
                }
                flash("ok", t("已复制 ✓"));
              }}
            />
          </>
        }
      />

      {/* 2. 第三方隧道（cpolar 等）*/}
      <ChannelCard
        label={t("第三方隧道（cpolar 等）")}
        desc={t("隧道需指向改写代理端口 127.0.0.1:{port}；粘贴地址校验可达后，用此地址生成自己的配对二维码。", { port: lanePort })}
        cssVars={cssVars}
        link={tunLink}
        qrSrc={tunQr}
        hint={tunHint}
        beforeLink={
          <>
            <input
              type="text"
              placeholder="https://xxxx.cpolar.cn"
              value={tunInputValue}
              onChange={(e) => setTunInputValue(e.target.value)}
              style={{
                background: "transparent",
                border: "1px solid var(--dsw-alias-border-l2, #ffffff1f)",
                color: "inherit",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 13,
              }}
            />
            {tunResult.text && (
              <div style={{ color: tunResult.color, fontSize: 12 }}>
                {tunResult.text}
              </div>
            )}
          </>
        }
        actions={
          <>
            <PanelButton
              text={t("校验并保存")}
              ghost
              cssVars={cssVars}
              onClick={async () => {
                setTunResult({ text: t("校验中…"), color: cssVars.text2 });
                const url = tunInputValue.trim();
                if (!url) {
                  setTunResult({ text: t("请输入隧道地址"), color: "#e5484d" });
                  return;
                }
                try {
                  const r = await hostCall("tunnel.probe", { url });
                  if (r.ok) {
                    await hostCall("tunnel.save", { url });
                    setTunSavedUrl(url);
                    setTunResult({
                      text: t("✓ 可达已保存（HTTP {status}）", { status: r.status ?? "" }),
                      color: "#2fbf71",
                    });
                    await refreshLanBase();
                  } else {
                    setTunResult({
                      text: t("✗ 不可达：{reason}", { reason: r.reason ?? "" }),
                      color: "#e5484d",
                    });
                  }
                } catch (e) {
                  setTunResult({
                    text: t("校验失败：{message}", { message: e.message }),
                    color: "#e5484d",
                  });
                }
              }}
            />
            <PanelButton
              text={t("铸造隧道令牌")}
              cssVars={cssVars}
              onClick={async () => {
                if (!tunSavedUrl) await refreshLanBase();
                if (tunSavedUrl) {
                  const u = new URL(tunSavedUrl);
                  await mintFor(
                    u.host,
                    u.protocol === "https:" ? "https" : "http",
                    setTunLink,
                    setTunHint,
                  );
                } else {
                  setTunHint({
                    text: t("请先校验并保存隧道地址"),
                    color: "#e5484d",
                  });
                }
              }}
            />
            <PanelButton
              text={t("复制链接")}
              ghost
              cssVars={cssVars}
              onClick={async ({ flash }) => {
                if (!tunLink) return;
                try {
                  await navigator.clipboard?.writeText(tunLink);
                } catch {
                  /* noop */
                }
                flash("ok", t("已复制 ✓"));
              }}
            />
          </>
        }
      />

      {/* 3. cloudflared 公网隧道 */}
      <ChannelCard
        label={t("cloudflared 公网隧道")}
        desc={t("PATH 有 cloudflared 就直接用；否则 ~/.dsh/bin 缓存命中复用；都没有就一键从 GitHub/ghproxy 等多镜像下载到缓存。")}
        cssVars={cssVars}
        link={cfLink}
        qrSrc={cfQr}
        hint={cfHint}
        beforeLink={
          <>
            <input
              type="text"
              placeholder={t("cloudflared 完整路径（留空 = 一键启动）")}
              value={cfInputValue}
              onChange={(e) => setCfInputValue(e.target.value)}
              style={{
                background: "transparent",
                border: "1px solid var(--dsw-alias-border-l2, #ffffff1f)",
                color: "inherit",
                borderRadius: 8,
                padding: "7px 10px",
                fontSize: 13,
              }}
            />
            <div style={{ color: cfStatus.color, fontSize: 12 }}>
              {cfStatus.text}
            </div>
          </>
        }
        actions={
          <>
            <PanelButton
              text={t("一键启动（无依赖）")}
              cssVars={cssVars}
              onClick={async () => {
                // 不读 input.value —— 一键模式固定 auto
                setCfInFlight({
                  text: t("解析中 · 检查 PATH 与本地缓存…"),
                  color: "#4d6bfe",
                });
                setCfStatusError(null);
                try {
                  const r = await hostCall("cloudflared.apply", { bin: "" });
                  setCfState({
                    bin: r.bin ?? "",
                    url: r.url ?? null,
                    running: !!r.running,
                    reason: r.running ? null : (r.reason ?? null),
                    message: r.message,
                    phase: r.phase ?? "resolving",
                    detail: "",
                  });
                  setCfStatusError(null);
                  setCfInFlight(null);
                } catch (e) {
                  setCfInFlight(null);
                  setCfStatusError(t("一键启动失败：{message}", { message: e.message }));
                }
              }}
            />
            <PanelButton
              text={t("停止")}
              ghost
              cssVars={cssVars}
              onClick={async () => {
                try {
                  await hostCall("cloudflared.stop");
                  // 立即清空所有"运行中"相关字段，避免下一次 2s 轮询前 UI 还显示旧 url/phase
                  setCfState((prev) => ({
                    bin: prev.bin,
                    url: null,
                    running: false,
                    reason: null,
                    phase: "idle",
                    detail: t("已停止"),
                    message: "",
                  }));
                  setCfStatusError(null);
                } catch (e) {
                  setCfStatusError(t("停止失败：{message}", { message: e.message }));
                }
              }}
            />
            <PanelButton
              text={t("应用并启动")}
              cssVars={cssVars}
              onClick={async () => {
                setCfInFlight({ text: t("应用中…"), color: cssVars.text2 });
                setCfStatusError(null);
                try {
                  const r = await hostCall("cloudflared.apply", {
                    bin: cfInputValue.trim(),
                  });
                  setCfState({
                    bin: r.bin ?? "",
                    url: r.url ?? null,
                    running: !!r.running,
                    reason: r.running ? null : (r.reason ?? null),
                    message: r.message,
                    phase: r.phase ?? "resolving",
                    detail: "",
                  });
                  setCfStatusError(null);
                  setCfInFlight(null);
                } catch (e) {
                  setCfInFlight(null);
                  setCfStatusError(t("应用失败：{message}", { message: e.message }));
                }
              }}
            />
            <PanelButton
              text={t("铸造隧道令牌")}
              cssVars={cssVars}
              onClick={async () => {
                if (!cfState.url) {
                  setCfHint({
                    text: t("隧道未运行或无地址，请先启动 cloudflared"),
                    color: "#e5484d",
                  });
                  return;
                }
                await mintFor(
                  cfState.url.replace(/^https?:\/\//, ""),
                  cfState.url.startsWith("https") ? "https" : "http",
                  setCfLink,
                  setCfHint,
                );
              }}
            />
            <PanelButton
              text={t("复制链接")}
              ghost
              cssVars={cssVars}
              onClick={async ({ flash }) => {
                if (!cfLink) return;
                try {
                  await navigator.clipboard?.writeText(cfLink);
                } catch {
                  /* noop */
                }
                flash("ok", t("已复制 ✓"));
              }}
            />
          </>
        }
      />

    </div>
  );
}

/** 远程设备管理：顶部双 tab，设备分享复用原远程访问面板。 */
function RemoteDevicesSection({ hostCall }) {
  const [tab, setTab] = useState("share");
  const tabStyle = (active) => ({
    font: "inherit",
    fontSize: 13,
    padding: "7px 14px",
    border: "none",
    borderBottom: active ? "2px solid var(--dsw-alias-label-primary, #e7eaf0)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--dsw-alias-label-primary, #e7eaf0)" : "var(--dsw-alias-label-secondary, #9aa4b2)",
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--dsw-alias-border-secondary, #3a3a3f)" }}>
        <button type="button" style={tabStyle(tab === "share")} onClick={() => setTab("share")}>设备分享</button>
        <button type="button" style={tabStyle(tab === "manage")} onClick={() => setTab("manage")}>设备管理</button>
      </div>
      {tab === "share" ? <RemoteAccessPanel /> : <RemoteDeviceManager hostCall={hostCall} />}
    </div>
  );
}
