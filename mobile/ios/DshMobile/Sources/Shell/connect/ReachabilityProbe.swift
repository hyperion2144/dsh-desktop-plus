import Foundation
import Network

/// 无凭证可达性预检：**只做一次 TCP 连接**。
///
/// ## 为什么在 accept 之前
///
/// 配对链接里的地址可能根本不通（地址写错、换了网络、桌面没开机）。
/// 旧流程先发 accept（带一次性令牌）才发现连不上——凭证已经发给了不可达甚至错误的目标。
/// 契约要求「配对前探测，不把凭证发给不可达目标」，所以这里先探一次：
/// **只连 TCP，不发任何 HTTP 请求，更不带任何凭证**。
///
/// 预检只回答「值不值得把凭证发过去」：连得上就算可达，其余（连不上、超时、
/// 地址解析不出）一律算不可达。
final class ReachabilityProbe {
    /// 预检超时（秒）：预检要快——不通就立刻停，不让用户干等。
    private let timeout: TimeInterval

    init(timeout: TimeInterval = 2) {
        self.timeout = timeout
    }

    /// 目标是否可达（连得上就算可达）。
    func reachable(origin: String) async -> Bool {
        let host = OriginAddress.host(of: origin)
        guard !host.isEmpty,
              let rawPort = OriginAddress.port(of: origin),
              let port = NWEndpoint.Port(rawValue: rawPort)
        else { return false }
        return await connect(host: host, port: port)
    }

    /// 一次 TCP 连接：连上即可达。
    private func connect(host: String, port: NWEndpoint.Port) async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let queue = DispatchQueue(label: "com.plus.mobile.dsh.reachability")
            let claim = Claim()
            let connection = NWConnection(
                host: NWEndpoint.Host(host),
                port: port,
                using: .tcp
            )
            func finish(_ reachable: Bool) {
                // 超时与连接结果赛跑时只认第一个结论。
                guard claim.claim() else { return }
                connection.cancel()
                continuation.resume(returning: reachable)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(true)
                case .failed, .cancelled:
                    finish(false)
                default:
                    break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { finish(false) }
        }
    }
}

/// 只让一个收尾动作生效（并发回调里的一次性门闩）。
private final class Claim {
    private let lock = NSLock()
    private var claimed = false

    /// 第一次调用返回 true；之后都是 false。
    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if claimed { return false }
        claimed = true
        return true
    }
}
