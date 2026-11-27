//! 远程会话 / 远程工作区上，一次官方 RPC 该怎么处理（spec #103）。
//!
//! 远程会话是镜像：A 执行，B 只是把操作转发过去。交互代理（#151）落地后，发消息、停止、切模型、
//! 命令、审批、提问都**接管并转发**到 A。写开关关闭（只读镜像模式）时同样接管，只是裁决从「转发」
//! 变成「拒绝」——一旦不接管，官方调用就会落到本机宿主：在镜像会话上起一个本机 agent 真的跑起来，
//! 还把事件写进镜像，比转发到远端更糟。
//!
//! 这里只做判定，不碰网络，也不碰界面。哪些远端调用放行与宿主共用 remote-policy，两边不会各说各话。

import { REMOTE_WRITES_ENABLED, decideRemoteInvoke, remoteReadonlyRefusal } from "../src/host/remote-policy.ts";

/** 远程会话上由插件接管的端点：参数里带会话标识、且只对该会话生效的调用。 */
export const REMOTE_SESSION_ENDPOINTS = new Set([
  // 发消息 / 停止 / 切模型：这是「请求到底发到哪」的关键。少了它们，镜像会话上
  // 发出的每一条消息都会落到本机，界面上却显示成功。
  "session/prompt", "session/cancel", "session/selectModel",
  "session/rename", "session/fork", "session/updateQueue", "session/attachment",
  "session/openWorkspacePath", "session/workspacePathApplications",
  "commands/execute", "commands/list",
  // 审批、提问、计划评审在界面上是同一张动作卡：答复走 actionCards/act；限时提问的文本回答走 userQuestions/answer。
  // 都带 agentId（即会话标识），必须在 A 上执行——决定会作为事件写进 A 的日志，镜像同步到之后各端卡片一起收起。
  "actionCards/act", "userQuestions/answer",
  "fileUploads/upload", "fileReferences/list", "permissionPresets/catalog",
  // 后台任务：杀掉远端任务必须发到 A 机。
  "job/kill",
  // 子代理：提示与打断都在 A 机上执行。
  "subagents/prompt", "subagents/interruptByParent",
  // 右侧边栏的工作区文件：读的是 A 机的磁盘。
  "workspaceFiles/list", "workspaceFiles/read", "workspaceFiles/stat", "workspaceFiles/readBytes",
  "workspaceFiles/search",
  // 终端：pty 必须开在 A 机上。
  "terminal/create", "terminal/close", "terminal/rename", "terminal/list",
  "terminal/shells", "terminal/environment",
]);

/** 远程工作区上由插件接管的端点：参数里带工作区标识的调用。 */
export const REMOTE_WORKSPACE_ENDPOINTS = new Set([
  "workspace/rename", "workspace/delete", "workspace/archiveSession", "workspace/unarchiveSession",
  "workspace/pinSession", "workspace/unpinSession",
]);

/** 用户主动发起的调用：被拒或失败时弹提示。后台轮询类不弹，免得刷屏。 */
const USER_INITIATED = new Set([
  "session/prompt", "session/cancel", "session/selectModel", "session/rename", "session/fork", "session/create",
  "commands/execute", "fileUploads/upload", "job/kill", "subagents/prompt",
  "actionCards/act", "userQuestions/answer", "terminal/create",
]);

/** 会话菜单里的「分享到远程」：旧的分享 / 流转入口已被「接管 / 回推」取代，多端订阅（#152）落地时换成新菜单。 */
export const SESSION_SHARE_MENU_ENABLED = false;

/**
 * 流式通道（终端、任务、文件变更、限时提问的倒计时）：远程会话的流经宿主的流式路由逐帧翻译会话 id 后接到 A 机的
 * 流载体（stream-frame-relay.ts）。只接管**远程会话**的流；本机会话的流回落官方 mux，不受影响。
 */
export const REMOTE_STREAMS_ENABLED = true;

