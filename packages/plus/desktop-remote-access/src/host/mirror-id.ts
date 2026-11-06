//! 镜像会话 id（#107）：A 上的一条会话在 B 的官方会话存储里长什么样。
//!
//! 镜像会话的 id 带 `remote-` 前缀，由「主机 id + 远端会话 id」确定：一眼能认出它是镜像而不是本机会话，
//! 也不会和本机自己建的会话撞 id。官方存储按会话 id「一键一文件」落盘（投影缓存等），键名只允许
//! 字母、数字、下划线、连字符；主机 id 自带 `@ : /`，不能原样放进去，所以取它的小写十六进制哈希。
//! 还原时重算哈希、与已知的主机 id 整段比对：对不上就拒绝。
//!
//! 转发到 A 的请求带的是本机镜像 id，发出前必须换回远端会话 id。各命名空间的会话标识字段名不同
//! （sessionId / agentId / workspaceFileScopeId / address.sessionId …），所以按值逐层替换，不依赖字段名。
import { createHash } from 'node:crypto'

/** 镜像会话 id 的前缀。 */
export const MIRROR_ID_PREFIX = 'remote-'

/**
 * 主机 id 在镜像 id 里的样子：SHA-256 的前 16 位小写十六进制。
 * @param hostId 已配对主机 id。
 * @returns 16 位十六进制串。
 */
function hostTagOf(hostId: string): string {
  return createHash('sha256').update(hostId).digest('hex').slice(0, 16)
}

/**
 * 生成镜像会话 id。
 * @param hostId 已配对主机 id。
 * @param remoteSessionId 远端会话 id。
 * @returns 形如 `remote-<主机哈希>-<sessionId>` 的本机镜像 id，只含字母、数字、下划线、连字符。
 */
export function mirrorIdOf(hostId: string, remoteSessionId: string): string {
  return `${MIRROR_ID_PREFIX}${hostTagOf(hostId)}-${remoteSessionId}`
}

/**
 * 是否镜像会话 id。
 * @param sessionId 会话 id。
 * @returns 带 `remote-` 前缀时为 true。
 */
export function isMirrorId(sessionId: string): boolean {
  return sessionId.startsWith(MIRROR_ID_PREFIX)
}

/**
 * 还原远端会话 id。
 * @param mirrorId 本机镜像会话 id。
 * @param hostId 它所属的主机 id。
 * @returns 远端会话 id。镜像带着别的主机的哈希、对不上时返回 undefined：宁可拒绝，也不把一个错的 id
 *          发给别的设备。旧版镜像没有前缀，id 本身就是远端会话 id，原样返回。
 */
export function remoteIdOfMirror(mirrorId: string, hostId: string): string | undefined {
  if (!isMirrorId(mirrorId)) return mirrorId
  const head = `${MIRROR_ID_PREFIX}${hostTagOf(hostId)}-`
  return mirrorId.startsWith(head) ? mirrorId.slice(head.length) : undefined
}

/**
 * 把参数里所有等于某个「本机镜像 id」的字符串换成对应的远端会话 id。
 *
 * 只替换整串相等的值：正文里顺带提到的 id 不动。不改动传入的对象；没有可替换的值时返回原对象。
 * @param value 官方调用的参数（任意嵌套的 JSON 结构）。
 * @param pairs 本机镜像 id → 远端会话 id。
 * @returns 替换后的参数。
 */
export function replaceSessionIds<T>(value: T, pairs: Record<string, string>): T {
  const replace = (inner: unknown): unknown => {
    if (typeof inner === 'string') return Object.hasOwn(pairs, inner) ? pairs[inner] : inner
    if (Array.isArray(inner)) {
      const next = inner.map(replace)
      return next.some((item, index) => item !== inner[index]) ? next : inner
    }
    if (inner !== null && typeof inner === 'object') {
      let changed = false
      const next: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(inner as Record<string, unknown>)) {
        next[key] = replace(item)
        if (next[key] !== item) changed = true
      }
      return changed ? next : inner
    }
    return inner
  }
  return replace(value) as T
}
