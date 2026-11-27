//! 在远端新建会话时的目标解析（#153）。
//!
//! 界面的「新会话」可能按工作区 id 发，也可能按目录发；主机有时带、有时不带。这里把它们归一到
//! 「哪台主机、哪个目录」，或给出稳定的错误码——之前只认目录，界面按工作区 id 发来的请求一律 bad-path。

/** 一次「在远端新建会话」请求里用来定位目标的信息。 */
export interface RemoteCreateTarget {
  /** 目标主机 id；可省略，按工作区 id 或目录反查。 */
  hostId?: string
  /** 远端工作区的官方 id（界面的「新会话」多半带这个）。 */
  workspaceId?: string
  /** 远端目录（按目录新建时带）。 */
  path?: string
}

/** 远程工作区登记里解析用到的字段。 */
export interface RemoteWorkspaceLookup {
  /** 本机官方工作区 id。 */
  workspaceId?: string
  /** 已配对主机 id。 */
  hostId: string
  /** 远端绝对路径。 */
  path: string
}

/** 解析结果：成功时给出主机与目录，失败时给出稳定错误码。 */
export type RemoteCreateResolution =
  | { ok: true, hostId: string, path: string }
  | { ok: false, code: 'bad-path' | 'not-remote-workspace' | 'unknown-host', message: string }

function stripTrailingSlash(value: string): string {
  return value.length > 1 && /[\\/]$/.test(value) ? value.slice(0, -1) : value
}

/**
 * 解析「在远端新建会话」的目标。
 * @param target 请求里带来的定位信息。
 * @param workspaces 本机登记的远程工作区。
 * @param hostExists 判断一台主机是否仍在配对表里。
 * @returns 主机与目录，或稳定错误码。
 */
export function resolveRemoteCreateTarget(
  target: RemoteCreateTarget,
  workspaces: readonly RemoteWorkspaceLookup[],
  hostExists: (hostId: string) => boolean,
): RemoteCreateResolution {
  const explicitHost = typeof target.hostId === 'string' ? target.hostId : ''
  const workspaceId = typeof target.workspaceId === 'string' ? target.workspaceId : ''
  let path = typeof target.path === 'string' ? target.path : ''

  let record: RemoteWorkspaceLookup | undefined
  if (workspaceId !== '') {
    record = workspaces.find((entry) => entry.workspaceId === workspaceId)
    if (record === undefined) return { ok: false, code: 'not-remote-workspace', message: `工作区 ${workspaceId} 不是远程工作区` }
    path = record.path
  } else {
    if (path === '') return { ok: false, code: 'bad-path', message: '新建远程会话需要目录或工作区' }
    const wanted = stripTrailingSlash(path)
    record = workspaces.find((entry) => stripTrailingSlash(entry.path) === wanted)
    if (record === undefined && explicitHost === '') return { ok: false, code: 'not-remote-workspace', message: `目录 ${path} 不属于任何远程工作区` }
  }
  const hostId = explicitHost !== '' ? explicitHost : record?.hostId ?? ''
  if (hostId === '') return { ok: false, code: 'not-remote-workspace', message: '找不到这个工作区所属的设备' }
  if (!hostExists(hostId)) return { ok: false, code: 'unknown-host', message: '这台设备已不在配对表里' }
  return { ok: true, hostId, path }
}
