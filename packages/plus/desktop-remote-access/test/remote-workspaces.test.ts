// 远程工作区：路径归一、登记表、registry 包装（不碰真实文件系统）。
import { describe, expect, it } from 'vitest'
import {
  RemoteWorkspaceStore,
  REMOTE_BRIDGE_UNSUPPORTED,
  createMemoryRemoteWorkspaceStorage,
  fullyQualifiedRemotePath,
  installRemoteWorkspaceBridge,
  normalizeRemotePath,
  type WorkspaceRegistryLike,
  type WorkspaceView,
} from '../src/host/remote-workspaces.js'

function fakeRegistry(): WorkspaceRegistryLike & { calls: string[], canonicalCalls: string[] } {
  const rows: WorkspaceView[] = []
  const calls: string[] = []
  const canonicalCalls: string[] = []
  const registry = {
    calls,
    canonicalCalls,
    async create(path: string, _title?: string): Promise<WorkspaceView> {
      calls.push(path)
      throw new Error('ENOENT: ' + path)
    },
    async resolveByPath(path: string): Promise<WorkspaceView | undefined> {
      calls.push('resolve:' + path)
      throw new Error('ENOENT: ' + path)
    },
    list(): WorkspaceView[] {
      return rows
    },
    async createCanonical(canonical: string, title?: string): Promise<WorkspaceView> {
      canonicalCalls.push(canonical)
      const row: WorkspaceView = { id: 'ws-' + String(rows.length), path: canonical, title: title ?? canonical }
      rows.push(row)
      return row
    },
  }
  return registry
}

describe('normalizeRemotePath', () => {
  it('去掉尾斜杠并折叠 . 段', () => {
    expect(normalizeRemotePath('/Users/a/proj/', 'darwin')).toBe('/Users/a/proj')
    expect(normalizeRemotePath('/Users/a/./proj', 'darwin')).toBe('/Users/a/proj')
  })

  it('根路径保持原样', () => {
    expect(normalizeRemotePath('/', 'darwin')).toBe('/')
  })

  it('拒绝相对路径', () => {
    expect(() => normalizeRemotePath('proj', 'darwin')).toThrow(/绝对路径/)
    expect(fullyQualifiedRemotePath('proj', 'darwin')).toBe(false)
  })
})

describe('RemoteWorkspaceStore', () => {
  it('同主机同路径只登记一次，且落盘可恢复', () => {
    const storage = createMemoryRemoteWorkspaceStorage()
    const store = new RemoteWorkspaceStore({ storage })
    const record = { hostId: 'h1', path: '/Users/a/proj', title: 'proj', addedAt: 1 }
    store.add(record)
    store.add({ ...record, addedAt: 2 })
    expect(store.list()).toHaveLength(1)

    const restored = new RemoteWorkspaceStore({ storage })
    expect(restored.list()).toEqual([record])
    expect(restored.matchPath('/Users/a/proj/', 'darwin')).toEqual(record)
  })

  it('不同主机同路径互不覆盖；matchPath 按路径唯一命中', () => {
    const store = new RemoteWorkspaceStore({})
    store.add({ hostId: 'h1', path: '/p', title: 'p', addedAt: 1 })
    store.add({ hostId: 'h2', path: '/p', title: 'p', addedAt: 1 })
    expect(store.list()).toHaveLength(2)
    expect(store.matchPath('/p', 'darwin')?.hostId).toBe('h1')
    expect(store.remove('h1', '/p')).toBe(true)
    expect(store.matchPath('/p', 'darwin')?.hostId).toBe('h2')
  })

  it('未登记的路径不命中', () => {
    const store = new RemoteWorkspaceStore({})
    expect(store.matchPath('/nope', 'darwin')).toBeUndefined()
    expect(store.matchPath('relative', 'darwin')).toBeUndefined()
  })
})

describe('installRemoteWorkspaceBridge', () => {
  it('已登记远程路径绕过 fs 校验，直达 createCanonical', async () => {
    const registry = fakeRegistry()
    const store = new RemoteWorkspaceStore({})
    store.add({ hostId: 'h1', path: '/Users/a/proj', title: 'proj', addedAt: 1 })
    const bridge = installRemoteWorkspaceBridge({ registry, store, platform: 'darwin' })
    expect(bridge.installed).toBe(true)

    const workspace = await registry.create('/Users/a/proj')
    expect(workspace.path).toBe('/Users/a/proj')
    expect(workspace.title).toBe('proj')
    expect(registry.calls).toHaveLength(0)
    expect(registry.canonicalCalls).toEqual(['/Users/a/proj'])
  })

  it('未登记路径原样转调官方实现', async () => {
    const registry = fakeRegistry()
    const store = new RemoteWorkspaceStore({})
    const bridge = installRemoteWorkspaceBridge({ registry, store, platform: 'darwin' })
    expect(bridge.installed).toBe(true)
    await expect(registry.create('/Users/a/local')).rejects.toThrow(/ENOENT/)
    expect(registry.calls).toEqual(['/Users/a/local'])
    expect(registry.canonicalCalls).toHaveLength(0)
  })

  it('resolveByPath 对远程路径直接查投影，不调官方实现', async () => {
    const registry = fakeRegistry()
    const store = new RemoteWorkspaceStore({})
    store.add({ hostId: 'h1', path: '/Users/a/proj', title: 'proj', addedAt: 1 })
    const bridge = installRemoteWorkspaceBridge({ registry, store, platform: 'darwin' })
    expect(bridge.installed).toBe(true)
    expect(await registry.resolveByPath('/Users/a/proj')).toBeUndefined()
    await registry.create('/Users/a/proj')
    expect((await registry.resolveByPath('/Users/a/proj'))?.path).toBe('/Users/a/proj')
    expect(registry.calls).toHaveLength(0)
  })

  it('registry 缺 createCanonical 时报不支持而不是静默降级', () => {
    const store = new RemoteWorkspaceStore({})
    const registry = { create: async () => { throw new Error('x') }, resolveByPath: async () => undefined, list: () => [] }
    const bridge = installRemoteWorkspaceBridge({ registry, store, platform: 'darwin' })
    expect(bridge.installed).toBe(false)
    expect(REMOTE_BRIDGE_UNSUPPORTED).toBe('remote-workspace/unsupported-registry')
  })

  it('dispose 后恢复官方方法', async () => {
    const registry = fakeRegistry()
    const store = new RemoteWorkspaceStore({})
    store.add({ hostId: 'h1', path: '/Users/a/proj', title: 'proj', addedAt: 1 })
    const bridge = installRemoteWorkspaceBridge({ registry, store, platform: 'darwin' })
    bridge.dispose()
    await expect(registry.create('/Users/a/proj')).rejects.toThrow(/ENOENT/)
  })
})
