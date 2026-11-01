import Foundation

/// 连接一台主机：候选地址重试 + **失效降级链**。
///
/// ## 降级链（与桌面载体同款语义）
///
/// 权威参照：`packages/plus/desktop-shell/src/profiles/electron.ts` 的配对恢复段。
///
/// ```
/// 门禁 unpaired（HTTP 401 {"error":"unpaired"}）
///   ├─ 有 deviceId → POST /api/pair/renew 静默续期（拿回新的会话 cookie）
///   ├─ 仍拿不到且有链接内令牌 → POST /api/pair/accept（首次配对 / 令牌仍有效时自愈）
///   └─ 全败 → 标记「需重新配对」+ 原因文案（区分「设备被移除」与「链接过期」）
/// ```
///
/// 降级链**静默**：续期成功时用户什么都不用做，页面照常打开。
final class HostConnector {
    private let registry: HostRegistry
    private let payloadProvider: BootPayloadProvider
    private let pairing: LanePairingClient

    init(
        registry: HostRegistry,
        payloadProvider: BootPayloadProvider,
        pairing: LanePairingClient
    ) {
        self.registry = registry
        self.payloadProvider = payloadProvider
        self.pairing = pairing
    }

    /// 连接一台主机。
    ///
    /// 候选地址按「当前地址 → 地址候选列表」的顺序尝试；某个地址不可达就换下一个。
    func connect(_ host: HostEntry) async -> ConnectOutcome {
        let candidates = HostCandidates.orderedForPlatform(
            ([host.laneOrigin] + host.candidates).map { OriginAddress.normalized($0) }
        )
        guard !candidates.isEmpty else {
            var marked = host
            marked.status = .offline
            marked.statusReason = "没有可用地址"
            registry.upsert(marked)
            return .offline(marked, "没有可用地址")
        }

        var lastDetail = "无法连接主机"
        for origin in candidates {
            switch await attempt(host, origin) {
            case .loaded(let payload):
                return connected(host, origin, payload)
            case .gated:
                switch await recover(host, origin) {
                case .recovered(let recoveredHost):
                    switch await attempt(recoveredHost, origin) {
                    case .loaded(let payload):
                        return connected(recoveredHost, origin, payload)
                    case .gated:
                        lastDetail = "主机仍要求重新配对"
                    case .unreachable(let detail):
                        lastDetail = detail
                    }
                case .unreachable(let reason):
                    // 网络不通不是配对失效：换下一个候选地址，绝不能把用户推回重新配对。
                    lastDetail = reason
                case .failed(let reason):
                    var marked = host
                    marked.status = .needsRepair
                    marked.statusReason = reason
                    registry.upsert(marked)
                    ShellLog.warn("主机 \(host.displayName) 需重新配对：\(reason)")
                    return .needsRepair(marked, reason)
                }
            case .unreachable(let detail):
                lastDetail = detail
            }
        }
        var marked = host
        marked.status = .offline
        marked.statusReason = lastDetail
        registry.upsert(marked)
        return .offline(marked, lastDetail)
    }

    /// 装载引导载荷的三种结果。
    private enum Attempt {
        case loaded(BootPayload)
        case gated
        case unreachable(String)
    }

    private func attempt(_ host: HostEntry, _ origin: String) async -> Attempt {
        ShellLog.info(
            "连接尝试：origin=\(origin) 凭证=\(host.sessionCookie?.isEmpty == false ? "有" : "无") "
                + "设备=\(host.deviceId ?? "无")"
        )
        var candidate = host
        candidate.laneOrigin = origin
        do {
            let socketBase = try await socketBaseOf(candidate, origin)
            let payload = try await payloadProvider.load(host: candidate, socketBaseUrl: socketBase)
            return .loaded(payload)
        } catch let error as BootPayloadError {
            switch error {
            case .gated:
                return .gated
            case .unreachable(let detail), .malformed(let detail):
                return .unreachable(detail)
            }
        } catch {
            return .unreachable(error.localizedDescription)
        }
    }

