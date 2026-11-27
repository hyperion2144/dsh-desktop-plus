//! 订阅租约（#152）。
//!
//! 设备登记「我在看这条会话」之后要定期续租。设备断线、关掉应用之后续租就停了，A 侧的订阅记录在
//! 租约到期后清除：不再向它推送，观众数也随之回落。在线时每租约的三分之一续一次，来得及。

/** 租约时长：三分钟。足够宽容一次短暂掉线，又不至于让早已离开的设备长期占着订阅。 */
export const REMOTE_WATCH_LEASE_MS = 180_000

/** 续租间隔：租约的三分之一。连丢两次仍有一息，第三次之前必须续上。 */
export const REMOTE_WATCH_RENEW_MS = REMOTE_WATCH_LEASE_MS / 3

/**
 * 计算一次登记的到期时刻。
 * @param now 现在（毫秒时间戳）。
 * @param ttlMs 租约时长，缺省三分钟。
 * @returns 到期时刻（毫秒时间戳）。
 */
export function leaseExpiresAt(now: number = Date.now(), ttlMs: number = REMOTE_WATCH_LEASE_MS): number {
  return now + ttlMs
}

/**
 * 一条登记是否已过租约。
 * @param expiresAt 到期时刻；没有到期时刻的是租约上线前的旧登记，视为长期。
 * @param now 现在。
 * @returns 已过期为 true。
 */
export function isLeaseExpired(expiresAt: number | undefined, now: number = Date.now()): boolean {
  return expiresAt !== undefined && expiresAt <= now
}

/**
 * 清掉已过租约的登记。
 * @param entries 登记列表。
 * @param now 现在。
 * @returns 仍在租约内的登记（新数组）。
 */
export function pruneExpiredLeases<T extends { expiresAt?: number }>(entries: readonly T[], now: number = Date.now()): T[] {
  return entries.filter((entry) => !isLeaseExpired(entry.expiresAt, now))
}

/**
 * 剩余租约时间（诊断用：A 侧看每个订阅还有多久到期）。
 * @param expiresAt 到期时刻。
 * @param now 现在。
 * @returns 剩余毫秒，过期为 0；长期登记为 null。
 */
export function leaseRemainingMs(expiresAt: number | undefined, now: number = Date.now()): number | null {
  if (expiresAt === undefined) return null
  return Math.max(0, expiresAt - now)
}
