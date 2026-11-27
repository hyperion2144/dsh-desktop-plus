// 在远端新建会话时的目标解析（#153）：界面的「新会话」可能按工作区 id 发，也可能按目录发，
// 主机有时带、有时不带。这里把它们归一到「哪台主机、哪个目录」，或给出稳定的错误码。
import { describe, expect, it } from 'vitest'
import { resolveRemoteCreateTarget } from '../src/host/remote-create.js'

const WORKSPACES = [
  { workspaceId: 'w-alpha', hostId: 'dev-a@http://10.0.0.1:3091', path: '/Users/a/proj' },
  { workspaceId: 'w-beta', hostId: 'dev-b@http://10.0.0.2:3091', path: '/srv/site/' },
]
const hosts = new Set(WORKSPACES.map((workspace) => workspace.hostId))
const hostExists = (hostId: string): boolean => hosts.has(hostId)

describe('resolveRemoteCreateTarget', () => {
  it('界面按工作区 id 新建（不带目录、不带主机）：按登记解析出主机与目录', () => {
    expect(resolveRemoteCreateTarget({ workspaceId: 'w-alpha' }, WORKSPACES, hostExists))
      .toEqual({ ok: true, hostId: 'dev-a@http://10.0.0.1:3091', path: '/Users/a/proj' })
  })

  it('按目录新建：忽略末尾斜杠的差异也能对上登记', () => {
    expect(resolveRemoteCreateTarget({ path: '/srv/site' }, WORKSPACES, hostExists))
      .toEqual({ ok: true, hostId: 'dev-b@http://10.0.0.2:3091', path: '/srv/site' })
  })

  it('显式带了主机：以它为准，目录仍按工作区 id 取', () => {
    expect(resolveRemoteCreateTarget({ workspaceId: 'w-alpha', hostId: 'dev-a@http://10.0.0.1:3091' }, WORKSPACES, hostExists).ok).toBe(true)
  })

  it('既没有目录也没有工作区 id：bad-path（以前这种请求会原样打到远端再报错）', () => {
    expect(resolveRemoteCreateTarget({}, WORKSPACES, hostExists)).toMatchObject({ ok: false, code: 'bad-path' })
  })

  it('目录或工作区 id 不在远程工作区登记里：not-remote-workspace（客户端据此落回本机新建）', () => {
    expect(resolveRemoteCreateTarget({ workspaceId: 'w-unknown' }, WORKSPACES, hostExists)).toMatchObject({ ok: false, code: 'not-remote-workspace' })
    expect(resolveRemoteCreateTarget({ path: '/Users/me/local' }, WORKSPACES, hostExists)).toMatchObject({ ok: false, code: 'not-remote-workspace' })
  })

  it('主机带了但配对表里没有：unknown-host', () => {
    expect(resolveRemoteCreateTarget({ path: '/Users/a/proj', hostId: 'ghost@http://10.0.0.9:3091' }, WORKSPACES, hostExists)).toMatchObject({ ok: false, code: 'unknown-host' })
  })
})
