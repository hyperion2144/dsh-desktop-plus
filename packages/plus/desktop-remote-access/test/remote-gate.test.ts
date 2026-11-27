// 远程会话 / 远程工作区上，一次官方 RPC 该怎么处理（spec #103）。
// 交互代理（#151）落地后：远程会话上的操作转发到 A 执行；只读镜像模式（写开关关闭）下一律拒绝。
// 裁决是纯函数：只看端点、会话是不是远程的、工作区是不是远程的；不碰网络，也不碰界面。
import { describe, expect, it } from 'vitest'
import { decideRemoteCall } from '../client/remote-gate.js'

const REMOTE_SESSION = 'remote-0123456789abcdef-s1'
const known = {
  sessions: new Set([REMOTE_SESSION]),
  workspaces: new Set(['ws-9']),
  workspacePaths: new Set(['/Users/a/proj']),
}
const READONLY = { writesEnabled: false }

describe('远程会话上的调用', () => {
  it('发消息、停止、切模型、命令、任务、审批与提问都转发到 A 执行：不落到本地，本机不跑 agent', () => {
    // 落到本地比转发更糟：会在镜像会话上起一个本机 agent 真的跑起来，还把事件写进镜像。
    for (const endpoint of [
      'session/prompt', 'session/cancel', 'session/selectModel', 'session/rename', 'session/fork', 'session/updateQueue',
      'commands/execute', 'commands/list', 'fileUploads/upload', 'job/kill', 'subagents/prompt',
      'actionCards/act', 'userQuestions/answer',
    ]) {
      expect(decideRemoteCall(endpoint, { request: { sessionId: REMOTE_SESSION } }, known), endpoint).toMatchObject({ kind: 'forward' })
    }
    expect(decideRemoteCall('actionCards/act', { agentId: REMOTE_SESSION, cardId: 'c1', verb: 'approve' }, known))
      .toEqual({ kind: 'forward', namespace: 'actionCards', method: 'act' })
    expect(decideRemoteCall('userQuestions/answer', { agentId: REMOTE_SESSION, callId: 'k1', answer: { answers: [] } }, known))
      .toEqual({ kind: 'forward', namespace: 'userQuestions', method: 'answer' })
  })

  it('只读镜像模式下这些调用一律拒绝：不转发，也不落到本地执行', () => {
    for (const endpoint of ['session/prompt', 'session/cancel', 'session/selectModel', 'actionCards/act', 'userQuestions/answer', 'job/kill']) {
      expect(decideRemoteCall(endpoint, { request: { sessionId: REMOTE_SESSION } }, known, READONLY), endpoint).toMatchObject({ kind: 'refuse' })
    }
  })

  it('只读模式下用户主动发起的调用被拒时，说明是哪一步、该去哪台机器做', () => {
    expect(decideRemoteCall('session/prompt', { request: { sessionId: REMOTE_SESSION } }, known, READONLY)).toEqual({
      kind: 'refuse', message: '远程会话是只读镜像，发送消息请在设备本机上操作', notify: true,
    })
  })

  it('后台类调用被拒时不弹提示，不刷屏', () => {
    expect(decideRemoteCall('commands/list', { request: { sessionId: REMOTE_SESSION } }, known, READONLY)).toMatchObject({ kind: 'refuse', notify: false })
  })

  it('流式通道接通后，终端在远程会话上照常转发到 A', () => {
    expect(decideRemoteCall('terminal/create', { request: { sessionId: REMOTE_SESSION } }, known)).toEqual({ kind: 'forward', namespace: 'terminal', method: 'create' })
  })

  it('流式通道关闭时，终端在远程会话上明确拒绝：不在 A 上留下一个本机接不上的终端', () => {
    const verdict = decideRemoteCall('terminal/create', { request: { sessionId: REMOTE_SESSION } }, known, { streamsEnabled: false })
    expect(verdict.kind).toBe('refuse')
    expect(verdict.notify).toBe(true)
    expect(verdict.message).not.toMatch(/terminal\/create|remote-failed/)
    expect(decideRemoteCall('terminal/list', { request: { sessionId: REMOTE_SESSION } }, known, { streamsEnabled: false })).toMatchObject({ kind: 'refuse', notify: false })
  })

  it('只读调用转发到远端：渲染镜像本身就需要它们', () => {
    expect(decideRemoteCall('workspaceFiles/read', { workspaceFileScopeId: REMOTE_SESSION }, known)).toEqual({ kind: 'forward', namespace: 'workspaceFiles', method: 'read' })
    expect(decideRemoteCall('session/attachment', { request: { sessionId: REMOTE_SESSION } }, known)).toEqual({ kind: 'forward', namespace: 'session', method: 'attachment' })
  })

  it('会话标识藏在任意字段里也能认出来', () => {
    expect(decideRemoteCall('session/cancel', { request: { address: { kind: 'session', sessionId: REMOTE_SESSION } } }, known)).toMatchObject({ kind: 'forward' })
  })

  it('本机会话原样放行', () => {
    expect(decideRemoteCall('session/prompt', { request: { sessionId: 'local-1' } }, known)).toEqual({ kind: 'pass' })
    expect(decideRemoteCall('terminal/create', { request: { sessionId: 'local-1' } }, known)).toEqual({ kind: 'pass' })
  })

  it('兜底：清单之外、只要指向远程会话的调用也转发到 A——落到本机会让本机为镜像恢复一个 agent 并替它写事件', () => {
    for (const endpoint of ['goals/set', 'compaction/run', 'sessionToolResults/list', 'planMode/enable', 'userQuestions/attachWait']) {
      expect(decideRemoteCall(endpoint, { agentId: REMOTE_SESSION, payload: { note: 'x' } }, known), endpoint).toEqual({ kind: 'forward', namespace: endpoint.slice(0, endpoint.indexOf('/')), method: endpoint.slice(endpoint.indexOf('/') + 1) })
    }
  })

  it('读本机镜像的视图端点留在本机：事件流、状态、投影、分页都来自本机镜像，不发往 A', () => {
    for (const endpoint of ['session/state', 'session/page', 'session/events', 'session/observeEvent', 'session/observeProjections', 'session/observeState', 'session/follow', 'session/projections', 'session/wait']) {
      expect(decideRemoteCall(endpoint, { request: { sessionId: REMOTE_SESSION } }, known), endpoint).toEqual({ kind: 'pass' })
    }
  })

  it('清单之外的调用只在本机会话上原样放行；只读镜像模式下则拒绝', () => {
    expect(decideRemoteCall('goals/set', { agentId: 'local-1' }, known)).toEqual({ kind: 'pass' })
    expect(decideRemoteCall('goals/set', { agentId: REMOTE_SESSION }, known, READONLY)).toMatchObject({ kind: 'refuse' })
  })

  it('远程会话集合尚未就绪时按本机处理，不误拦', () => {
    expect(decideRemoteCall('session/prompt', { request: { sessionId: 'local-1' } }, {})).toEqual({ kind: 'pass' })
  })
})

