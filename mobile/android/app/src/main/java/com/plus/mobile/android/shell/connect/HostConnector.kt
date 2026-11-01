package com.plus.mobile.android.shell.connect

import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.boot.BootPayload
import com.plus.mobile.android.shell.boot.BootPayloadException
import com.plus.mobile.android.shell.boot.BootPayloadProvider
import com.plus.mobile.android.shell.boot.HostGateException
import com.plus.mobile.android.shell.boot.HostUnreachableException
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.host.HostRegistry
import com.plus.mobile.android.shell.host.HostStatus
import com.plus.mobile.android.shell.pair.LanePairingClient
import com.plus.mobile.android.shell.pair.PairFailure
import com.plus.mobile.android.shell.pair.WsTokenOutcome

/**
 * 连接一台主机：候选地址重试 + **失效降级链**。
 *
 * ## 降级链（与桌面载体同款语义）
 *
 * 权威参照：`packages/plus/desktop-shell/src/profiles/electron.ts` 的配对恢复段。
 *
 * ```
 * 门禁 unpaired（HTTP 401 {"error":"unpaired"}）
 *   ├─ 有 deviceId → POST /api/pair/renew 静默续期（拿回新的会话 cookie）
 *   ├─ 仍拿不到且有链接内令牌 → POST /api/pair/accept（首次配对 / 令牌仍有效时自愈）
 *   └─ 全败 → 标记「需重新配对」+ 原因文案（区分「设备被移除」与「链接过期」）
 * ```
 *
 * 降级链**静默**：续期成功时用户什么都不用做，页面照常打开。
 */
