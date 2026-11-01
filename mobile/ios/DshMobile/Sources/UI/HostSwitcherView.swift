import SwiftUI

/// 壳内原生浮层主机切换器（原型定稿变体 A）。
///
/// 结构：右下角标（当前主机名首字母）→ 点击弹底部抽屉 → 主机行列表 → 选中即切换。
///
/// 行为基准：鸿蒙壳 `mobile/harmony/entry/src/main/ets/pages/Index.ets` 的浮层切换器；
/// 视觉与数据参照 `ManagementView.swift` + `DesignTokens.swift`。
///
/// 切换 = 壳改代理目标 + 页面重载；**会话在桌面侧，不丢。**
/// 这一层完全由壳渲染：不依赖页面里注入的任何 UI（页面内浮层补丁废除后照常可用）。
struct HostSwitcherView: View {
    @ObservedObject var controller: ShellController

    /// 抽屉是否展开。
    @State private var isDrawerPresented = false

    /// 主机行的固定高度（内容 + 上下内边距）：行高稳定，列表区高度可算。
    private static let rowHeight: CGFloat = 56
    /// 列表区最大高度：超过就滚动。
    private static let maxListHeight: CGFloat = 320

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if isDrawerPresented {
                scrim
                    .transition(.opacity)
                drawer
                    .transition(.move(edge: .bottom))
            }
            if let host = controller.currentHost {
                badge(for: host)
            }
        }
        .animation(.easeOut(duration: 0.22), value: isDrawerPresented)
        // ZStack 里全是固定尺寸子视图时会收缩为内容大小，被外层容器居中到屏幕中央；
        // frame 撑满 + bottomTrailing 对齐把角标钉回右下角，空白区不参与命中测试。
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
    }

    // MARK: - 零件

    /// 遮罩：点它关闭抽屉。
    private var scrim: some View {
        Color.black.opacity(0.4)
            .ignoresSafeArea()
            .onTapGesture { closeDrawer() }
    }

    /// 右下角悬浮胶囊：切换图标 + 文案，品牌底白字（与 Android / 鸿蒙壳同一形态）。
    private func badge(for host: HostEntry) -> some View {
        Button {
            toggleDrawer()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 13, weight: .semibold))
                Text("切换")
                    .font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 18)
            .frame(height: 46)
            .background(DesignTokens.brand)
            .clipShape(Capsule())
            .shadow(color: Color.black.opacity(0.18), radius: 10, y: 4)
        }
        .padding(.trailing, 16)
        .padding(.bottom, 26)
        .accessibilityLabel("切换主机")
    }

    /// 底部抽屉：标题 + 主机行列表 + 底部提示。
    private var drawer: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("切换主机")
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.labelTertiary)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 6)

            if controller.hosts.isEmpty {
                Text("还没有已配置的主机。")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.labelTertiary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(controller.hosts) { host in
                            row(for: host)
                        }
                    }
                }
                .frame(height: min(CGFloat(controller.hosts.count) * Self.rowHeight, Self.maxListHeight))
            }

            Text("切换 = 壳改代理目标 + 页面重载；会话在桌面侧，不丢失。")
                .font(.system(size: 11))
                .foregroundStyle(DesignTokens.labelCaption)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 56)
        }
        .frame(maxWidth: .infinity)
        .background(DesignTokens.bgLayer2)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: DesignTokens.radiusExtraLarge,
                topTrailingRadius: DesignTokens.radiusExtraLarge
            )
        )
        .ignoresSafeArea(edges: .bottom)
    }

    /// 主机行：状态点 · 名字 · 副行 · 形态徽标 · 「当前」。
    private func row(for host: HostEntry) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(host.status.color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(host.displayName)
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.labelPrimary)
                    .lineLimit(1)
                Text(host.detailLine)
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.labelTertiary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            formBadge(host.form)
            if host.id == controller.currentHost?.id {
                Text("当前")
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.link)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture { select(host) }
    }

    /// 形态徽标（lan / mdns / tunnel / direct）。
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

    // MARK: - 行为

    /// 选中一台主机：当前主机只提示，其余的切换（壳改代理目标 + 页面重载）。
    private func select(_ host: HostEntry) {
        closeDrawer()
        guard host.id != controller.currentHost?.id else {
            controller.showToast("当前已是该主机")
            return
        }
        controller.switchHost(id: host.id)
    }

    /// 开合抽屉。
    private func toggleDrawer() {
        if isDrawerPresented {
            closeDrawer()
            return
        }
        // 打开前重读一次主机列表（状态与延迟都在后台更新）。
        controller.refreshHosts()
        isDrawerPresented = true
    }

    /// 关闭抽屉。
    private func closeDrawer() {
        isDrawerPresented = false
    }

    /// 角标上的首字母（主机名首字符；没有名字时退回 "D"）。
    private static func initial(of host: HostEntry) -> String {
        guard let first = host.displayName.first else { return "D" }
        return String(first).uppercased()
    }
}