    /// 页面直连 lane 的 WS base：`ws(s)://<lane>/__dsh_ws/<令牌>/`。
    ///
    /// 末尾斜杠是硬要求：页面用 `new URL('api/remote.mux', base)` 相对解析，
    /// 少了它 `__dsh_ws/<令牌>` 整段会被当成文件名吃掉（令牌也一同丢失）。
    ///
    /// 令牌签发失败即本次地址不可用：数据面只有直连这一条路，没有壳内中继可退。
    /// 例外是 401（门禁）：那是「这台设备没配对 / 会话失效」，与页面装载命中同一道门禁，
    /// 要走降级链自愈，不能当成地址不通把用户推回重新配对。
    private func socketBaseOf(_ host: HostEntry, _ origin: String) async throws -> String {
        let token: String
        switch await pairing.wsToken(origin: origin, cookie: host.sessionCookie) {
        case .issued(let issued):
            token = issued
        case .gated:
            throw BootPayloadError.gated("主机要求重新配对：\(host.displayName)")
        case .failed(let detail):
            throw BootPayloadError.unreachable(detail)
        }
        let components = URLComponents(string: OriginAddress.normalized(origin))
        let scheme = (components?.scheme ?? "http").lowercased() == "https" ? "wss" : "ws"
        // URLComponents 的 host 不带 IPv6 方括号，而 URL 里必须带。
        let host = components?.host ?? ""
        let literal = host.contains(":") ? "[\(host)]" : host
        let authority = components?.port.map { "\(literal):\($0)" } ?? literal
        return "\(scheme)://\(authority)\(ShellSettings.laneWsPrefix)\(token)/"
    }

    private func connected(_ host: HostEntry, _ origin: String, _ payload: BootPayload) -> ConnectOutcome {
        var updated = host
        updated.laneOrigin = origin
        updated.status = .connected
        updated.statusReason = nil
        registry.upsert(updated)
        return .connected(updated, payload)
    }

    /// 降级链的执行结果。
    private enum Recovery {
        /// 拿到了新的会话 cookie。
        case recovered(HostEntry)
        /// 网络不通 / 主机异常：不是配对问题，换下一个候选地址。
        case unreachable(String)
        /// 服务端明确拒绝（设备被移除 / 令牌失效）：需要用户重新配对。
        case failed(String)
    }
    /// 门禁拒绝后的降级链。
    ///
    /// 顺序与桌面载体一致：先静默续期（凭 deviceId），续期不成再试链接内令牌；
    /// 两步都拿不到会话，才标记「需重新配对」，并区分原因。
    private func recover(_ host: HostEntry, _ origin: String) async -> Recovery {
        var deviceId = host.deviceId
        var cookie: String?
        var removed = false
        var expired = false

        if let deviceId, !deviceId.isEmpty {
            switch await pairing.renew(origin: origin, deviceId: deviceId) {
            case .renewed(let renewed):
                cookie = renewed
                ShellLog.info("降级链·静默续期成功：origin=\(origin) 设备=\(deviceId)")
            case .rejected(let failure):
                if failure == .deviceRemoved { removed = true }
                ShellLog.warn("降级链·续期被拒：origin=\(origin) 设备=\(deviceId) 原因=\(failure)")
            case .unreachable:
                // 连不上 / 服务端异常：网络问题，不是配对问题。
                return .unreachable("无法连接主机")
            }
        }

        if cookie == nil, let pairToken = host.pairToken, !pairToken.isEmpty {
            switch await pairing.accept(origin: origin, token: pairToken, deviceName: Self.deviceName) {
            case .accepted(let acceptedDeviceId, let acceptedCookie):
                cookie = acceptedCookie
                deviceId = acceptedDeviceId
            case .rejected(let failure):
                if failure == .invalidToken { expired = true }
            case .unreachable:
                return .unreachable("无法连接主机")
            }
        }

        if let cookie {
            var renewed = host
            renewed.sessionCookie = cookie
            renewed.deviceId = deviceId
            renewed.status = .connected
            renewed.statusReason = nil
            registry.upsert(renewed)
            ShellLog.info("静默恢复会话成功：\(host.displayName)")
            return .recovered(renewed)
        }

        let reason: String
        if removed {
            reason = "此设备已被桌面端移除，请重新配对"
        } else if expired {
            reason = "配对链接已过期，请重新扫码或复制桌面端的新链接"
        } else {
            reason = "配对已失效，请重新配对"
        }
        return .failed(reason)
    }

    /// 桌面端设备列表里显示的名字。
    private static let deviceName = "DSH Desktop PlusM"

    /// 连接结果。
    enum ConnectOutcome {
        /// 连上了：主机条目已更新，引导载荷就绪。
        case connected(HostEntry, BootPayload)
        /// 门禁拒绝且降级链全败：需要用户重新配对。
        case needsRepair(HostEntry, String)
        /// 连不上。
        case offline(HostEntry, String)
    }
}