class HostConnector(
    private val registry: HostRegistry,
    private val payloadProvider: BootPayloadProvider,
    private val pairing: LanePairingClient,
) {

    /**
     * 连接一台主机。
     *
     * 候选地址按「当前地址 → 地址候选列表」的顺序尝试；某个地址不可达就换下一个。
     */
    suspend fun connect(host: HostEntry): ConnectOutcome {
        val candidates = (listOf(host.laneOrigin) + host.candidates)
            .map { it.trim().trimEnd('/') }
            .filter { it.isNotBlank() }
            .distinct()
        if (candidates.isEmpty()) {
            val marked = host.copy(status = HostStatus.OFFLINE, statusReason = "没有可用地址")
            registry.upsert(marked)
            return ConnectOutcome.Offline(marked, "没有可用地址")
        }

        var lastDetail = "无法连接主机"
        for (origin in candidates) {
            when (val attempt = attempt(host, origin)) {
                is Attempt.Loaded -> return connected(host, origin, attempt.payload)
                is Attempt.Gated -> {
                    when (val recovery = recover(host, origin)) {
                        is Recovery.Recovered -> {
                            when (val retry = attempt(recovery.host, origin)) {
                                is Attempt.Loaded -> return connected(recovery.host, origin, retry.payload)
                                is Attempt.Gated -> lastDetail = "主机仍要求重新配对"
                                is Attempt.Unreachable -> lastDetail = retry.detail
                            }
                        }
                        is Recovery.Unreachable -> {
                            // 网络不通不是配对失效：换下一个候选地址，绝不能把用户推回重新配对。
                            lastDetail = recovery.reason
                        }
                        is Recovery.Failed -> {
                            val reason = recovery.reason
                            val marked = host.copy(status = HostStatus.NEEDS_REPAIR, statusReason = reason)
                            registry.upsert(marked)
                            ShellLog.warn("主机 ${host.displayName} 需重新配对：$reason")
                            return ConnectOutcome.NeedsRepair(marked, reason)
                        }
                    }
                }
                is Attempt.Unreachable -> lastDetail = attempt.detail
            }
        }
        val marked = host.copy(status = HostStatus.OFFLINE, statusReason = lastDetail)
        registry.upsert(marked)
        return ConnectOutcome.Offline(marked, lastDetail)
    }

    /** 装载引导载荷的三种结果。 */
    private sealed interface Attempt {
        data class Loaded(val payload: BootPayload) : Attempt
        data object Gated : Attempt
        data class Unreachable(val detail: String) : Attempt
    }

    private suspend fun attempt(host: HostEntry, origin: String): Attempt {
        ShellLog.info(
            "连接尝试：origin=$origin 凭证=${if (host.sessionCookie.isNullOrBlank()) "无" else "有"} " +
                "设备=${host.deviceId ?: "无"}",
        )
        return try {
            val socketBase = socketBaseOf(host, origin)
            Attempt.Loaded(payloadProvider.load(host.copy(laneOrigin = origin), socketBase))
        } catch (error: HostGateException) {
            Attempt.Gated
        } catch (error: HostUnreachableException) {
            Attempt.Unreachable(error.message ?: "无法连接主机")
        } catch (error: BootPayloadException) {
            Attempt.Unreachable(error.message ?: "主机返回异常")
        }
    }

    /**
     * 页面直连 lane 的 WS base：`ws(s)://<lane>/__dsh_ws/<令牌>/`。
     *
     * 令牌签发结果必须分开处理（见 [WsTokenOutcome]）：`Gated`（会话失效）抛门禁异常，
     * 交给既有降级链（renew → accept → 需重新配对）；只有地址/网络失败才是「换候选地址」。
     * 两者合并会让「会话过期」退化成「主机离线」，逼用户重新扫码。
     */
    private suspend fun socketBaseOf(host: HostEntry, origin: String): String {
        return when (val outcome = pairing.wsToken(origin, host.sessionCookie)) {
            is WsTokenOutcome.Token -> LaneSocketBase.baseUrl(origin, outcome.value)
            WsTokenOutcome.Gated -> throw HostGateException("直连令牌被拒（会话失效）")
            WsTokenOutcome.Unreachable -> throw HostUnreachableException("主机未签发直连令牌")
        }
    }

    private fun connected(host: HostEntry, origin: String, payload: BootPayload): ConnectOutcome {
        val updated = host.copy(
            laneOrigin = origin,
            status = HostStatus.CONNECTED,
            statusReason = null,
        )
        registry.upsert(updated)
        return ConnectOutcome.Connected(updated, payload)
    }

    /** 降级链的执行结果。 */
    private sealed interface Recovery {
        /** 拿到了新的会话 cookie（host 非空）。 */
        data class Recovered(val host: HostEntry) : Recovery

        /** 网络不通 / 主机异常：不是配对问题，换下一个候选地址。 */
        data class Unreachable(val reason: String) : Recovery

        /** 服务端明确拒绝（设备被移除 / 令牌失效）：需要用户重新配对。 */
        data class Failed(val reason: String) : Recovery
    }

    /**
     * 门禁拒绝后的降级链。
     *
     * 顺序与桌面载体一致：先静默续期（凭 deviceId），续期不成再试链接内令牌；
     * 两步都拿不到会话，才标记「需重新配对」，并区分原因。
     */
    private suspend fun recover(host: HostEntry, origin: String): Recovery {
        var deviceId = host.deviceId
        var cookie: String? = null
        var removed = false
        var expired = false

        if (!deviceId.isNullOrBlank()) {
            when (val result = pairing.renew(origin, deviceId)) {
                is LanePairingClient.RenewOutcome.Renewed -> {
                    cookie = result.cookie
                    ShellLog.info("降级链·静默续期成功：origin=$origin 设备=$deviceId")
                }
                is LanePairingClient.RenewOutcome.Rejected -> {
                    if (result.failure == PairFailure.DEVICE_REMOVED) removed = true
                    ShellLog.warn("降级链·续期被拒：origin=$origin 设备=$deviceId 原因=${result.failure}")
                }
                is LanePairingClient.RenewOutcome.Unreachable ->
                    // 连不上 / 服务端异常：网络问题，不是配对问题。
                    return Recovery.Unreachable("无法连接主机")
        }
        }

        if (cookie == null && !host.pairToken.isNullOrBlank()) {
            when (val result = pairing.accept(origin, host.pairToken, DEVICE_NAME)) {
                is LanePairingClient.AcceptOutcome.Accepted -> {
                    cookie = result.cookie
                    deviceId = result.deviceId
                }
                is LanePairingClient.AcceptOutcome.Rejected ->
                    if (result.failure == PairFailure.INVALID_TOKEN) expired = true
                is LanePairingClient.AcceptOutcome.Unreachable ->
                    return Recovery.Unreachable("无法连接主机")
        }
        }

        if (cookie != null) {
            val renewed = host.copy(
                sessionCookie = cookie,
                deviceId = deviceId,
                status = HostStatus.CONNECTED,
                statusReason = null,
            )
            registry.upsert(renewed)
            ShellLog.info("静默恢复会话成功：${host.displayName}")
            return Recovery.Recovered(renewed)
        }

        val reason = when {
            removed -> "此设备已被桌面端移除，请重新配对"
            expired -> "配对链接已过期，请重新扫码或复制桌面端的新链接"
            else -> "配对已失效，请重新配对"
        }
        return Recovery.Failed(reason)
    }

    /** 连接结果。 */
    sealed interface ConnectOutcome {
        /** 连上了：主机条目已更新，引导载荷就绪。 */
        data class Connected(val host: HostEntry, val payload: BootPayload) : ConnectOutcome

        /** 门禁拒绝且降级链全败：需要用户重新配对。 */
        data class NeedsRepair(val host: HostEntry, val reason: String) : ConnectOutcome

        /** 连不上。 */
        data class Offline(val host: HostEntry, val reason: String) : ConnectOutcome
    }

    private companion object {
        /** 桌面端设备列表里显示的名字。 */
        const val DEVICE_NAME = "DSH Desktop PlusM"
    }
}
