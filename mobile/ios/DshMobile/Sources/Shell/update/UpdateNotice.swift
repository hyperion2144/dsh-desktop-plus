import Foundation

/// 更新源（移动端元数据 + 下载页）。
///
/// spec #55「更新与发版」：更新源复用桌面已选的 channel feed 机制——同一 Release 内
/// 额外发布移动端元数据文件（按平台一份），启动检查只拉这个小文件。
/// iOS 侧**只提示并跳转**（平台不允许应用内安装），文案引导用户用 SideStore 重新导入。
enum UpdateFeed {
    /// 移动端更新元数据：与桌面 channel feed 同形——同一个 GitHub Release 里多发一份，
    /// iOS 一份 `nightly-ios.yml`（桌面发的是 `nightly.yml` / `nightly-mac.yml` / …）。
    /// 拉取只碰这一个几百字节的小文件，不走 api.github.com 的额度池。
    static let metadataURL = URL(string: "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-ios.yml")!

    /// 下载页（跳转形态的目标）。
    static let releasesURL = URL(string: "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest")!

    /// 产物下载地址的基址（元数据里的 `files[].url` 是**文件名**，相对它拼接）。
    static let downloadBaseURL = URL(string: "https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/")!

    /// 元数据的内容（字段与桌面 channel yml 同形）。
    struct Metadata {
        /// plus 版本号。
        let version: String
        /// 产物文件名（`files[0].url`）。
        let fileName: String?
        /// 产物字节数。
        let size: Int?
    }

    /// 解析 channel yml。
    ///
    /// 元数据只有固定的几行（`version` / `files[].url` / `files[].size` / `path`），
    /// 为它引入一个 YAML 依赖不划算——这里按行读；形状不认识就当没有更新（静默降级）。
    static func parse(_ text: String) -> Metadata? {
        var version: String?
        var fileName: String?
        var size: Int?
        var inFiles = false
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("version:") {
                version = line.dropFirst("version:".count).trimmingCharacters(in: .whitespaces)
                inFiles = false
                continue
            }
            if line.hasPrefix("files:") {
                inFiles = true
                continue
            }
            if line.hasPrefix("path:") {
                if fileName == nil {
                    fileName = line.dropFirst("path:".count).trimmingCharacters(in: .whitespaces)
                }
                inFiles = false
                continue
            }
            if inFiles {
                if line.hasPrefix("- url:") {
                    fileName = line.dropFirst("- url:".count).trimmingCharacters(in: .whitespaces)
                } else if line.hasPrefix("size:") {
                    size = Int(line.dropFirst("size:".count).trimmingCharacters(in: .whitespaces))
                }
            }
        }
        guard let version, !version.isEmpty else { return nil }
        return Metadata(version: version, fileName: fileName, size: size)
    }
}

/// 更新提醒（iOS 形态：仅提示 + 跳转）。
///
/// 提醒语义（开关 / 拉黑版本 / 已提醒最高版本）复用桌面 update-notice 契约
/// （`packages/plus/desktop-plugin/contracts/updates.ts` 的 `UpdateNoticeState`）。
///
/// 拉不到元数据时**静默降级**：不弹窗、不报错、不阻塞启动。
final class UpdateNotice {
    private let preferences: ShellPreferences
    private let session: URLSession

    init(preferences: ShellPreferences, session: URLSession = .shared) {
        self.preferences = preferences
        self.session = session
    }

    /// 检查有没有新版本。
    ///
    /// - Parameter currentVersion: 当前壳版本。
    /// - Returns: 有新版本时给出提醒；否则 nil（包含「拉不到元数据」与「已是最新」两种情况）。
    func check(currentVersion: String) async -> Notice? {
        guard preferences.updateReminderEnabled else { return nil }
        guard let metadata = await fetchMetadata() else { return nil }
        // 比较走 SemVer 优先级（与 node 侧 `comparePlusVersions`、Kotlin 侧
        // `MobileVersion.compare` 同一套规则）：非法版本一律当作「没有更新」。
        guard let newer = try? ShellVersion.compareVersions(metadata.version, currentVersion),
              newer > 0 else {
            return nil
        }
        if preferences.ignoredUpdateVersions.contains(metadata.version) { return nil }
        if let last = preferences.lastNotifiedUpdateVersion,
           let result = try? ShellVersion.compareVersions(metadata.version, last),
           result <= 0 {
            return nil
        }
        preferences.lastNotifiedUpdateVersion = metadata.version
        return Notice(
            version: metadata.version,
            downloadURL: metadata.fileName
                .flatMap { URL(string: UpdateFeed.downloadBaseURL.absoluteString + $0) }
                ?? UpdateFeed.releasesURL
        )
    }

    /// 把某个版本拉黑（不再提醒）。
    func ignore(version: String) {
        var versions = preferences.ignoredUpdateVersions
        if !versions.contains(version) { versions.append(version) }
        preferences.ignoredUpdateVersions = versions
    }

    private func fetchMetadata() async -> UpdateFeed.Metadata? {
        var request = URLRequest(url: UpdateFeed.metadataURL)
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                return nil
            }
            guard let text = String(data: data, encoding: .utf8) else { return nil }
            return UpdateFeed.parse(text)
        } catch {
            ShellLog.warn("更新元数据拉取失败：\(error.localizedDescription)")
            return nil
        }
    }

    /// 一条更新提醒。
    struct Notice {
        /// 新版本号。
        let version: String
        /// 跳转目标（下载页）。
        let downloadURL: URL
    }
}
