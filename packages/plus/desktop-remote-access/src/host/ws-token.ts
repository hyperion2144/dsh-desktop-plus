import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** WS/HTTP 直连令牌的默认有效期（24h）：壳每次装载页面重签，撤销靠过期与配对记录。 */
export const WS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** 令牌里的身份就是会话 cookie 的值：验签后能还原出原 cookie，沿用既有的 isDevice 判定。 */
export interface WsTokenParts {
  /** 还原出的会话 cookie 值。 */
  readonly session: string
  /** 到期时间（毫秒时间戳）。 */
  readonly expiresAt: number
}

/** 把一段字节编码成 URL 安全的 base64（去掉填充）。 */
function b64url(input: Buffer): string {
  return input.toString('base64url')
}

/** 用进程内的 HMAC 密钥给会话值签名，得到可放进 URL 的直连令牌。 */
export function mintWsToken(secret: string, session: string, now: number = Date.now(),
  ttlMs: number = WS_TOKEN_TTL_MS): string {
  const expiresAt = now + ttlMs
  const payload = `${b64url(Buffer.from(session, 'utf8'))}.${String(expiresAt)}`
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

/**
 * 校验令牌并还原会话值。
 * @param secret - HMAC 密钥。
 * @param token - URL 里携带的令牌。
 * @param now - 当前时间（测试注入）。
 * @returns 还原出的会话值；签名不符或已过期返回 null。
 */
export function verifyWsToken(secret: string, token: string, now: number = Date.now()): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const idPart = parts[0] ?? ''
  const expPart = parts[1] ?? ''
  const signature = parts[2] ?? ''
  if (idPart.length === 0 || expPart.length === 0 || signature.length === 0) return null
  const payload = `${idPart}.${expPart}`
  const expected = createHmac('sha256', secret).update(payload).digest()
  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null
  const expiresAt = Number(expPart)
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null
  const session = Buffer.from(idPart, 'base64url').toString('utf8')
  return session.length > 0 ? session : null
}

/**
 * 从请求 URL 里取出直连令牌。
 *
 * 约定前缀 `/__dsh_ws/<token>/…`：页面把令牌放进路径（WS 无法带请求头），
 * 反代命中后先剥前缀再按原路径转发。
 * @param url - 原始请求 URL。
 * @returns 令牌文本；不是直连路径时返回 null。
 */
export function wsTokenOf(url: string): string | null {
  const path = url.split('?')[0] ?? ''
  if (!path.startsWith('/__dsh_ws/')) return null
  const rest = path.slice('/__dsh_ws/'.length)
  const end = rest.indexOf('/')
  if (end <= 0) return null
  return rest.slice(0, end)
}

/** 生成一份新的 HMAC 密钥（首次启动时落盘用）。 */
export function newWsTokenSecret(): string {
  return randomBytes(32).toString('hex')
}

/** lane 进程内的 HMAC 密钥（懒生成）：重启后旧令牌失效，壳重新装载页面时重签。 */
let secretCache: string | null = null

/**
 * 取直连令牌的签名密钥。
 * @returns 稳定的进程内密钥（首次调用时生成）。
 */
export function laneWsTokenSecret(): string {
  if (secretCache === null) secretCache = newWsTokenSecret()
  return secretCache
}
