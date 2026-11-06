//! 远程调用的策略（spec #103）。
//!
//! 远程会话是镜像：A 执行，B 只是把操作转发过去。交互代理（#151）落地后写开关已打开——发消息、停止、
//! 切模型、命令、审批、提问都放行，一律转发到 A，绝不落到本地执行（那会往镜像里写事件、和远端回流的事件撞车）。
//! 宿主的 remoteSession.invoke 与客户端的拦截层共用这一份裁决，两边不会各说各话。
//! 旧的「导入 / 推送 / 流转」入口已被「接管（#154）/ 回推（#155）」取代，各有独立开关，对应票落地前不开放。
//! 只读镜像模式下，放行项必须逐条登记，清单之外一律拒绝。

/** 是否放行会改变远端状态的调用。交互代理（#151）与在远端创建（#153）已落地，打开。 */
export const REMOTE_WRITES_ENABLED = true

/** 旧的「会话流转」（#109）：已被「接管（#154）」取代，对应票落地前不开放。与写开关无关。 */
export const REMOTE_HANDOFF_ENABLED = false

/** 旧的「把本机会话推送到对端」：已被「回推（#155）」取代，对应票落地前不开放。与写开关无关。 */
export const REMOTE_PUSH_ENABLED = false

/** 对端经数据面往本机会话存储写入（旧推送流程用的导入路由）：已被「回推（#155）」取代，对应票落地前不开放。 */
export const REMOTE_IMPORT_ENABLED = false

/** 只读镜像模式（写开关关闭）下仍然放行的只读调用：渲染镜像会话本身就需要它们，缺了会话里的图片、文件面板就是空的。 */
const REMOTE_READ_INVOKES: ReadonlySet<string> = new Set([
  'session/attachment',
  'fileReferences/list',
  'permissionPresets/catalog',
  'workspaceFiles/list',
  'workspaceFiles/read',
  'workspaceFiles/stat',
  'workspaceFiles/search',
  'workspaceFiles/readBytes',
])

/** 只读镜像模式下拒绝时，据此措辞。只列明确点名的那几项，其余用通用说法。 */
const REFUSAL_LABELS: Readonly<Record<string, string>> = {
  'session/prompt': '发送消息',
  'session/cancel': '停止',
  'session/selectModel': '切换模型',
  'session/rename': '重命名会话',
  'session/fork': '分叉会话',
  'session/updateQueue': '调整消息队列',
  'commands/execute': '执行命令',
  'session/create': '新建会话',
  'session/import': '写入会话',
  'workspace/create': '登记工作区',
  'session/openWorkspacePath': '打开路径',
  'fileUploads/upload': '上传附件',
  'job/kill': '终止后台任务',
  'terminal/create': '打开终端',
  'terminal/attach': '打开终端',
  'workspace/archiveSession': '归档会话',
}

/** 一次远端调用的裁决。 */
export type RemoteInvokeVerdict = 'allow' | 'refuse'

/**
 * 判定一次远端调用在当前阶段是否放行。
 * @param namespace 远端命名空间，如 `session`。
 * @param method 远端方法，如 `prompt`。
 * @param writesEnabled 是否放行写类调用；缺省取 `REMOTE_WRITES_ENABLED`。
 * @returns `allow` 或 `refuse`。
 */
export function decideRemoteInvoke(namespace: string, method: string, writesEnabled: boolean = REMOTE_WRITES_ENABLED): RemoteInvokeVerdict {
  if (writesEnabled) return 'allow'
  return REMOTE_READ_INVOKES.has(`${namespace}/${method}`) ? 'allow' : 'refuse'
}

/**
 * P0 拒绝远端写操作时给用户看的说明。
 * @param endpoint 形如 `session/prompt` 的端点名。
 * @returns 一句话：说清是哪一步、该去哪台机器做；不含端点名与错误码。
 */
export function remoteReadonlyRefusal(endpoint: string): string {
  const label = REFUSAL_LABELS[endpoint]
  return label === undefined
    ? '远程会话是只读镜像，这一步请在设备本机上操作'
    : `远程会话是只读镜像，${label}请在设备本机上操作`
}
