import Foundation

/// 引导载荷的存放处：页面在 document-start 取的那份数据，由壳在装载页面前写入。
///
/// 换主机时载荷整体换掉：页面随之重载，重新取一份。
final class BootPayloadStore {
    private let lock = NSLock()
    private var payload: BootPayload?

    /// 写入载荷。
    func set(_ payload: BootPayload) {
        lock.lock()
        defer { lock.unlock() }
        self.payload = payload
    }

    /// 取当前载荷；未就绪时为 nil。
    func get() -> BootPayload? {
        lock.lock()
        defer { lock.unlock() }
        return payload
    }

    /// 清空载荷（换主机时用，避免页面拿到上一台主机的注入行）。
    func clear() {
        lock.lock()
        defer { lock.unlock() }
        payload = nil
    }
}
