/**
 * 配对失败的分类。
 *
 * 分开的理由：失败文案必须区分「链接过期」与「设备被移除」——两者的补救动作不同
 * （前者去桌面端重新取链接，后者要桌面端重新允许这台设备）。
 */
export type PairFailureCode =
  /** 链接里的令牌无效 / 已过期 / 已被用过（一次性令牌）。 */
  | 'invalid-token'
  /** 桌面端把这台设备移除了（续期时 deviceId 查无此设备）。 */
  | 'device-removed'
  /** 服务端没有下发会话 cookie（不该发生，视为失败）。 */
  | 'no-session'
  /** 主机地址不可达。 */
  | 'unreachable'
  /** 其它 HTTP 状态。 */
  | 'unexpected'
  /** 链接格式无法识别。 */
  | 'malformed';