const CREATE_REFUSAL = "远程工作区是只读的：新建会话请在设备本机上操作";

/**
 * 读「本机镜像」的视图端点：事件流、状态、投影、分页。它们读的是本机镜像会话本身，必须留在本机。
 * 除这些之外，凡是指向远程会话的调用都转发到 A——落到本机，宿主会按会话 id 为镜像恢复一个本机 agent
 * （官方网关对带 agent 参数的调用都这么做），恢复时还会往镜像里补写中断收尾，和 A 回流的事件撞车。
 */
export const LOCAL_VIEW_ENDPOINTS = new Set([
  "session/state", "session/wait", "session/page", "session/events", "session/projections",
  "session/observeEvent", "session/observeProjections", "session/observeState", "session/follow",
]);

/** 远程会话上依赖流式通道的终端端点。 */
const TERMINAL_ENDPOINTS = new Set([
  "terminal/create", "terminal/close", "terminal/rename", "terminal/list",
  "terminal/shells", "terminal/environment",
]);

/** 流式通道接通前在远程会话上打开终端时的说明：说清是哪一步、为什么现在不行，不露端点名与错误码。 */
const TERMINAL_REFUSAL = "远程会话的终端要等流式通道接通后才能用，请先在设备本机上打开";

/** 官方一元调用的业务参数所在的 `request`。 */
function requestOf(args) {
  const request = args && args.request;
  return request !== null && typeof request === "object" ? request : {};
}

