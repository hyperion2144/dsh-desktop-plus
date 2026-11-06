//! 远程工作区：把「另一台已配对主机上的目录」登记成本机官方 Workspace。
//!
//! 官方 registry 的 `create()` 强制 `fs.realpath` + `isDirectory()`（路径必须在本机存在），
//! 远程路径天然过不了这一关。本模块**不改进官方代码**，只在本进程内给 registry 的两个
//! 公开方法包一层：命中「已登记的远程路径」就跳过文件系统校验、直达官方私有 `createCanonical`；
//! 其余路径原样转调。官方 `indexHeader` 对 header `cwd` 的 ENOENT 本就宽容
//! （只记 `missingSessionPaths`，而 `candidateMatches` 认这一支），不需要再包。
//!
//! 设备标识只存在插件自己的 `remote-workspaces.json` 里，不写进 WorkspaceRecord 域规格。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { posix, win32 } from 'node:path'

/** 一条「远程工作区」登记：哪个设备 + 该设备上的哪个绝对目录。 */
export interface RemoteWorkspaceRecord {
  /** 配对时由被访问方生成的设备标识。 */
  hostId: string
  /** 该设备上的规范化绝对路径（本机不要求存在）。 */
  path: string
  /** 展示名（缺省取路径末段）。 */
  title: string
  /** 登记时间（毫秒）。 */
  addedAt: number
}

/** 持久化状态（文件/内存存储共用）。 */
export interface PersistedRemoteWorkspaceState {
  workspaces?: RemoteWorkspaceRecord[]
}

/** 持久化适配器（与 pairing 同形状，便于测试注入内存实现）。 */
export interface RemoteWorkspaceStorage {
  load(): PersistedRemoteWorkspaceState | null
  save(state: PersistedRemoteWorkspaceState): void
}

/** 文件存储适配器（多一个 `path` 字段，便于诊断）。 */
export interface RemoteWorkspaceFileStorage extends RemoteWorkspaceStorage {
  path: string
}

/**
 * 文件存储适配器（默认）：$DSH_HOME 下 0600 文件，重启后登记不丢。
 * @param file 存储文件路径；默认 $DSH_HOME/storages/remote-access/remote-workspaces.json
 */
export function createRemoteWorkspaceStorage(file?: string): RemoteWorkspaceFileStorage {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'remote-workspaces.json')
  return {
    path: resolved,
    load() {
      try {
        return JSON.parse(fs.readFileSync(resolved, 'utf8')) as PersistedRemoteWorkspaceState
      } catch {
        return null
      }
    },
    save(state) {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, JSON.stringify(state))
        try { fs.chmodSync(resolved, 0o600); } catch { /* noop */ }
      } catch { /* 持久化失败不阻塞运行 */ }
    },
  }
}

/** 内存存储适配器（测试用／不持久化）。 */
export function createMemoryRemoteWorkspaceStorage(): RemoteWorkspaceStorage {
  let mem: PersistedRemoteWorkspaceState | null = null
  return {
    load: () => mem,
    save: (state) => { mem = state },
  }
}

/**
 * 判断路径是否「固定指向某个 Host 位置」——与官方 `fullyQualifiedWorkspacePath` 同义，
 * 但独立实现，避免本包对 upstream 包产生编译期依赖。
 * @param candidate 候选路径。
 * @param platform 平台；可注入以便测试。
 */
export function fullyQualifiedRemotePath(candidate: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'win32') return posix.isAbsolute(candidate)
  const root = win32.parse(candidate).root
  return win32.isAbsolute(candidate) && root !== '\\' && root !== '/'
}

/**
 * 规范化远程路径：只做纯字符串归一（去尾斜杠、折叠 . 与 ..），**绝不碰文件系统**。
 * 远程路径在本机不存在是正常状态，任何 fs 调用都会把远程工作区误判成非法。
 * @param candidate 远程绝对路径。
 * @param platform 平台；可注入以便测试。
 * @returns 规范化后的绝对路径。
 */
