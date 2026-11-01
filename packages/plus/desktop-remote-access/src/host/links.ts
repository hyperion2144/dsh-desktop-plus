// 地址/链接相关纯函数：归一化、局域网 IP 挑选、配对链接与二维码文本。
// 自实现（不拷贝 dsh-pocket 源码；仅对齐其行为约定）。

const PRIVATE_IPV4 = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/
const PHYSICAL_IFACE = /^(?:wlan|wi-?fi|wireless|ethernet|eth\d|en\d|wlp\d|以太网|本地连接)/i
const VPN_IFACE = /(?:radmin|tailscale|zerotier|tun|tap|vpn|vethernet|virtual|vmware|virtualbox|wsl|docker|teredo|hamachi|bluetooth|bridge)/i

/** 网卡地址的最小形状（os.NetworkInterfaceInfo 与测试夹具都满足）。 */
export interface NetworkAddressLike {
  address: string
  family: string
  internal: boolean
}

/** 网卡集合（按网卡名索引）。 */
export type NetworkInterfacesLike = Record<string, NetworkAddressLike[] | undefined>

/** 归一化远程地址：去 scheme、拒绝路径/凭据/空白；端口默认 3080。返回 host:port 或 null。 */
export function normalizeRemote(input: unknown): string | null {
  let a = String(input ?? '').trim()
  for (const p of ['https://', 'http://']) {
    if (a.startsWith(p)) { a = a.slice(p.length); break }
  }
  if (!a || a.includes('/') || a.includes('@') || a.includes(' ') || a.includes('?') || a.includes('#')) return null
  const m = a.match(/^([^:]+):(\d{1,5})$/)
  if (m) {
    const port = Number(m[2])
    if (port < 1 || port > 65535) return null
    return (m[1] ?? '') + ':' + port
  }
  return a + ':3080'
}

/** 从 os.networkInterfaces() 选手机最可能可达的 IPv4（RFC1918 优先、物理网卡加分、VPN 减分）。 */
export function selectLanIPv4(interfaces: NetworkInterfacesLike | undefined): string | null {
  return selectLanIPv4s(interfaces)[0] ?? null
}

/**
 * 从 os.networkInterfaces() 挑出**全部**候选 IPv4（按可达性打分降序）。
 *
 * 多网卡（有线 + Wi-Fi + 访客网络）时手机常常只能走其中一条：只挑一个 IP 等于把
 * 另外几条可达路径丢掉，故候选列表保留全部（排序与 selectLanIPv4 的打分一致，**首元素**
 * 与旧的单选结果相同——既有行为不变，多出来的只是候选）。
 */
export function selectLanIPv4s(interfaces: NetworkInterfacesLike | undefined): string[] {
  const candidates: { ip: string; score: number; order: number }[] = []
  const list: NetworkInterfacesLike = interfaces ?? {}
  for (const [name, addrs] of Object.entries(list)) {
    for (const addr of addrs ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      const ip = addr.address
      if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue
      let score = 0
      if (PRIVATE_IPV4.test(ip)) score += 100
      if (PHYSICAL_IFACE.test(name)) score += 20
      else if (VPN_IFACE.test(name)) score -= 50
      candidates.push({ ip, score, order: candidates.length })
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order)
  return candidates.map((c) => c.ip)
}

/** DNS 标签长度上限（RFC 1035）。 */
const DNS_LABEL_MAX = 63

/**
 * 净化主机名 → mDNS `.local` 主机的标签部分。
 *
 * 系统主机名不保证是合法 DNS 标签：macOS 允许空格与下划线（" John's MacBook Pro"），
 * Windows 允许连字符以外的杂字符，中文主机名则完全是多字节——直接拼 `.local` 会得到一个
 * 解析不了的域名。故：转小写 → 非法字符（含空白、下划线、点、Unicode）折叠成单个连字符 →
 * 去掉首尾连字符 → 截断到标签长度上限。净化后为空（非法主机名）返回 null。
 */
export function sanitizeLocalHostname(raw: unknown): string | null {
  const lowered = String(raw ?? '').trim().toLowerCase()
  if (!lowered) return null
  const cleaned = lowered
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, DNS_LABEL_MAX)
    .replace(/-+$/g, '')
  return cleaned || null
}

