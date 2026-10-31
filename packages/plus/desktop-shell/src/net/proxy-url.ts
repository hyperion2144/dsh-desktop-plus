// 代理 URL 规范化（旧壳 `normalize_proxy_url` + `proxy_url_from_authority` 的等价物）。

export interface ProxyTarget {
  /** 规范化后的 URL：`<scheme>://<host>:<port>`（socks 统一写成 socks5）。 */
  url: string
  /** 供 TCP connect 用：host（IPv6 带方括号）。 */
  host: string
  port: number
}

/**
 * 规范化代理 URL：只认 http/https/socks5/socks；多粘贴的路径/查询/锚点丢掉；端口缺省按 scheme 补
 * （https 443 / socks 1080 / http 80）；裸 IPv6 补方括号。
 */
export function normalizeProxyUrl(raw: string): { ok: true; target: ProxyTarget } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, error: '代理地址为空' }
  const split = trimmed.indexOf('://')
  if (split < 0) return { ok: false, error: `代理 URL 非法（需 http/https/socks5://host:port）：${raw}` }
  const rawScheme = trimmed.slice(0, split).toLowerCase()
  if (!['http', 'https', 'socks5', 'socks'].includes(rawScheme)) {
    return { ok: false, error: `代理 URL 非法（需 http/https/socks5://host:port）：${raw}` }
  }
  const scheme = rawScheme === 'socks' ? 'socks5' : rawScheme
  const rest = trimmed.slice(split + 3)
  const authorityRaw = rest.split(/[/?#]/)[0] ?? ''
  // 有些来源会把 scheme 再写一遍（http://http://host:8080）
  const authority = (authorityRaw.includes('://') ? authorityRaw.slice(authorityRaw.indexOf('://') + 3) : authorityRaw).trim()
  if (authority === '') return { ok: false, error: `代理 URL 缺少主机：${raw}` }
  const { host, portText } = splitAuthority(authority)
  if (host === '') return { ok: false, error: `代理 URL 缺少主机：${raw}` }
  const defaultPort = scheme === 'https' ? '443' : scheme === 'socks5' ? '1080' : '80'
  const portValue = portText === null || portText === '' ? defaultPort : portText
  const port = Number.parseInt(portValue, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: `代理 URL 端口非法：${portValue}` }
  }
  // 裸 IPv6（`::1`）补方括号；同一位置出现冒号但不是 IP 字面量的（`:8080`、`host:abc`）直接判非法
  if (host.includes(':') && !host.startsWith('[')) {
    const colons = host.split(':').length - 1
    if (colons < 2 || !/^[0-9A-Fa-f:.]+$/.test(host)) return { ok: false, error: `代理 URL 主机非法：${raw}` }
  }
  const hostForConnect = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return { ok: true, target: { url: `${scheme}://${hostForConnect}:${String(port)}`, host: hostForConnect, port } }
}

/** 拆 authority：支持 `[::1]:8080` 与 `host:8080`，端口必须是纯数字。 */
export function splitAuthority(authority: string): { host: string; portText: string | null } {
  const close = authority.indexOf(']')
  if (close >= 0) {
    const host = authority.slice(0, close + 1)
    const rest = authority.slice(close + 1)
    return { host, portText: rest.startsWith(':') ? rest.slice(1) : null }
  }
  const at = authority.lastIndexOf(':')
  if (at > 0) {
    const host = authority.slice(0, at)
    const port = authority.slice(at + 1)
    // 末段是纯数字才算端口；host 可以是裸 IPv6（`::1:8080`），但不能是空或只剩冒号
    const hostOk = host.includes(':') ? host.replace(/:/g, '') !== '' : host !== ''
    if (hostOk && port !== '' && /^[0-9]+$/.test(port)) return { host, portText: port }
  }
  return { host: authority, portText: null }
}
