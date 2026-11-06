//! 一次性 Web UI 票据（#150）。
//!
//! B 要在浏览器里打开 A 的 DSH，登录地址必须由 **A** 签发——本机「铸造令牌」产出的是本机 lane 的地址。
//! A 经 lane 通道给已配对设备签一张一次性、短时有效的票据；浏览器拿着票据来兑，A 用自己已认证的会话
//! 换出一个 `?token=` 登录地址并跳转。票据只能兑一次，过期作废。
//
import { randomBytes } from 'node:crypto'

/**
 * 票据被拒时给浏览器看的一句话：说清原因和下一步，绝不回显票据本身。
 * @param reason 兑换被拒的原因。
 * @returns 可读提示。
 */
export function webuiRefusalMessage(reason: 'invalid' | 'used' | 'expired'): string {
  if (reason === 'used') return '这个链接已经用过一次。请回到设备管理，重新点「在浏览器打开该设备的 DSH」。'
  if (reason === 'expired') return `这个链接已过期（有效期 ${Math.round(WEBUI_TICKET_TTL_MS / 1000)} 秒）。请回到设备管理，重新打开。`
  return '链接无效。请回到设备管理，重新点「在浏览器打开该设备的 DSH」。'
}

/** 票据有效期：建议不超过 120 秒——够浏览器走完一次跳转，不够被人截下来慢慢用。 */
export const WEBUI_TICKET_TTL_MS = 120_000

/** 一张签发出去的票据。 */
export interface WebuiTicketRecord {
  ticket: string
  /** 签发给哪台设备（审计用）。 */
  deviceId: string
  /** 过期时刻（毫秒时间戳）。 */
  expiresAt: number
}

/** 兑换结果。 */
export type WebuiRedeem =
  | { ok: true, deviceId: string }
  | { ok: false, reason: 'invalid' | 'used' | 'expired' }

/** 票据存储：进程内即可——重启后未兑的票据作废，用户从设备管理重新打开即可。 */
export interface WebuiTicketStore {
  /** 给设备签一张票据；顺手清掉过期的。 */
  issue: (deviceId: string) => WebuiTicketRecord
  /** 兑换：成功一次后作废。 */
  redeem: (ticket: string) => WebuiRedeem
  /** 撤销发给某台设备的全部票据（解除配对时用），返回撤销的张数。 */
  revokeDevice: (deviceId: string) => number
  /** 清掉过期票据，返回清掉的条数。 */
  prune: () => number
}

/** 可注入的时间与随机源（测试用）。 */
export interface WebuiTicketStoreOptions {
  ttlMs?: number
  now?: () => number
  random?: () => string
}

/**
 * 创建票据存储。
 * @param options 有效期、时钟与随机源；缺省 120 秒、系统时钟、24 字节随机数。
 * @returns 票据存储。
 */
export function createWebuiTicketStore(options: WebuiTicketStoreOptions = {}): WebuiTicketStore {
  const ttlMs = options.ttlMs ?? WEBUI_TICKET_TTL_MS
  const now = options.now ?? (() => Date.now())
  const random = options.random ?? (() => randomWebuiTicket())
  const records = new Map<string, { deviceId: string, expiresAt: number, used: boolean }>()
  const prune = (): number => {
    const at = now()
    let removed = 0
    for (const [ticket, record] of records) {
      if (record.expiresAt <= at) { records.delete(ticket); removed += 1 }
    }
    return removed
  }
  return {
    issue(deviceId) {
      prune()
      let ticket = random()
      while (records.has(ticket)) ticket = random()
      const expiresAt = now() + ttlMs
      records.set(ticket, { deviceId, expiresAt, used: false })
      return { ticket, deviceId, expiresAt }
    },
    redeem(ticket) {
      const record = records.get(ticket)
      if (record === undefined) return { ok: false, reason: 'invalid' }
      if (record.used) return { ok: false, reason: 'used' }
      if (record.expiresAt <= now()) {
        records.delete(ticket)
        return { ok: false, reason: 'expired' }
      }
      record.used = true
      return { ok: true, deviceId: record.deviceId }
    },
    revokeDevice(deviceId) {
      let revoked = 0
      for (const [ticket, record] of records) {
        if (record.deviceId === deviceId && !record.used) { records.delete(ticket); revoked += 1 }
      }
      return revoked
    },
    prune,
  }
}

function randomWebuiTicket(): string {
  // 24 字节随机数：URL 安全，足够让猜测不可行。
  return randomBytes(24).toString('base64url')
}

