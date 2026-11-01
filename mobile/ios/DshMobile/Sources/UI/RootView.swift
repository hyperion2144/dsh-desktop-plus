import SwiftUI

/// 壳的主界面：顶栏（状态 + 主机入口）+ 页面。
///
/// 浮层（壳内主机切换器、锁屏、更新提醒、提示条）盖在页面之上；管理页与配对屏以 sheet 呈现。
struct RootView: View {
    @ObservedObject var controller: ShellController
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            DesignTokens.bgBase.ignoresSafeArea()
            VStack(spacing: 0) {
                topBar
                ShellWebView(controller: controller, environment: controller.environment)
            }
            // 页面内不再放悬浮切换角标（会遮挡 DSH 内容）；切主机从顶栏进管理页。
            if controller.lockReason != nil {
                LockView(controller: controller)
                    .transition(.opacity)
            }
            if let toast = controller.toast {
                toastBanner(toast)
            }
            if let notice = controller.updateNotice {
                updateCard(notice)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: controller.lockReason)
        .preferredColorScheme(controller.colorSchemeOverride)
        .sheet(isPresented: $controller.isManagementPresented) {
            ManagementView(controller: controller)
        }
        .sheet(isPresented: $controller.isPairingPresented) {
            PairingView(controller: controller)
        }
        .task {
            await controller.start()
        }
        // window 在 controller init 时还未就绪，外观覆盖要等场景就位后再落一次。
        .onAppear { controller.applyAppearanceOverride() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                controller.sceneDidEnterBackground()
            case .active:
                controller.sceneDidBecomeActive()
            default:
                break
            }
        }
    }

    /// 顶栏：状态点 + 状态文案 + 主机入口。
    private var topBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(controller.status.color)
                .frame(width: 8, height: 8)
            Text(controller.statusText)
                .font(.system(size: 13))
                .foregroundStyle(DesignTokens.labelSecondary)
                .lineLimit(1)
            Spacer()
            Button {
                controller.isManagementPresented = true
            } label: {
                Text("主机")
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.link)
            }
            .accessibilityLabel("打开主机管理页")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(DesignTokens.bgBase)
    }

    /// 短提示。
    private func toastBanner(_ message: String) -> some View {
        VStack {
            Spacer()
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(Color(red: 16 / 255, green: 20 / 255, blue: 24 / 255))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color(red: 232 / 255, green: 237 / 255, blue: 242 / 255))
                .clipShape(Capsule())
                .padding(.bottom, 24)
        }
        .allowsHitTesting(false)
    }

    /// 更新提醒（iOS 只有跳转形态：不支持应用内安装）。
    private func updateCard(_ notice: UpdateNotice.Notice) -> some View {
        VStack {
            HStack {
                Spacer()
                VStack(alignment: .leading, spacing: 6) {
                    Text("新版本可用")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.labelPrimary)
                    Text("\(notice.version) · 平台不支持应用内安装。用 SideStore 重新导入，或从下载页取 ipa。")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.labelTertiary)
                    HStack(spacing: 14) {
                        Button("前往下载页") {
                            controller.openDownloadPage()
                        }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.brandDeep)
                        Button("不再提示此版本") {
                            controller.ignoreUpdateVersion()
                        }
                        .font(.system(size: 13))
                        .foregroundStyle(DesignTokens.labelTertiary)
                    }
                }
                    .padding(.top, 2)
                .padding(14)
                .background(DesignTokens.bgLayer2)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderL2, lineWidth: 1)
                )
                .padding(12)
            }
            Spacer()
        }
    }
}