/** 显式写在参数里的会话标识（各命名空间字段名不同，逐个看）。 */
function explicitSessionIdOf(args) {
  const request = requestOf(args);
  const address = request && typeof request.address === "object" && request.address !== null ? request.address : {};
  const candidates = [
    args && args.agentId, args && args.sessionId, args && args.workspaceFileScopeId,
    args && args.parentSessionId, args && args.childSessionId, request.sessionId,
    request.parentSessionId, address.sessionId,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/**
 * 参数指向的远程会话。
 * @param args 官方调用的参数。
 * @param sessions 已知的远程会话集合。
 * @returns 命中的远程会话标识；不是远程会话（或集合尚未就绪）返回 null。
 */
export function remoteSessionIdIn(args, sessions) {
  if (!(sessions instanceof Set) || sessions.size === 0) return null;
  const explicit = explicitSessionIdOf(args);
  if (explicit !== "" && sessions.has(explicit)) return explicit;
  // 参数形状各命名空间不一致：显式字段取不到时，在整个参数里找已知的远程会话 id。
  let text = "";
  try { text = JSON.stringify(args); } catch { text = ""; }
  if (text === "") return null;
  for (const id of sessions) {
    if (text.includes(id)) return id;
  }
  return null;
}

/**
 * 参数里的工作区标识（顶层或 `request` 内）。
 * @param args 官方调用的参数。
 * @returns 工作区标识；参数里没有时为空串。
 */
export function workspaceIdOf(args) {
  const request = requestOf(args);
  if (typeof (args && args.workspaceId) === "string" && args.workspaceId !== "") return args.workspaceId;
  if (typeof request.workspaceId === "string" && request.workspaceId !== "") return request.workspaceId;
  return "";
}

/**
 * 判定一次官方 RPC 在远程会话 / 远程工作区上该怎么处理。
 * @param endpoint 形如 `session/prompt` 的端点名。
 * @param args 官方调用的参数。
 * @param known 已知的远程会话、远程工作区（按官方 id）与远程工作区目录。
 * @returns `pass`（与本插件无关，原样走官方）｜`forward`（转发到远端）｜
 *          `forward-create`（在远端新建会话）｜`local`（走本机）｜`local-remove`（走本机并摘掉登记）｜
 *          `refuse`（拒绝，带可读原因）。
 */
export function decideRemoteCall(endpoint, args, known, flags = {}) {
  const writesEnabled = typeof flags.writesEnabled === "boolean" ? flags.writesEnabled : REMOTE_WRITES_ENABLED;
  const streamsEnabled = typeof flags.streamsEnabled === "boolean" ? flags.streamsEnabled : REMOTE_STREAMS_ENABLED;
  const sessions = known && known.sessions;
  const workspaces = known && known.workspaces;
  const workspacePaths = known && known.workspacePaths;
  const slash = endpoint.indexOf("/");
  const namespace = endpoint.slice(0, slash);
  const method = endpoint.slice(slash + 1);

  if (endpoint === "session/create") {
    // 官方「新会话」可能按目录建，也可能按工作区 id 建，两种都要认。
    const request = requestOf(args);
    const cwd = typeof request.cwd === "string" ? request.cwd : "";
    const workspaceId = workspaceIdOf(args);
    // 本机也有这个目录的工作区（同路径的本地与远程工作区在官方里并成同一个）不算：在里面新建会话默认建在本机，
    // 否则页面启动时「恢复当前会话」的那次新建会被发到对端，对端离线时整个侧栏都起不来（实测）。
    const remoteOnly = known && known.remoteOnlyWorkspaces;
    const byId = remoteOnly instanceof Set ? (workspaceId !== "" && remoteOnly.has(workspaceId)) : (workspaces instanceof Set && workspaceId !== "" && workspaces.has(workspaceId));
    const remote = byId || (workspacePaths instanceof Set && cwd !== "" && workspacePaths.has(cwd));
    if (!remote) return { kind: "pass" };
    // 设备离线（或版本不符）时入口禁用并说明原因：原因来自徽标的三态探测，与设备管理里的文案同源（#153）。
    if (flags.remoteOffline === true) {
      return { kind: "refuse", message: flags.remoteOfflineReason || "连不上设备，可重试", notify: true };
    }
    if (writesEnabled) return { kind: "forward-create" };
    return { kind: "refuse", message: CREATE_REFUSAL, notify: true };
  }

  if (REMOTE_SESSION_ENDPOINTS.has(endpoint)) {
    if (remoteSessionIdIn(args, sessions) === null) return { kind: "pass" };
    // 终端要靠流式通道把 A 的 pty 接到界面上；通道没接通就转发创建，只会在 A 上留下一个本机接不上的终端。
    if (TERMINAL_ENDPOINTS.has(endpoint) && !streamsEnabled) {
      return { kind: "refuse", message: TERMINAL_REFUSAL, notify: USER_INITIATED.has(endpoint) };
    }
    if (decideRemoteInvoke(namespace, method, writesEnabled) === "allow") return { kind: "forward", namespace, method };
    return { kind: "refuse", message: remoteReadonlyRefusal(endpoint), notify: USER_INITIATED.has(endpoint) };
  }

  if (REMOTE_WORKSPACE_ENDPOINTS.has(endpoint)) {
    const workspaceId = workspaceIdOf(args);
    if (!(workspaces instanceof Set) || workspaceId === "" || !workspaces.has(workspaceId)) return { kind: "pass" };
    // 改名、归档、置顶是本机的视图状态；删除删的也是本机侧的条目——绝不打到远端，A 上的真实目录不受影响。
    // 与写开关无关：即使在远端创建（#153）已放行，这些仍然只动本机。
    return { kind: endpoint === "workspace/delete" ? "local-remove" : "local" };
  }

  // 兜底：清单之外、只要指向远程会话的调用，也按同一套规则转发到 A（只读镜像模式下拒绝）。
  if (remoteSessionIdIn(args, sessions) !== null && !LOCAL_VIEW_ENDPOINTS.has(endpoint)) {
    if (decideRemoteInvoke(namespace, method, writesEnabled) === "allow") return { kind: "forward", namespace, method };
    return { kind: "refuse", message: remoteReadonlyRefusal(endpoint), notify: USER_INITIATED.has(endpoint) };
  }

  return { kind: "pass" };
}
