import Foundation
import os

/// 壳的日志出口。
///
/// 壳的排障信息（连接、降级链、直连令牌、桥）都走这里：iOS 上 App 的 stdout 不进设备日志，
/// 用 `os.Logger` 才能被 `xcrun simctl spawn log stream` 看到。
enum ShellLog {
    private static let logger = Logger(subsystem: "com.plus.mobile.dsh", category: "shell")

    /// 常规进展（连接成功、降级链走了哪一步）。
    static func info(_ message: String) {
        logger.log("\(message, privacy: .public)")
    }

    /// 可恢复的异常（地址不可达、某次请求失败）。
    static func warn(_ message: String) {
        logger.warning("\(message, privacy: .public)")
    }

    /// 不可恢复的异常（凭证存储不可用、装配失败）。
    static func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }
}
