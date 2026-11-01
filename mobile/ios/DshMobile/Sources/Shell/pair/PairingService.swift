import Foundation

/// 配对流程的编排：链接 → 换设备 ID + 会话 cookie → 落 Keychain → 探测隧道候选。
///
/// ## 边界
///
/// - 配对**只认桌面端签发的一次性链接**（扫码 = 用相机读同一个链接），没有任何令牌手输入口；
/// - 凭证（deviceId / cookie）落进 Keychain，页面永远拿不到；
/// - 隧道形态的地址条目要过 lane 既有可达性探测（`/api/pair/probe`），结论写进主机条目；
/// - **accept 之前先做无凭证可达性预检**（只连 TCP）：不通的目标不收凭证。
final class PairingService {
    private let registry: HostRegistry
    private let pairing: LanePairingClient
    /// 配对前的无凭证可达性预检。
    private let prober: ReachabilityProbe

    init(
        registry: HostRegistry,
        pairing: LanePairingClient,
        prober: ReachabilityProbe = ReachabilityProbe()
    ) {
        self.registry = registry
        self.pairing = pairing
        self.prober = prober
    }

    /// 用一条配对链接完成配对。
    ///
    /// 候选地址按顺序尝试：某个地址不可达就换下一个；令牌无效（过期 / 已用过）则不再重试
    /// ——同一台桌面的多个地址共用同一个令牌，令牌无效对所有候选都无效。
    ///
    /// **accept 之前先做无凭证预检**：只做一次 TCP 连接，通不过的候选直接剔除——
    /// 一次性令牌绝不发给连不上的目标（契约：配对前探测，不把凭证发给不可达目标）。
    func pair(link: PairLink) async -> PairOutcome {
        let candidates = link.candidates
            .map { OriginAddress.normalized($0) }
            .filter { !$0.isEmpty }
        guard !candidates.isEmpty else { return .failed(.malformed) }

        let reachable = await reachableCandidates(candidates)
        guard !reachable.isEmpty else { return .failed(.unreachable) }

        var lastFailure = PairFailure.unreachable
        for origin in reachable {
            let result = await pairing.accept(origin: origin, token: link.token, deviceName: Self.deviceName)
            switch result {
            case .accepted(let deviceId, let cookie):
                let host = buildHost(link: link, origin: origin, candidates: candidates, deviceId: deviceId, cookie: cookie)
                registry.upsert(host)
                registry.setCurrent(id: host.id)
                await probeTunnels(host: host, candidates: candidates)
                ShellLog.info("配对成功：\(host.displayName)（\(host.laneOrigin)）")
                return .paired(host)
            case .rejected(let failure):
                lastFailure = failure
                if failure == .invalidToken { return .failed(failure) }
            case .unreachable(let detail):
                lastFailure = .unreachable
                ShellLog.warn("配对候选不可达：\(origin)（\(detail)）")
            }
        }
        return .failed(lastFailure)
    }

    /// 配对前的无凭证可达性预检：只做 TCP 连接，不带任何凭证。
    ///
    /// 通不过的候选被剔除（不 accept、不发凭证）；全都不通就直接报不可达。
    private func reachableCandidates(_ candidates: [String]) async -> [String] {
        var reachable: [String] = []
        for candidate in candidates {
            if await prober.reachable(origin: candidate) {
                reachable.append(candidate)
            } else {
                ShellLog.warn("配对候选预检未通过（不发 accept）：\(candidate)")
            }
        }
        return reachable
    }

    /// 隧道地址的可达性探测（lane 既有 `/api/pair/probe`）。
    ///
    /// 探测要问一台**已经配对**的 lane，所以用刚配对上的那台桌面做探测者，
    /// 探测目标是隧道形态的地址。
    private func probeTunnels(host: HostEntry, candidates: [String]) async {
        let tunnels = candidates.filter { HostForm.of(origin: $0) == .tunnel }
        guard !tunnels.isEmpty else { return }
        for tunnel in tunnels {
            let outcome = await pairing.probe(
                origin: host.laneOrigin,
                tunnelUrl: tunnel,
                cookie: host.sessionCookie
            )
            if case .verdict(let reachable, let reason) = outcome {
                ShellLog.info("隧道地址探测：\(tunnel) → \(reachable ? "可达" : "不可达")（\(reason)）")
                var updated = host
                updated.tunnelReachable = reachable
                registry.upsert(updated)
                return
            }
        }
    }

    private func buildHost(
        link: PairLink,
        origin: String,
        candidates: [String],
        deviceId: String,
        cookie: String
    ) -> HostEntry {
        let label = link.displayName?.isEmpty == false ? link.displayName! : defaultLabel(origin)
        return HostEntry(
            id: origin,
            label: label,
            laneOrigin: origin,
            sessionCookie: cookie,
            form: HostForm.of(origin: origin),
            candidates: candidates,
            deviceId: deviceId,
            // 一次性令牌在配对成功时已被消费，不再持久化——留在条目里会诱使降级链拿
            // 已用过的令牌去 accept，必然 403，把用户推回重新配对。
            pairToken: nil,
            status: .connected,
            statusReason: nil,
            pairedAt: Date().timeIntervalSince1970 * 1000
        )
    }

    /// 默认显示名：地址里的主机名（`mutsu-mbp.local` / `192.168.3.90`）。
    private func defaultLabel(_ origin: String) -> String {
        OriginAddress.host(of: origin)
    }

    /// 桌面端设备列表里显示的名字。
    private static let deviceName = "DSH Desktop PlusM"

    /// 配对结果。
    enum PairOutcome {
        /// 成功：主机条目已落 Keychain。
        case paired(HostEntry)
        /// 失败：分类决定文案。
        case failed(PairFailure)
    }
}