export function normalizeRemotePath(candidate: string, platform: NodeJS.Platform = process.platform): string {
  if (!fullyQualifiedRemotePath(candidate, platform)) {
    throw new TypeError(`远程工作区路径必须是绝对路径：'${candidate}'`)
  }
  const api = platform === 'win32' ? win32 : posix
  const normalized = api.normalize(candidate)
  const root = api.parse(normalized).root
  if (normalized === root) return normalized
  return normalized.length > root.length && normalized.endsWith(api.sep)
    ? normalized.slice(0, -1)
    : normalized
}

/** 远程工作区登记的键：设备 + 路径。 */
function keyOf(hostId: string, remotePath: string): string {
  return `${hostId}\u0000${remotePath}`
}

/**
 * 远程工作区登记表。一台设备的同一个路径只登记一次；跨设备同路径互不干扰。
 */
export class RemoteWorkspaceStore {
  /** 登记表（`hostId + path` → 记录）。 */
  workspaces: Map<string, RemoteWorkspaceRecord>

  /** 持久化适配器（null = 不持久化）。 */
  storage: RemoteWorkspaceStorage | null

  /**
   * @param opts 构造参数
   * @param opts.storage 持久化适配器
   */
  constructor({ storage = null }: { storage?: RemoteWorkspaceStorage | null } = {}) {
    this.workspaces = new Map()
    this.storage = storage
    if (storage) this._restore()
  }

  /** 从持久化状态恢复。 */
  _restore(): void {
    try {
      const state = this.storage?.load()
      if (!state || typeof state !== 'object' || !Array.isArray(state.workspaces)) return
      for (const record of state.workspaces) {
        if (record && typeof record.hostId === 'string' && typeof record.path === 'string') {
          this.workspaces.set(keyOf(record.hostId, record.path), {
            hostId: record.hostId,
            path: record.path,
            title: typeof record.title === 'string' && record.title !== '' ? record.title : path.basename(record.path),
            addedAt: Number(record.addedAt ?? Date.now()),
          })
        }
      }
    } catch { /* 损坏/不可读 → 按空开始 */ }
  }

  /** 落盘。 */
  _persist(): void {
    if (!this.storage) return
    try {
      this.storage.save({ workspaces: [...this.workspaces.values()] })
    } catch { /* noop */ }
  }

  /**
   * 登记一个远程工作区（已登记则直接返回旧记录）。
   * @param record 设备 + 规范化远程路径 + 展示名。
   * @returns 落表后的记录。
   */
  add(record: RemoteWorkspaceRecord): RemoteWorkspaceRecord {
    const key = keyOf(record.hostId, record.path)
    const existing = this.workspaces.get(key)
    if (existing !== undefined) return existing
    this.workspaces.set(key, record)
    this._persist()
    return record
  }

  /**
   * 撤销一条登记。
   * @param hostId 设备标识。
   * @param remotePath 规范化远程路径。
   * @returns 是否真的删掉了。
   */
  remove(hostId: string, remotePath: string): boolean {
    const deleted = this.workspaces.delete(keyOf(hostId, remotePath))
    if (deleted) this._persist()
    return deleted
  }

  /** 全部登记（登记顺序）。 */
  list(): RemoteWorkspaceRecord[] {
    return [...this.workspaces.values()]
  }

  /**
   * 按「规范化后的绝对路径」找登记——**不看设备**，因为 registry 的包装只拿得到路径。
   * registry 里一个路径只会存在一个 Workspace，因此该映射天然唯一。
   * @param remotePath 待查路径（未规范化也可）。
   * @param platform 平台；可注入以便测试。
   * @returns 命中的登记，或 undefined。
   */
  matchPath(remotePath: string, platform: NodeJS.Platform = process.platform): RemoteWorkspaceRecord | undefined {
    let normalized: string
    try {
      normalized = normalizeRemotePath(remotePath, platform)
    } catch {
      return undefined
    }
    for (const record of this.workspaces.values()) {
      if (record.path === normalized) return record
    }
    return undefined
  }
}

