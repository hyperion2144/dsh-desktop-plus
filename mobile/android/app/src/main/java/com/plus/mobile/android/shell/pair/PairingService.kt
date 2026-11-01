package com.plus.mobile.android.shell.pair

import com.plus.mobile.android.shell.ShellLog
import com.plus.mobile.android.shell.connect.ReachabilityProbe
import com.plus.mobile.android.shell.host.HostEntry
import com.plus.mobile.android.shell.host.HostForm
import com.plus.mobile.android.shell.host.HostRegistry
import com.plus.mobile.android.shell.host.HostStatus
/**
 * 配对流程的编排：链接 → 换设备 ID + 会话 cookie → 落加密存储 → 探测隧道候选。
 *
 * ## 边界
 *
 * - 配对**只认桌面端签发的一次性链接**（扫码 = 用相机读同一个链接），没有任何令牌手输入口；
 * - 凭证（deviceId / cookie）落进加密存储，页面永远拿不到；
 * - 隧道形态的地址条目要过 lane 既有可达性探测（`/api/pair/probe`），结论写进主机条目；
 * - **accept 之前先做无凭证可达性预检**（只连 TCP）：不通的目标不收凭证。
 */
class PairingService(
    private val registry: HostRegistry,
    private val pairing: LanePairingClient,
    /** 配对前的无凭证可达性预检（可替换：测试里换成假的）。 */
    private val prober: ReachabilityProbe = ReachabilityProbe(),
) {

    /**
     * 用一条配对链接完成配对。
     *
     * 候选地址按顺序尝试：某个地址不可达就换下一个；令牌无效（过期 / 已用过）则不再重试
     * ——同一台桌面的多个地址共用同一个令牌，令牌无效对所有候选都无效。
     *
     * **accept 之前先做无凭证预检**：只做一次 TCP 连接，通不过的候选直接剔除——
     * 一次性令牌绝不发给连不上的目标（契约：配对前探测，不把凭证发给不可达目标）。
     */
    suspend fun pair(link: PairLink): PairOutcome {
        val candidates = link.candidates.map { it.trimEnd('/') }.filter { it.isNotBlank() }
        if (candidates.isEmpty()) return PairOutcome.Failed(PairFailure.MALFORMED)

        val reachable = reachableCandidates(candidates)
        if (reachable.isEmpty()) return PairOutcome.Failed(PairFailure.UNREACHABLE)

        var lastFailure = PairFailure.UNREACHABLE
        for (origin in reachable) {
            when (val result = pairing.accept(origin, link.token, DEVICE_NAME)) {
                is LanePairingClient.AcceptOutcome.Accepted -> {
                    val host = buildHost(link, origin, candidates, result)
                    registry.upsert(host)
                    registry.setCurrent(host.id)
                    probeTunnels(host, candidates)
                    ShellLog.info("配对成功：${host.displayName}（${host.laneOrigin}）")
                    return PairOutcome.Paired(host)
                }
                is LanePairingClient.AcceptOutcome.Rejected -> {
                    lastFailure = result.failure
                    if (result.failure == PairFailure.INVALID_TOKEN) {
                        return PairOutcome.Failed(result.failure)
                    }
                }
                is LanePairingClient.AcceptOutcome.Unreachable -> {
                    lastFailure = PairFailure.UNREACHABLE
                }
            }
        }
        return PairOutcome.Failed(lastFailure)
    }

    /**
     * 配对前的无凭证可达性预检：只做 TCP 连接，不带任何凭证。
     *
     * 通不过的候选被剔除（不 accept、不发凭证）；全都不通就直接报不可达。
     */
    private suspend fun reachableCandidates(candidates: List<String>): List<String> {
        val reachable = mutableListOf<String>()
        for (candidate in candidates) {
            if (prober.reachable(candidate)) {
                reachable.add(candidate)
            } else {
                ShellLog.warn("配对候选预检未通过（不发 accept）：$candidate")
            }
        }
        return reachable
    }

    /**
     * 隧道地址的可达性探测（lane 既有 `/api/pair/probe`）。
     *
     * 探测要问一台**已经配对**的 lane（探测端点要求属主或已配对设备），所以用刚配对上的
     * 那台桌面做探测者，探测目标是隧道形态的地址：
     *  - 这台主机本身就是隧道地址 → 探它自己（公网入口通不通）；
     *  - 链接里还有别的隧道候选 → 一并探。
     */
    private suspend fun probeTunnels(host: HostEntry, candidates: List<String>) {
        val tunnels = candidates.filter { HostForm.of(it) == HostForm.TUNNEL }
        if (tunnels.isEmpty()) return
        var reachable: Boolean? = null
        for (tunnel in tunnels) {
            val outcome = pairing.probe(host.laneOrigin, tunnel, host.sessionCookie)
            if (outcome is LanePairingClient.ProbeOutcome.Verdict) {
                reachable = outcome.reachable
                ShellLog.info(
                    "隧道地址探测：$tunnel → ${if (outcome.reachable) "可达" else "不可达"}（${outcome.reason}）",
                )
                break
            }
        }
        if (reachable != null) {
            registry.upsert(host.copy(tunnelReachable = reachable))
        }
    }

    private fun buildHost(
        link: PairLink,
        origin: String,
        candidates: List<String>,
        result: LanePairingClient.AcceptOutcome.Accepted,
    ): HostEntry {
        val form = HostForm.of(origin)
        val label = link.displayName?.takeIf { it.isNotBlank() } ?: defaultLabel(origin)
        return HostEntry(
            id = origin,
            label = label,
            laneOrigin = origin,
            sessionCookie = result.cookie,
            form = form,
            candidates = candidates,
            deviceId = result.deviceId,
            // 一次性令牌在配对成功时已被消费，不再持久化——留在条目里会诱使降级链拿
            // 已用过的令牌去 accept，必然 403，把用户推回重新配对。
            pairToken = null,
            status = HostStatus.CONNECTED,
            statusReason = null,
            pairedAt = System.currentTimeMillis(),
        )
    }

    /** 默认显示名：地址里的主机名（`mutsu-mbp.local` / `192.168.3.90`）。 */
    private fun defaultLabel(origin: String): String =
        origin.substringAfter("://").substringBefore('/').substringBefore(':')

    /** 配对结果。 */
    sealed interface PairOutcome {
        /** 成功：主机条目已落加密存储。 */
        data class Paired(val host: HostEntry) : PairOutcome

        /** 失败：分类决定文案。 */
        data class Failed(val failure: PairFailure) : PairOutcome
    }

    private companion object {
        /** 桌面端设备列表里显示的名字。 */
        const val DEVICE_NAME = "DSH Desktop PlusM"
    }
}
