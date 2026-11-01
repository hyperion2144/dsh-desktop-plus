import Foundation

/// lane 控制面的客户端：配对、续期、隧道地址可达性探测。
///
/// 会话 cookie 由服务端用 `Set-Cookie` 下发（HttpOnly）；壳把它收进 Keychain，
/// **不写进 WebView 的 cookie jar**（spec #55「凭证与安全」）。
/// 非 final：自检里用一个子类记录 accept 的调用次数（断言「不可达时不发 accept」）。
class LanePairingClient {
    private let client: LaneHttpClient

    init(client: LaneHttpClient) {
        self.client = client
    }

    /// 接受配对：把链接里的一次性令牌换成设备 ID + 会话 cookie。
    func accept(origin: String, token: String, deviceName: String) async -> AcceptOutcome {
        guard let url = LaneEndpoint.url(origin: origin, path: "/api/pair/accept") else {
            return .unreachable("地址无法解析")
        }
        let body = try? JSONSerialization.data(withJSONObject: ["token": token, "name": deviceName])
        let response: LaneResponse
        do {
            response = try await client.send(
                LaneRequest(
                    url: url,
                    method: "POST",
                    headers: ["Content-Type": "application/json"],
                    body: body
                )
            )
        } catch {
            return .unreachable(error.localizedDescription)
        }
        switch response.status {
        case 200:
            let cookie = LaneEndpoint.sessionCookie(in: response.headers)
            let deviceId = (try? JSONSerialization.jsonObject(with: response.body) as? [String: Any])?["deviceId"] as? String ?? ""
            guard let cookie, !cookie.isEmpty, !deviceId.isEmpty else {
                return .rejected(.noSession)
            }
            return .accepted(deviceId: deviceId, cookie: cookie)
        case 403:
            return .rejected(.invalidToken)
        default:
            return .rejected(.unexpected)
        }
    }

    /// 续期：凭 deviceId 取回会话 cookie（cookie 丢失 / 被桌面端轮换时的恢复通道）。
    func renew(origin: String, deviceId: String) async -> RenewOutcome {
        guard let url = LaneEndpoint.url(origin: origin, path: "/api/pair/renew") else {
            return .unreachable("地址无法解析")
        }
        let body = try? JSONSerialization.data(withJSONObject: ["deviceId": deviceId])
        let response: LaneResponse
        do {
            response = try await client.send(
                LaneRequest(
                    url: url,
                    method: "POST",
                    headers: ["Content-Type": "application/json"],
                    body: body
                )
            )
        } catch {
            return .unreachable(error.localizedDescription)
        }
        switch response.status {
        case 200:
            guard let cookie = LaneEndpoint.sessionCookie(in: response.headers), !cookie.isEmpty else {
                return .rejected(.noSession)
            }
            return .renewed(cookie: cookie)
        case 403:
            return .rejected(.deviceRemoved)
        default:
            return .rejected(.unexpected)
        }
    }

    /// 取直连令牌：把会话 cookie 换成一个可以放进 URL 的签名令牌。
    ///
    /// WS 无法自定义请求头，而页面 origin（壳回环）与 lane 是**跳站**：
    /// `SameSite=Lax` 的会话 cookie 在跳站握手时根本不会带（改 None 又必须 Secure，lane 是明文）。
    /// 令牌只用于建立数据面连接：lane 验签后还原会话值，沿用既有设备判定；
    /// 不具备 RPC 权限，随会话轮换失效。
    func wsToken(origin: String, cookie: String?) async -> WsTokenOutcome {
        guard let url = LaneEndpoint.url(origin: origin, path: "/api/pair/ws-token") else {
            return .failed("地址无法解析")
        }
        let response: LaneResponse
        do {
            response = try await client.send(
                LaneRequest(
                    url: url,
                    method: "POST",
                    cookie: cookie,
                    headers: ["Content-Type": "application/json"],
                    body: Data("{}".utf8)
                )
            )
        } catch {
            return .failed(error.localizedDescription)
        }
        if response.status == 401 {
            // 门禁拒绝：lane 对这条路由只用 401 回「这台设备没配对 / 会话失效」，
            // 与页面装载命中的是同一道门禁。
            return .gated
        }
        guard response.status == 200 else {
            return .failed("主机返回 HTTP \(response.status)")
        }
        let json = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any]
        guard let token = json?["token"] as? String, !token.isEmpty else {
            return .failed("主机没有签发直连令牌")
        }
        return .issued(token)
    }

    /// 隧道地址可达性探测：问 lane「这个隧道地址的配对入口通不通」。
    ///
    /// 探测请求要带会话 cookie（lane 的作用域两级：属主或已配对设备才能探测）。
    func probe(origin: String, tunnelUrl: String, cookie: String?) async -> ProbeOutcome {
        guard let url = LaneEndpoint.url(
            origin: origin,
            path: "/api/pair/probe",
            query: [URLQueryItem(name: "url", value: tunnelUrl)]
        ) else {
            return .unreachable("地址无法解析")
        }
        let response: LaneResponse
        do {
            response = try await client.send(LaneRequest(url: url, cookie: cookie))
        } catch {
            return .unreachable(error.localizedDescription)
        }
        guard response.status == 200 else { return .rejected }
        let json = (try? JSONSerialization.jsonObject(with: response.body)) as? [String: Any]
        return .verdict(
            reachable: json?["ok"] as? Bool ?? false,
            reason: json?["reason"] as? String ?? ""
        )
    }

    /// 接受配对的结果。
    enum AcceptOutcome {
        /// 成功：设备 ID + 会话 cookie。
        case accepted(deviceId: String, cookie: String)
        /// 被拒绝（令牌无效 / 没给会话）。
        case rejected(PairFailure)
        /// 主机不可达。
        case unreachable(String)
    }

    /// 续期的结果。
    enum RenewOutcome {
        /// 成功：新的会话 cookie。
        case renewed(cookie: String)
        /// 被拒绝（设备已被移除 / 没给会话）。
        case rejected(PairFailure)
        /// 主机不可达。
        case unreachable(String)
    }

    /// 探测的结果。
    enum ProbeOutcome {
        /// 探测有结论。
        case verdict(reachable: Bool, reason: String)
        /// 探测本身被拒绝（未配对等）。
        case rejected
        /// 主机不可达。
        case unreachable(String)
    }

    /// 直连令牌的结果。
    enum WsTokenOutcome {
        /// 签发成功：令牌文本。
        case issued(String)
        /// 门禁拒绝（HTTP 401）：这台设备没配对或会话失效了——降级链的入口。
        case gated
        /// 其他失败（网络不通 / 服务端异常）：本次地址不可用。
        case failed(String)
    }
}
