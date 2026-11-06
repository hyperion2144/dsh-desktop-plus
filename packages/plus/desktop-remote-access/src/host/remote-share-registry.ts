//! 会话分享登记：本机哪个会话分享给了哪些主机。
//!
//! 分享不复制会话——会话始终属于本机，对端只是同一份日志的另一个视图。
//! 登记表落盘，重启后分享关系还在；对端上线后据此发现「有哪些会话分享给我」。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一条分享登记。 */
export interface RemoteShareEntry {
  /** 被分享的会话 id（本机会话）。 */
  sessionId: string
  /** 分享给哪台设备（本机配对表里的 deviceId）。 */
  deviceId: string
  /** 会话工作目录（本机路径，对端据此归入远程工作区）。 */
  path: string
  /** 分享建立时间（毫秒）。 */
  sharedAt: number
}

/** 分享登记表存储。 */
export interface RemoteShareRegistry {
  /** 落盘路径。 */
  path: string
  /** 读取全部登记；文件缺失或损坏时返回空表。 */
  load: () => RemoteShareEntry[]
  /** 覆盖写入全部登记。 */
  save: (entries: RemoteShareEntry[]) => void
}

/**
 * 文件存储适配器（默认）：$DSH_HOME 下 0600 文件。
 * @param file 存储文件路径；默认 $DSH_HOME/storages/remote-access/remote-shares.json
 * @returns 登记表。
 */
export function createRemoteShareRegistry(file?: string): RemoteShareRegistry {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'remote-shares.json')
  return {
    path: resolved,
    load() {
      try {
        const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as { shares?: unknown }
        if (!Array.isArray(raw.shares)) return []
        const entries: RemoteShareEntry[] = []
        for (const item of raw.shares) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Partial<RemoteShareEntry>
          if (typeof record.sessionId !== 'string' || typeof record.deviceId !== 'string' || typeof record.path !== 'string') continue
          entries.push({
            sessionId: record.sessionId,
            deviceId: record.deviceId,
            path: record.path,
            sharedAt: typeof record.sharedAt === 'number' ? record.sharedAt : Date.now(),
          })
        }
        return entries
      } catch {
        return []
      }
    },
    save(entries) {
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, JSON.stringify({ shares: entries }, null, 2), { mode: 0o600 })
    },
  }
}