describe('远程工作区上的调用', () => {
  it('新建会话转发到远端创建：落到本地会造出 cwd 指向远端目录的本地会话', () => {
    expect(decideRemoteCall('session/create', { request: { cwd: '/Users/a/proj' } }, known)).toEqual({ kind: 'forward-create' })
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-9' } }, known).kind).toBe('forward-create')
  })

  it('只读模式下新建会话被拒绝，并说明该去哪台机器做', () => {
    expect(decideRemoteCall('session/create', { request: { cwd: '/Users/a/proj' } }, known, READONLY)).toEqual({
      kind: 'refuse', message: '远程工作区是只读的：新建会话请在设备本机上操作', notify: true,
    })
  })

  it('本机目录上新建会话照常放行', () => {
    expect(decideRemoteCall('session/create', { request: { cwd: '/Users/me/proj' } }, known)).toEqual({ kind: 'pass' })
  })

  it('本机也有这个目录的工作区（与远程工作区并成同一个）里新建会话走本机：页面启动时恢复当前会话就是这种，发给对端会让侧栏起不来', () => {
    const shared = { sessions: new Set(['remote-h-session-1']), workspaces: new Set(['ws-9', 'ws-shared']), workspacePaths: new Set(['/Users/a/proj']), remoteOnlyWorkspaces: new Set(['ws-9']) }
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-shared' } }, shared)).toEqual({ kind: 'pass' })
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-9' } }, shared).kind).toBe('forward-create')
    // 工作区类操作（改名、归档、删除）照旧只动本机。
    expect(decideRemoteCall('workspace/rename', { request: { workspaceId: 'ws-shared' } }, shared).kind).toBe('local')
  })

  it('删除只删本机侧的条目与登记，绝不打到远端', () => {
    expect(decideRemoteCall('workspace/delete', { request: { workspaceId: 'ws-9' } }, known)).toEqual({ kind: 'local-remove' })
  })

  it('改名、归档、置顶是本机的视图状态，走本地', () => {
    for (const endpoint of ['workspace/rename', 'workspace/archiveSession', 'workspace/unarchiveSession', 'workspace/pinSession', 'workspace/unpinSession']) {
      expect(decideRemoteCall(endpoint, { workspaceId: 'ws-9' }, known), endpoint).toEqual({ kind: 'local' })
    }
  })

  it('本机工作区原样放行', () => {
    expect(decideRemoteCall('workspace/delete', { request: { workspaceId: 'ws-local' } }, known)).toEqual({ kind: 'pass' })
  })

  it('远程工作区下的「新会话」：设备在线就在远端建；离线时入口禁用并给出可读原因（与三态同源），本机工作区不受影响', () => {
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-9' } }, known)).toEqual({ kind: 'forward-create' })
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-9' } }, known, { remoteOffline: true, remoteOfflineReason: '连不上设备，可重试' }))
      .toEqual({ kind: 'refuse', message: '连不上设备，可重试', notify: true })
    expect(decideRemoteCall('session/create', { request: { cwd: '/Users/a/proj' } }, known, { remoteOffline: true })).toMatchObject({ kind: 'refuse' })
    expect(decideRemoteCall('session/create', { request: { workspaceId: 'ws-local' } }, known, { remoteOffline: true })).toEqual({ kind: 'pass' })
  })
})
