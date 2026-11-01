import SwiftUI

/// 生物锁屏（原型定稿第④屏）。
///
/// 三个触发场景共用这一屏：冷启动 / 后台超时回前台 / 敏感操作（配对、删主机）。
/// 不可绕过：唯一出口是验证通过（设备既没生物特征也没 PIN 时放行并记录，
/// 否则用户会被自己的 App 锁死）。
struct LockView: View {
    @ObservedObject var controller: ShellController

    var body: some View {
        ZStack {
            DesignTokens.bgBase.ignoresSafeArea()
            VStack(spacing: 10) {
                Text("D")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 74, height: 74)
                    .background(DesignTokens.brand)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
                    .padding(.bottom, 6)
                 Text("DSH Desktop PlusM 已锁定")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.labelPrimary)
                Text(ShellController.lockMessage(for: controller.lockReason ?? .cold))
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                Button {
                    controller.authenticate()
                } label: {
                    Text("验证")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.labelPrimary)
                        .frame(width: 66, height: 66)
                        .background(DesignTokens.bgChip)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(DesignTokens.borderL2, lineWidth: 1))
                }
                .padding(.top, 8)
                Text("真机为指纹 / 面容；不可用时回退到设备 PIN")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
            }
        }
    }
}
