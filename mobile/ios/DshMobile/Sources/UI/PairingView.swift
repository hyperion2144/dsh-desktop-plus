import SwiftUI

/// 配对屏（四态：入口 / 验证中 / 成功 / 失败）。
///
/// 两个入口：**扫描二维码** 与 **粘贴配对链接**。两者拿到的是同一条链接——
/// 桌面端「远程访问」面板签发的一次性链接（10 分钟有效、一次性）。
/// **没有任何令牌手输入口**（spec #55「配对」）。
///
/// 失败文案区分两类：**链接过期** 与 **设备被移除**（两者的补救动作不同）。
struct PairingView: View {
    @ObservedObject var controller: ShellController
    @Environment(\.dismiss) private var dismiss

    /// 配对四态。
    private enum State {
        case entry
        case verifying
        case success(String)
        case failure(PairFailure)

        /// 入口态。
        var isEntry: Bool {
            if case .entry = self { return true }
            return false
        }

        /// 验证中。
        var isVerifying: Bool {
            if case .verifying = self { return true }
            return false
        }

        /// 收尾态（成功或失败）。
        var isCompletion: Bool {
            switch self {
            case .success, .failure: return true
            case .entry, .verifying: return false
            }
        }
    }

    @State private var state: State = .entry
    @State private var linkText = ""
    @State private var isScannerPresented = false
    /// 选中的发现项：点了就引导去拿这台桌面的配对链接。
    @State private var selectedService: DiscoveredService?

