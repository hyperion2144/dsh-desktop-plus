import Foundation
import LocalAuthentication

/// 生物识别验证的门。
///
/// ## 为什么用 `deviceOwnerAuthentication`
///
/// - 它是「生物识别（Face ID / Touch ID）+ 设备密码」的组合策略：生物识别失败或不可用时，
///   系统自动回退到设备密码界面——这正是 spec #55 要求的「PIN 回退」；
/// - 锁屏上的「使用 PIN 解锁」入口由系统的回退按钮承担（`localizedFallbackTitle`）。
///
/// 与 Android 的 `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` 同构：**强生物特征 + 设备凭据**。
final class BiometricGate {
    /// 设备上是否还有可用的验证方式（生物识别或设备密码）。
    func available() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
    }

    /// 发起验证；结果回调到 `completion`。
    ///
    /// - Parameter completion: true = 通过；false = 失败或用户取消。
    func authenticate(title: String, subtitle: String, completion: @escaping (Bool) -> Void) {
        let context = LAContext()
        context.localizedFallbackTitle = "使用 PIN 解锁"
        context.localizedCancelTitle = "取消"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            ShellLog.warn("设备没有可用的验证方式：\(error?.localizedDescription ?? "未知原因")")
            completion(false)
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: subtitle) { success, evaluationError in
            if let evaluationError {
                ShellLog.info("生物锁验证未通过：\(evaluationError.localizedDescription)")
            }
            completion(success)
        }
    }
}
