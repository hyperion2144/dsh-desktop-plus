// 远程调用策略（spec #103）：交互代理（#151）落地后，远程会话上的操作转发到 A 执行。
// 宿主的 remoteSession.invoke 与客户端的拦截层共用这一份裁决，两边不会各说各话。
import { describe, expect, it } from 'vitest'
import { REMOTE_WRITES_ENABLED, decideRemoteInvoke, remoteReadonlyRefusal } from '../src/host/remote-policy.js'

const READ_CALLS = [
  'session/attachment', 'fileReferences/list', 'permissionPresets/catalog',
  'workspaceFiles/list', 'workspaceFiles/read', 'workspaceFiles/stat', 'workspaceFiles/readBytes', 'workspaceFiles/search',
]
const WRITE_CALLS = [
  'session/prompt', 'session/cancel', 'session/selectModel', 'session/rename', 'session/fork', 'session/updateQueue',
  'commands/execute', 'fileUploads/upload', 'job/kill', 'subagents/prompt', 'subagents/interruptByParent',
  'actionCards/act', 'userQuestions/answer', 'terminal/create', 'workspace/archiveSession',
]

function split(call: string): [namespace: string, method: string] {
  const slash = call.indexOf('/')
  return [call.slice(0, slash), call.slice(slash + 1)]
}

describe('decideRemoteInvoke', () => {
  it('写开关已打开（#151 交互代理）：会改变远端状态的调用一律放行，由 A 执行', () => {
    expect(REMOTE_WRITES_ENABLED).toBe(true)
    for (const call of [...READ_CALLS, ...WRITE_CALLS]) expect(decideRemoteInvoke(...split(call)), call).toBe('allow')
  })

  it('关掉写开关（只读镜像模式）时只放行渲染所需的只读调用，清单之外一律拒绝', () => {
    for (const call of READ_CALLS) expect(decideRemoteInvoke(...split(call), false), call).toBe('allow')
    for (const call of WRITE_CALLS) expect(decideRemoteInvoke(...split(call), false), call).toBe('refuse')
    expect(decideRemoteInvoke('workspace', 'delete', false)).toBe('refuse')
    expect(decideRemoteInvoke('session', '', false)).toBe('refuse')
  })
})

describe('remoteReadonlyRefusal', () => {
  it('给出用户看得懂的说明：说清是哪一步、该去哪台机器做', () => {
    expect(remoteReadonlyRefusal('session/prompt')).toBe('远程会话是只读镜像，发送消息请在设备本机上操作')
    expect(remoteReadonlyRefusal('session/cancel')).toContain('停止')
    expect(remoteReadonlyRefusal('session/create')).toContain('新建会话')
  })

  it('清单外的操作用通用说法，不把端点名或错误码露给用户', () => {
    const message = remoteReadonlyRefusal('terminal/attach')
    expect(message).toContain('只读镜像')
    expect(message).not.toMatch(/remote-failed|fetch failed|terminal\/attach/)
  })
})