/** 本包对官方 registry 的最小结构契约（只声明包装用到的方法）。 */
export interface WorkspaceRegistryLike {
  /** 官方创建入口：realpath + isDirectory。 */
  create(remotePath: string, title?: string): Promise<WorkspaceView>
  /** 官方按路径查找入口：同样过 realpath。 */
  resolveByPath(remotePath: string): Promise<WorkspaceView | undefined>
  /** 官方同步投影。 */
  list(): WorkspaceView[]
  /** 官方私有规范化创建（TS private，运行期可达）；缺失即视为上游改了结构。 */
  createCanonical?: (canonical: string, title?: string, firstUse?: boolean) => Promise<WorkspaceView>
}

/** registry 返回的 Workspace 投影（只取本模块用到的字段）。 */
export interface WorkspaceView {
  readonly id: string
  readonly path: string
  readonly title: string
  /**
   * 官方实体方法：把一条会话挂进这个工作区（运行期可达；缺失即视为上游改了结构）。
   *
   * 官方实现会校验会话头的 cwd 能 realpath 且等于工作区路径——远端路径在本机不存在时
   * 这一步会抛错，调用方据此降级（会话留在「未分组」，下次启动由官方 bootstrap 按路径归位）。
   */
  attachSession?: (sessionId: string) => Promise<void>
}

/** 包装结果。 */
export interface RemoteWorkspaceBridge {
  /** 是否真的装上了（registry 结构不符时为 false，调用方应上报而不是静默降级）。 */
  installed: boolean
  /** 卸载包装，恢复官方方法。 */
  dispose: () => void
}

/** 私有 `createCanonical` 缺失时的稳定错误码，便于上层转成 RPC 错误。 */
export const REMOTE_BRIDGE_UNSUPPORTED = 'remote-workspace/unsupported-registry'

/**
 * 给官方 registry 的两个公开方法装远程分支：
 * - `resolveByPath(p)`：p 是已登记远程路径 → 直接在本机投影里按字符串查，不过 fs。
 * - `create(p, title?)`：p 是已登记远程路径 → 直达 `createCanonical`，不过 fs。
 *
 * 其余路径一律原样转调官方实现，本地工作区行为**逐字节不变**。
 * @param opts 装配参数
 * @param opts.registry 官方 workspace registry 实例。
 * @param opts.store 远程工作区登记表。
 * @param opts.platform 平台；可注入以便测试。
 * @returns 包装结果；`installed=false` 表示上游结构已变。
 */
export function installRemoteWorkspaceBridge(opts: {
  registry: WorkspaceRegistryLike
  store: RemoteWorkspaceStore
  platform?: NodeJS.Platform
}): RemoteWorkspaceBridge {
  const { registry, store, platform } = opts
  const originalCreate = registry.create
  const originalResolve = registry.resolveByPath
  if (typeof originalCreate !== 'function' || typeof originalResolve !== 'function') {
    return { installed: false, dispose: () => {} }
  }
  if (typeof registry.createCanonical !== 'function') {
    return { installed: false, dispose: () => {} }
  }
  const canonicalize = registry.createCanonical.bind(registry)

  registry.resolveByPath = async (candidate: string): Promise<WorkspaceView | undefined> => {
    const record = store.matchPath(candidate, platform)
    if (record === undefined) return await originalResolve.call(registry, candidate)
    return registry.list().find(workspace => workspace.path === record.path)
  }

  registry.create = async (candidate: string, title?: string): Promise<WorkspaceView> => {
    const record = store.matchPath(candidate, platform)
    if (record === undefined) return await originalCreate.call(registry, candidate, title)
    const existing = registry.list().find(workspace => workspace.path === record.path)
    if (existing !== undefined) return existing
    return await canonicalize(record.path, title ?? record.title)
  }

  return {
    installed: true,
    dispose: () => {
      registry.create = originalCreate
      registry.resolveByPath = originalResolve
    },
  }
}
