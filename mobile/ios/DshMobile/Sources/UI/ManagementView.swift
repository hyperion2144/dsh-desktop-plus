import SwiftUI

/// 原生管理页（原型定稿变体 A）。
///
/// 结构：当前主机大卡 → 主机卡片列表 → 偏好分组 → 右下 FAB 进配对。
///
/// 与主界面的关系：管理页不直接操作 WebView；点主机行即切换（壳改代理目标 + 重载页面）。
/// **会话在桌面侧，不丢。** 敏感操作（配对、移除主机）要先过生物锁。
struct ManagementView: View {
    @ObservedObject var controller: ShellController
    @Environment(\.dismiss) private var dismiss
    @State private var renameTarget: HostEntry?
    @State private var renameText = ""

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomTrailing) {
                DesignTokens.bgBase.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        currentCard
                        groupTitle("主机（\(controller.hosts.count)）")
                        hostList
                        groupTitle("偏好")
                        preferences
                        Spacer().frame(height: 80)
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                }
                fab
            }
             .navigationTitle("主机管理")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                        .foregroundStyle(DesignTokens.link)
                }
            }
            .toolbarBackground(DesignTokens.bgBase, for: .navigationBar)
        }
        // sheet 是独立 presentation：RootView 上的 preferredColorScheme 传导不进来，
        // 外观切换要在 sheet 内容上再挂一份才生效。
        .preferredColorScheme(controller.colorSchemeOverride)
        .onAppear {
            controller.refreshHosts()
        }
        .alert(
            "重命名主机",
            isPresented: Binding(
                get: { renameTarget != nil },
                set: { if !$0 { renameTarget = nil } }
            )
        ) {
            TextField("名称", text: $renameText)
            Button("保存") {
                if let target = renameTarget {
                    let name = renameText.trimmingCharacters(in: .whitespaces)
                    if !name.isEmpty {
                        controller.renameHost(target, to: name)
                    }
                }
                renameTarget = nil
            }
            Button("取消", role: .cancel) { renameTarget = nil }
        }
    }

    /// 当前主机大卡：状态点 / 名字 / origin / 形态徽标 / 延迟。
    private var currentCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(controller.currentHost?.status.color ?? DesignTokens.labelCaption)
                    .frame(width: 8, height: 8)
                Text(controller.currentHost?.displayName ?? "未配置主机")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.labelPrimary)
                if let form = controller.currentHost?.form {
                    formBadge(form)
                }
                Spacer()
                if let latency = controller.currentHost?.latencyMs {
                    Text("\(latency) ms")
                        .font(.system(size: 11))
                        .foregroundStyle(DesignTokens.labelTertiary)
                }
            }
            if let host = controller.currentHost {
                Text(detailLine(host))
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(DesignTokens.bgLayer2)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.borderL2, lineWidth: 1)
        )
    }

    /// 主机列表。
    private var hostList: some View {
        VStack(spacing: 0) {
            if controller.hosts.isEmpty {
                Text("还没有已配置的主机。点右下角按钮添加。")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(DesignTokens.bgLayer2)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            } else {
                ForEach(Array(controller.hosts.enumerated()), id: \.element.id) { index, host in
                    if index > 0 {
                        Divider().overlay(DesignTokens.borderL1)
                    }
                    hostRow(host)
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

    /// 偏好分组。
    private var preferences: some View {
        VStack(spacing: 0) {
            preferenceRow(
                title: "更新提醒",
                detail: "检查 GitHub Releases 上的新版本（仅提示并跳转）",
                isOn: Binding(
                    get: { controller.environment.preferences.updateReminderEnabled },
                    set: { newValue in
                        controller.environment.preferences.updateReminderEnabled = newValue
                        if newValue {
                            Task { await controller.checkUpdate() }
                        }
                    }
                )
            )
            Divider().overlay(DesignTokens.borderL1)
            preferenceRow(
                title: "生物锁",
                detail: "冷启动与离开超 1 分钟后要求验证",
                isOn: Binding(
                    get: { controller.environment.lock.enabled },
                    set: { newValue in controller.environment.lock.enabled = newValue }
                )
            )
            Divider().overlay(DesignTokens.borderL1)
            appearanceRow
        }
        .background(DesignTokens.bgLayer2)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.borderL2, lineWidth: 1)
        )
    }

    /// 右下角 FAB：进配对。
    private var fab: some View {
        Button {
            dismiss()
            controller.presentPairing()
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 52, height: 52)
                .background(DesignTokens.brand)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
                .shadow(color: DesignTokens.brand.opacity(0.35), radius: 12, y: 6)
        }
        .padding(.trailing, 18)
        .padding(.bottom, 24)
        .accessibilityLabel("添加主机")
    }

    // MARK: - 零件

    private func groupTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(DesignTokens.labelTertiary)
            .padding(.top, 6)
    }

    private func hostRow(_ host: HostEntry) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(host.status.color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(host.displayName)
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.labelPrimary)
                Text(host.displayOrigin)
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.labelTertiary)
            }
            formBadge(host.form)
            Spacer()
            if host.id == controller.currentHost?.id {
                Text("当前")
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.link)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture {
            guard host.id != controller.currentHost?.id else {
                controller.showToast("当前已是该主机")
                return
            }
            controller.switchHost(id: host.id)
            dismiss()
        }
        .contextMenu {
            Button {
                renameText = host.label
                renameTarget = host
            } label: {
                Text("重命名主机")
            }
            Button(role: .destructive) {
                controller.removeHost(host)
            } label: {
                Text("移除主机")
            }
        }
    }


    /// 外观行：跟随系统 / 浅色 / 深色。
    private var appearanceRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("外观")
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.labelPrimary)
                Text("原生界面的主题；页面主题跟随桌面")
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.labelTertiary)
            }
            Spacer()
            Picker("外观", selection: Binding(
                get: { controller.appearanceMode },
                set: { controller.setAppearanceMode($0) }
            )) {
                Text("系统").tag(AppearanceMode.system)
                Text("浅色").tag(AppearanceMode.light)
                Text("深色").tag(AppearanceMode.dark)
            }
            .pickerStyle(.segmented)
            .frame(width: 168)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func preferenceRow(title: String, detail: String, isOn: Binding<Bool>) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.labelPrimary)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.labelTertiary)
            }
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(DesignTokens.brand)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func formBadge(_ form: HostForm) -> some View {
        Text(form.code)
            .font(.system(size: 10))
            .foregroundStyle(form.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .overlay(
                Capsule().stroke(form.color, lineWidth: 1)
            )
    }

    /// 大卡的副标题：地址 · 状态 · （已配对）· （需重配原因）。
    private func detailLine(_ host: HostEntry) -> String {
        var parts = host.detailParts
        if let reason = host.statusReason { parts.append(reason) }
        if host.form == .tunnel, let reachable = host.tunnelReachable {
            parts.append(reachable ? "隧道可达" : "隧道不可达")
        }
        return parts.joined(separator: " · ")
    }
}