/**
 * 主机名 → `<主机名>.local` 候选；主机名非法时返回 null（该候选直接缺席）。
 *
 * 主机名本身已以 `.local` 结尾时**只净化首标签**：`.local` 名字必须与机器真实的
 * mDNS 名字逐字对应（把点也换成连字符会得到一个解析不到的名字）。
 */
export function localHostnameCandidate(raw: unknown): string | null {
  const host = String(raw ?? '').trim().toLowerCase()
  if (!host) return null
  const label = host.endsWith('.local')
    ? sanitizeLocalHostname(host.slice(0, -'.local'.length))
    : sanitizeLocalHostname(host)
  return label ? label + '.local' : null
}

/** 无候选时的回退主机（回环）——与既有行为一致：桌面自己总能连上。 */
export const LOOPBACK_HOST = '127.0.0.1'


/** lane 缺省端口（与 index.ts 的 DSH_REMOTE_LANE_PORT 默认一致）。 */
export const DEFAULT_LANE_PORT = 3091

/** 配对链接候选的构造参数。 */
export interface BaseCandidatesOptions {
  hostname?: unknown
  interfaces?: NetworkInterfacesLike
  port?: number
}

/**
 * 配对链接的**地址候选**（`host:port` 列表）。
 *
 * 候选顺序：① `<主机名>.local`（依赖系统 mDNS 解析，macOS/iOS 自带、Windows 需 Bonjour、
 * 无 mDNS 的 Linux 自然落空）② 多网卡 IPv4（按可达性打分）。两类并存：换网/DHCP 换 IP 后
 * `.local` 仍可解析，手机端按平台择优（iOS 用 .local、Android/鸿蒙用 IP）。
 *
 * 无任何候选时返回**空数组**（调用方负责回退，见 resolveBaseCandidates）。
 */
export function buildBaseCandidates({ hostname, interfaces, port = DEFAULT_LANE_PORT }: BaseCandidatesOptions = {}): string[] {
  const hosts: string[] = []
  const local = localHostnameCandidate(hostname)
  if (local) hosts.push(local)
  for (const ip of selectLanIPv4s(interfaces)) hosts.push(ip)
  const unique = [...new Set(hosts)]
  return unique.map((h) => h + ':' + port)
}

/**
 * 配对链接的地址候选（带回退）：无候选时回落到回环地址 `127.0.0.1:<port>`。
 * 回退行为与改动前完全一致（老逻辑在 lanIp 为空时就是用回环）。
 */
export function resolveBaseCandidates(opts: BaseCandidatesOptions = {}): string[] {
  const list = buildBaseCandidates(opts)
  return list.length ? list : [LOOPBACK_HOST + ':' + (opts.port ?? DEFAULT_LANE_PORT)]
}

/** 配对链接（手机壳 dsh-mobile:// 形态，含 base 候选列表）。 */
export function buildPairLink(bases: string[] | string, token: string): string {
  const joined = Array.isArray(bases) ? bases.join(',') : String(bases ?? '')
  const q = new URLSearchParams({ token })
  if (joined) q.set('base', joined)
  return 'dsh-mobile://pair?' + q.toString()
}

/** 浏览器兜底配对链接（http 形态）。
 *  **刻意用历史形态 `/pair`**：已安装的旧壳解析器只认裸 `/pair`（命名空间形态会让它把
 *  入口当目录拼错地址 → 401，实机踩过）；lane 两种形态都在服务，旧形态对新旧客户端都安全。 */
export function buildHttpPairLink(base: string, token: string, candidates: string[] = []): string {
  const link = 'http://' + base + '/pair?token=' + encodeURIComponent(token)
  // 候选列表（.local + 多网卡 IP）以 `base` 参数随链接下发：与 dsh-mobile:// 形态同名字段、
  // 同为逗号分隔——手机壳按平台择优取用（iOS 用 .local，Android/鸿蒙用 IP）。
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : []
  if (!list.length) return link
  return link + '&base=' + encodeURIComponent(list.join(','))
}

/** UI 展示用链接（避免长路径）。 */
export function qrText(link: string): string { return link }
