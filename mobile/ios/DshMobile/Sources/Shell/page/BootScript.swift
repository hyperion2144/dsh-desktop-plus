import Foundation

/// 壳内引导脚本（App bundle 里的 `shell/boot.js`）。
enum BootScript {
    /// 脚本内容；缺文件时为空串（页面会因没有引导载荷而停在加载态，并写日志）。
    static let source: String = {
        let directory = Bundle.main.url(
            forResource: ShellSettings.bootScriptDirectoryName,
            withExtension: nil
        )
        let file = directory?.appendingPathComponent(ShellSettings.bootScriptFileName)
        guard let file, let text = try? String(contentsOf: file, encoding: .utf8) else {
            ShellLog.error(
                "壳内缺少引导脚本（\(ShellSettings.bootScriptDirectoryName)/\(ShellSettings.bootScriptFileName)）"
            )
            return ""
        }
        return text
    }()
}
