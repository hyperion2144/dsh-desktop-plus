//! lane 自有路由的保留命名空间与匹配器（#145）。
//!
//! 反代的本职是「把发往 dsh 端口的请求原样透传」。lane 自己的控制面（配对、设备、
//! 隧道、事件）因此必须住在**保留命名空间**里、永不与 dsh 路由同形——否则上游一次
//! 新增路由就可能被 lane 截胡，而这类截胡在远程端只表现为「某个设置/接口拿不到」，
//! 极难排查（#145 的根因之一）。
//!
//! 命名空间下的规范路径 = `LANE_PREFIX` + 相对路径（`LANE_ROUTE_PATHS`）。
//!
//! 历史兼容：命名空间上线前这些端点直接挂在 `/pair` 与 `/api/pair/*`。已发出的配对
//! 链接（二维码、设备上的 `remote_list` 存档）与尚未升级的设备仍会打这些路径，故保留
//! 为**冻结别名**（`LANE_LEGACY_PATHS`）：只读快照，**新增路由不得加入此表**——新能力
//! 一律走命名空间，别名集合只会随时间收缩、不再增长。

/** lane 控制面的保留命名空间前缀。dsh 自身不拥有任何 `/__dsh-mobile*` 路径。 */
export const LANE_PREFIX = '/__dsh-mobile'

/** 把 lane 相对路径升格为保留命名空间下的规范路径。 */
export function lanePath(relative: string): string {
  return LANE_PREFIX + relative
}

/**
 * lane 自有路由（相对路径）。任何新增控制端点都必须登记在这里——它同时是
 * 「lane 会截胡哪些路径」的唯一事实源，测试据此锁死透传不变式。
 */
export const LANE_ROUTE_PATHS: readonly string[] = Object.freeze([
  '/pair',
  '/api/pair/info',
  '/api/pair/accept',
  '/api/pair/mint',
  '/api/pair/probe',
  '/api/pair/tunnel',
  '/api/pair/devices',
  '/api/pair/renew',
  // 直连令牌：把会话换成 URL 可携带的签名令牌（WS 带不了请求头）。
  '/api/pair/ws-token',
  '/api/pair/remove',
  '/api/pair/stop',
  '/api/pair/events',
  '/api/pair/cloudflared',
  // 远端数据面（#93）：已配对主机读取本机会话日志，供对端渲染远端会话。
  '/api/remote/sessions',
  // 事件分页（#107）：按 seq 游标取一页，替代一次性全量 read（read 只留给旧客户端）。
  '/api/remote/session.page',
  '/api/remote/session.read',
  '/api/remote/session.import',
  '/api/remote/stream',
  '/api/remote/shares',
  // 远端目录浏览（#106）：添加工作区时浏览对端目录树。
  '/api/remote/fs.list',
  // 订阅与交互中继（#151 / #152）：已配对设备登记它镜像了哪条会话，并交回提问 / 审批的回答。
  '/api/remote/session.watch',
  '/api/remote/session.unwatch',
  '/api/remote/interaction.answer',
  // Web UI 票据（#150）：已配对设备为「在浏览器打开该设备的 DSH」签票，浏览器凭票兑换。
  '/api/remote/webui-ticket',
  '/webui',
  // 会话回推（#155）：已配对设备把本地分支的尾部追加回本机原会话，或用分支内容在本机另起一条。
  '/api/remote/session.push', '/api/remote/session.fork',
  // 设备组网（#156）：同组设备清单、核实介绍凭证、敲门与轮询、经介绍人中转。
  '/api/remote/peers', '/api/remote/intro.verify', '/api/pair/introduce', '/api/pair/introduce.status', '/api/remote/relay',
])


/** 只走保留命名空间、不保留无前缀别名的新路由：新能力一律不进冻结别名，别名集合只收缩不增长。 */
const LANE_NEW_ONLY_PATHS: ReadonlySet<string> = new Set([
  '/api/pair/renew', '/api/pair/ws-token', '/api/remote/session.page',
  '/api/remote/session.watch', '/api/remote/session.unwatch', '/api/remote/interaction.answer',
  '/api/remote/webui-ticket', '/webui',
  // 会话回推（#155）：已配对设备把本地分支的尾部追加回本机原会话，或用分支内容在本机另起一条。
  '/api/remote/session.push', '/api/remote/session.fork',
  // 设备组网（#156）：同组设备清单、核实介绍凭证、敲门与轮询、经介绍人中转。
  '/api/remote/peers', '/api/remote/intro.verify', '/api/pair/introduce', '/api/pair/introduce.status', '/api/remote/relay',
])
/**
 * 冻结的兼容别名（无前缀的历史路径，与 `LANE_ROUTE_PATHS` 一一对应）。
 * 仅为已发出的配对链接与旧客户端存活，**不得新增**。
 */
export const LANE_LEGACY_PATHS: readonly string[] = Object.freeze(
  // renew 与 ws-token 都是「新客户端专用」：前者靠 deviceId 自愈，后者是直连数据面的凭证，
  // 都不需要为已发出的旧链接保留无前缀别名；事件分页、订阅与交互中继同理（别名只收缩不增长）。
  LANE_ROUTE_PATHS.filter((p) => !LANE_NEW_ONLY_PATHS.has(p))
)

/**
 * 判定一次请求是否属于 lane 控制面，并返回其**相对路径**（调方一律按相对路径分派）。
 *
 * 返回 null 表示「不归 lane 管」：调用方必须让请求继续走反代透传——包括 OPTIONS
 * 预检与 dsh 自有路径，lane 绝不代答（这正是「所有 dsh 端口请求全量透传」的落点）。
 *
 * @param path 请求路径（已去掉查询串）
 * @returns lane 相对路径；不属于 lane 时为 null
 */
export function laneRoutePath(path: string | undefined | null): string | null {
  if (typeof path !== 'string' || path.length === 0) return null
  // 容忍末尾斜杠：ArkWeb/WebView 与旧壳的解析器会把入口规范成目录形式。
  // 实机踩过：`/__dsh-mobile/pair/` 不命中路由 → 落到反代门禁 → 401 UNPAIRED
  // （手机上扫完码却显示未配对）。
  const p = path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path
  if (p.startsWith(LANE_PREFIX + '/')) {
    const relative = p.slice(LANE_PREFIX.length)
    return LANE_ROUTE_PATHS.includes(relative) ? relative : null
  }
  // 命名空间本身（无尾斜杠）：只认配对入口，其余按未命中透传。
  if (p === LANE_PREFIX + '/pair') return '/pair'
  return LANE_LEGACY_PATHS.includes(p) ? p : null
}

/** 是否为保留命名空间下的路径（含命名空间根；用于诊断与测试断言）。 */
export function isReservedLanePath(path: string | undefined | null): boolean {
  return typeof path === 'string' && (path === LANE_PREFIX || path.startsWith(LANE_PREFIX + '/'))
}
