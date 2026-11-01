import Foundation

/// App 级生物锁的状态机。
///
/// ## 三个触发场景（spec #55「生物锁」）
///
/// 1. **冷启动**：进程刚起来时 `unlocked = false`，第一次回前台必然要求验证；
/// 2. **后台超 1 分钟回前台**：`onBackground()` 记下离开时刻，回前台超过
///    `backgroundTimeout` 就重新上锁；
/// 3. **敏感操作**（配对 / 删主机）：调用 `lock()` 主动上锁，验证通过才继续。
///
/// **切主机不触发**：切换主机在同一个界面内完成，不经过后台/冷启动路径。
///
/// 开关默认开（`ShellPreferences.biometricLockEnabled`），可关。
final class LockController {
    /// 触发验证的原因（锁屏文案据此区分）。
    enum Reason {
        /// 冷启动：进程刚起来，尚未验证过。
        case cold
        /// 后台超时回前台。
        case background
        /// 敏感操作（配对 / 删主机）。
        case sensitive
    }

    private let preferences: ShellPreferences
    private let lock = NSLock()
    private var unlocked = false
    /// 离开前台的时刻（0 = 没离开过）。
    private var backgroundedAt: Date?

    init(preferences: ShellPreferences) {
        self.preferences = preferences
    }

    /// 开关：默认开，可关。关掉时锁整体失效。
    var enabled: Bool {
        get { preferences.biometricLockEnabled }
        set {
            preferences.biometricLockEnabled = newValue
            if !newValue { unlock() }
        }
    }

    /// 记下离开前台的时刻。
    func onBackground() {
        lock.lock()
        defer { lock.unlock() }
        backgroundedAt = Date()
        ShellLog.info("离开前台：记下时刻")
    }

    /// 回前台：判断这次要不要验证，并给出触发原因。
    ///
    /// 副作用：清掉离开时刻（同一个前台周期只判一次）。
    ///
    /// - Returns: nil = 不需要验证；否则是触发原因。
    func needsUnlock() -> Reason? {
        lock.lock()
        defer { lock.unlock() }
        if !enabled {
            unlocked = true
            return nil
        }
        let elapsed = backgroundedAt.map { Date().timeIntervalSince($0) } ?? 0
        backgroundedAt = nil
        let reason: Reason?
        if elapsed > Self.backgroundTimeout {
            unlocked = false
            reason = .background
        } else if unlocked {
            reason = nil
        } else {
            reason = .cold
        }
        ShellLog.info("回前台：离开 \(Int(elapsed * 1000))ms → \(reason.map(String.init(describing:)) ?? "无需验证")")
        return reason
    }

    /// 验证通过。
    func unlock() {
        lock.lock()
        defer { lock.unlock() }
        unlocked = true
    }

    /// 主动上锁（敏感操作前）。
    func lockNow() {
        lock.lock()
        defer { lock.unlock() }
        unlocked = false
    }

    /// 后台超时阈值：1 分钟（原型定稿：「离开超过 1 分钟」）。
    static let backgroundTimeout: TimeInterval = 60
}
