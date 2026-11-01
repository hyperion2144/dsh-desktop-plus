import Foundation

/// 外观模式（原生 UI 主题）。
enum AppearanceMode: String {
    /// 跟随系统深浅。
    case system
    /// 固定浅色。
    case light
    /// 固定深色。
    case dark
}

/// 壳的非凭证偏好与更新提醒状态。
///
/// 与凭证同库存放（同一个 Keychain service）：偏好本身不敏感，但同库意味着「壳只有一处持久化」，
/// Keychain 不可用时偏好与凭证一起失效，语义一致。
///
/// 更新提醒语义（开关 / 拉黑版本 / 已提醒最高版本）复用桌面 `update-notice` 契约
/// （`packages/plus/desktop-plugin/contracts/updates.ts` 的 `UpdateNoticeState`）。
final class ShellPreferences {
    private let store: KeyValueStore

    init(store: KeyValueStore) {
        self.store = store
    }

    /// 生物锁开关：**默认开**（spec #55「安全」：App 级锁默认开，可关）。
    var biometricLockEnabled: Bool {
        get { store.bool(forKey: Key.biometricLock, default: true) }
        set { store.setBool(newValue, forKey: Key.biometricLock) }
    }

    /// 更新提醒总开关：**默认开**（桌面 update-notice 契约同款：总开关默认开；Android 壳同此）。
    ///
    /// 只改默认值——已经存过的用户值原样保留（存过 false 的仍然是 false）。
    var updateReminderEnabled: Bool {
        get { store.bool(forKey: Key.updateReminder, default: true) }
        set { store.setBool(newValue, forKey: Key.updateReminder) }
    }

    /// 被拉黑的版本（不再提醒这个版本）。
    var ignoredUpdateVersions: [String] {
        get { store.string(forKey: Key.ignoredVersions).map(parseList) ?? [] }
        set { store.setString(newValue.joined(separator: "\n"), forKey: Key.ignoredVersions) }
    }

    /// 已提醒过的最高版本（高于它的版本才再提醒）。
    var lastNotifiedUpdateVersion: String? {
        get { store.string(forKey: Key.lastNotified) }
        set { store.setString(newValue, forKey: Key.lastNotified) }
    }

    /// 外观模式：原生界面主题跟随系统或固定深浅（默认跟随系统）。
    var appearanceMode: AppearanceMode {
        get { AppearanceMode(rawValue: store.string(forKey: Key.appearance) ?? "") ?? .system }
        set { store.setString(newValue.rawValue, forKey: Key.appearance) }
    }

    private func parseList(_ raw: String) -> [String] {
        raw.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
    }

    private enum Key {
        static let biometricLock = "pref.biometric_lock"
        static let appearance = "pref.appearance"
        static let updateReminder = "pref.update_reminder"
        static let ignoredVersions = "pref.update_ignored_versions"
        static let lastNotified = "pref.update_last_notified"
    }
}
