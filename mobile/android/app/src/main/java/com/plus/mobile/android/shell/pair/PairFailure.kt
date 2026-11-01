package com.plus.mobile.android.shell.pair

/**
 * 配对失败的分类。
 *
 * 分开的理由：失败文案必须区分「链接过期」与「设备被移除」——两者的补救动作不同
 * （前者去桌面端重新取链接，后者要桌面端重新允许这台设备）。
 */
enum class PairFailure {

    /** 链接里的令牌无效 / 已过期 / 已被用过（一次性令牌）。 */
    INVALID_TOKEN,

    /** 桌面端把这台设备移除了（续期时 deviceId 查无此设备）。 */
    DEVICE_REMOVED,

    /** 服务端没有下发会话 cookie（不该发生，视为失败）。 */
    NO_SESSION,

    /** 主机地址不可达。 */
    UNREACHABLE,

    /** 其它 HTTP 状态。 */
    UNEXPECTED,

    /** 链接格式无法识别。 */
    MALFORMED,
}