    var body: some View {
        NavigationStack {
            DesignTokens.bgBase.ignoresSafeArea()
            VStack(spacing: 0) {
                steps
                ScrollView {
                    switch state {
                    case .entry:
                        entryPane
                    case .verifying:
                        verifyingPane
                    case .success(let name):
                        successPane(name)
                    case .failure(let failure):
                        failurePane(failure)
                    }
                }
            }
            .navigationTitle("添加主机")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("返回") { dismiss() }
                        .foregroundStyle(DesignTokens.link)
                }
            }
            .toolbarBackground(DesignTokens.bgBase, for: .navigationBar)
        }
        // sheet 是独立 presentation：RootView 上的 preferredColorScheme 传导不进来。
        .preferredColorScheme(controller.colorSchemeOverride)
        .fullScreenCover(isPresented: $isScannerPresented) {
            ScannerView { scanned in
                isScannerPresented = false
                submit(linkText: scanned)
            }
        }
    }

    // MARK: - 步骤条

    private var steps: some View {
        HStack(spacing: 6) {
            step("① 选择来源", active: state.isEntry)
            step("② 验证", active: state.isVerifying)
            step("③ 完成", active: state.isCompletion)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func step(_ title: String, active: Bool) -> some View {
        Text(title)
            .font(.system(size: 11))
            .foregroundStyle(active ? DesignTokens.link : DesignTokens.labelTertiary)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(active ? DesignTokens.link : DesignTokens.borderL2)
                    .frame(height: 2)
            }
    }

    // MARK: - 四态

    /// 状态一：入口。
    private var entryPane: some View {
        VStack(spacing: 10) {
            card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("扫描二维码")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.labelPrimary)
                    Text("对准桌面端「远程访问」面板显示的配对码（内含地址候选与一次性令牌）")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.labelTertiary)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { isScannerPresented = true }

            card {
                VStack(alignment: .leading, spacing: 8) {
                    Text("粘贴配对链接")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.labelPrimary)
                    Text("桌面端可复制形如 dsh-mobile://pair?… 或 http://…/pair?token=… 的链接")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.labelTertiary)
                    TextField("粘贴配对链接", text: $linkText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(size: 12))
                        .padding(10)
                        .background(DesignTokens.bgLayer3)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusSmall))
                        .overlay(
                            RoundedRectangle(cornerRadius: DesignTokens.radiusSmall)
                                .stroke(DesignTokens.borderL2, lineWidth: 1)
                        )
                    Button("使用链接") {
                        submit(linkText: linkText)
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(DesignTokens.brand)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                }
            }

            if !controller.discoveredServices.isEmpty {
                Text("局域网发现（mDNS）")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)
                VStack(spacing: 0) {
                    ForEach(Array(controller.discoveredServices.enumerated()), id: \.element.id) { index, service in
                        if index > 0 {
                            Divider().overlay(DesignTokens.borderL1)
                        }
                        HStack(spacing: 10) {
                            Circle()
                                .fill(DesignTokens.success)
                                .frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(service.name)
                                    .font(.system(size: 13))
                                    .foregroundStyle(DesignTokens.labelPrimary)
                                Text(service.displayAddress)
                                    .font(.system(size: 11))
                                    .foregroundStyle(DesignTokens.labelTertiary)
                            }
                            Spacer()
                            Text(selectedService?.id == service.id ? "已选中" : "mdns")
                                .font(.system(size: 10))
                                .foregroundStyle(DesignTokens.link)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .overlay(Capsule().stroke(DesignTokens.link, lineWidth: 1))
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            // 发现只回答「桌面在哪儿」：选中后引导用户去拿这台桌面的配对链接。
                            selectedService = service
                        }
                    }
                }
                .background(DesignTokens.bgLayer2)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderL2, lineWidth: 1)
                )
            }
            if let selected = selectedService {
                VStack(alignment: .leading, spacing: 6) {
                    Text("已选中 \(selected.name)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.labelPrimary)
                    Text("地址：\(selected.displayAddress)")
                        .font(.system(size: 11))
                        .foregroundStyle(DesignTokens.labelTertiary)
                    Text("请在桌面端「远程访问」面板复制这台桌面的配对链接，然后点上方「扫描二维码」，或把链接粘到下面的输入框。")
                        .font(.system(size: 11))
                        .foregroundStyle(DesignTokens.labelTertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(DesignTokens.bgLayer2)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderL2, lineWidth: 1)
                )
                .padding(.top, 8)
            }

            Text("发现只解决「找到桌面」；授权必须由桌面签发的一次性配对链接完成（10 分钟有效）。公网主机走隧道地址。")
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.labelTertiary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 8)
        }
        .padding(.horizontal, 16)
    }

    /// 状态二：验证中。
    private var verifyingPane: some View {
        VStack(spacing: 10) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.link))
                .scaleEffect(1.3)
                .padding(.top, 40)
            Text("正在验证配对链接…")
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.labelTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    /// 状态三：成功。
    private func successPane(_ name: String) -> some View {
        VStack(spacing: 10) {
            mark(ok: true)
                .padding(.top, 40)
            Text("已配对 \(name)")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DesignTokens.labelPrimary)
            Text("设备 ID 已入 Keychain；会话 cookie 失效将自动续期。")
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.labelTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("进入") { dismiss() }
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(DesignTokens.brand)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .padding(.horizontal, 16)
                .padding(.top, 18)
        }
        .frame(maxWidth: .infinity)
    }

    /// 状态四：失败（文案区分链接过期与设备被移除）。
    private func failurePane(_ failure: PairFailure) -> some View {
        VStack(spacing: 10) {
            mark(ok: false)
                .padding(.top, 40)
            Text(failure.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DesignTokens.danger)
            Text(failure.detail)
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.labelTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("重新扫码 / 粘贴") {
                state = .entry
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(DesignTokens.brand)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .padding(.horizontal, 16)
            .padding(.top, 18)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - 动作

    /// 用一条链接（扫码或粘贴拿到的）走配对。
    private func submit(linkText: String) {
        let text = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            state = .failure(.malformed)
            return
        }
        state = .verifying
        Task {
            let failure = await controller.pair(linkText: text)
            if let failure {
                state = .failure(failure)
            } else {
                state = .success(controller.currentHost?.displayName ?? "主机")
            }
        }
    }

    // MARK: - 零件

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(DesignTokens.bgLayer2)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.borderL2, lineWidth: 1)
            )
    }

    /// 成功 / 失败的对勾与叹号（纯 CSS 图形，不用 emoji）。
    private func mark(ok: Bool) -> some View {
        ZStack {
            Circle()
                .stroke(ok ? DesignTokens.success : DesignTokens.danger, lineWidth: 3)
                .frame(width: 56, height: 56)
            if ok {
                Image(systemName: "checkmark")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(DesignTokens.success)
            } else {
                Text("!")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(DesignTokens.danger)
            }
        }
    }
}
