//! 远端目录浏览：把「另一台已配对主机上的目录树」读给本机的添加工作区流程用。
//!
//! 方向与凭据见 remote-hosts.ts。数据面只一条 lane 路由（A 侧提供、B 侧消费），要求已配对设备 cookie：
//!   POST /__dsh-mobile/api/remote/fs.list  { path } → 该目录下的子目录列表
//!
//! 只列目录、不列文件：添加工作区要的是目录。A 侧不跟随符号链接，避免把远端
//! 的链接环带进浏览路径；单层最多返回 MAX_ENTRIES 条，超出截断并置 truncated。
import fs from 'node:fs'
import path from 'node:path'
import type { RemoteHostRecord } from './remote-hosts.js'
import { fetchFromHost } from './remote-hosts.js'

/** 单层目录最多返回的条目数。 */
export const MAX_ENTRIES = 500

/** 一条目录条目。 */
export interface RemoteDirectoryEntry {
  /** 目录名（不含父路径）。 */
  name: string
  /** 该主机上的绝对路径。 */
  path: string
}

/** 一次目录浏览的结果。 */
export interface RemoteDirectoryListing {
  /** 被浏览的绝对路径。 */
  path: string
  /** 子目录（按名称升序）。 */
  entries: RemoteDirectoryEntry[]
  /** 是否因条目过多被截断。 */
  truncated: boolean
}

/**
 * A 侧：列出本机某个目录下的子目录。
 * @param target 绝对路径；空串表示列出根目录。
 * @returns 目录列表；路径不存在或不是目录时抛错。
 */
export function listLocalDirectory(target: string): RemoteDirectoryListing {
  const resolved = target === '' ? path.parse(process.cwd()).root : path.resolve(target)
  const dirents = fs.readdirSync(resolved, { withFileTypes: true })
  const entries: RemoteDirectoryEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue
    entries.push({ name: dirent.name, path: path.join(resolved, dirent.name) })
  }
  entries.sort((left, right) => left.name.localeCompare(right.name))
  return {
    path: resolved,
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: entries.length > MAX_ENTRIES,
  }
}

/**
 * B 侧：向已配对主机要一份目录列表。
 * @param host 已配对主机记录。
 * @param target 该主机上的绝对路径。
 * @returns 目录列表。
 */
export async function fetchRemoteDirectory(host: RemoteHostRecord, target: string): Promise<RemoteDirectoryListing> {
  const response = await fetchFromHost(host, '/__dsh-mobile/api/remote/fs.list', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: target }),
  })
  if (!response.ok) throw new Error(`remote fs.list failed: HTTP ${response.status}`)
  const payload = (await response.json()) as Partial<RemoteDirectoryListing>
  return {
    path: typeof payload.path === 'string' ? payload.path : target,
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    truncated: payload.truncated === true,
  }
}
