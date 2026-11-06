//! 远程会话登记：把「本机这个会话其实是 A 机上的会话」连同镜像进度落盘。
//!
//! 为什么必须落盘：镜像出来的会话在本机是**普通会话**，重启后官方照常重放它；
//! 但桥接进程内的 `sessions` / `cursors` 两张表是空的，会带来两个后果——
//!   1. 继续对话时认不出它是远程会话，消息会落到本机 agent 上；
//!   2. 镜像游标从 0 重来，把整段历史再追加一遍，会话里出现重复消息。
//! 所以登记表与游标一起持久化，重启后先恢复再继续镜像。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 一条远程会话登记。 */
export interface RemoteSessionEntry {
  /** 会话 id（与远端一致）。 */
  sessionId: string
  /** 会话所在主机。 */
  hostId: string
  /** 会话工作目录（远端路径，用于工作区归属）。 */
  path: string
  /** 已镜像到的远端事件 seq。 */
  seq: number
}

/** 登记表存储。 */
export interface RemoteSessionRegistry {
  /** 落盘路径。 */
  path: string
  /** 读取全部登记；文件缺失或损坏时返回空表。 */
  load: () => RemoteSessionEntry[]
  /** 覆盖写入全部登记。 */
  save: (entries: RemoteSessionEntry[]) => void
}

/**
 * 文件存储适配器（默认）：$DSH_HOME 下 0600 文件。
 * @param file 存储文件路径；默认 $DSH_HOME/storages/remote-access/remote-sessions.json
 */
export function createRemoteSessionRegistry(file?: string): RemoteSessionRegistry {
  const resolved = file ?? path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'storages', 'remote-access', 'remote-sessions.json')
  return {
    path: resolved,
    load() {
      try {
        const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as { sessions?: unknown }
        if (!Array.isArray(raw.sessions)) return []
        const entries: RemoteSessionEntry[] = []
        for (const item of raw.sessions) {
          if (item === null || typeof item !== 'object') continue
          const record = item as Partial<RemoteSessionEntry>
          if (typeof record.sessionId !== 'string' || typeof record.hostId !== 'string' || typeof record.path !== 'string') continue
          entries.push({ sessionId: record.sessionId, hostId: record.hostId, path: record.path, seq: typeof record.seq === 'number' ? record.seq : 0 })
        }
        return entries
      } catch {
        return []
      }
    },
    save(entries) {
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, JSON.stringify({ sessions: entries }), { mode: 0o600 })
      } catch {
        // 落盘失败不影响会话本身：最坏情况是重启后重新镜像一次。
      }
    },
  }
}
