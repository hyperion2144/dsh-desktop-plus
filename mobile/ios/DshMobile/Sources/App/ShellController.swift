import Foundation
import SwiftUI

/// 主界面的状态机：连接、切换、锁、配对与提示。
///
/// 与 Android 壳同构（`MainActivity`）：管理页只改「当前主机」，主界面回前台时自己发现
/// 当前主机变了，就切代理目标 + 重载页面。**会话在桌面侧，不丢。**
@MainActor
final class ShellController: ObservableObject, MobileBridgeHost {
    let environment: AppEnvironment

    /// 顶栏的状态文案。
    @Published private(set) var statusText = "未配置主机"
    /// 顶栏的状态点。
    @Published private(set) var status: HostStatus = .unknown
    /// 全部主机。
    @Published private(set) var hosts: [HostEntry] = []
    /// 当前主机。
    @Published private(set) var currentHost: HostEntry?
    /// 是否展示原生管理页。
    @Published var isManagementPresented = false
    /// 是否展示配对屏。
    @Published var isPairingPresented = false
    /// 锁屏原因（非 nil 时盖住整个界面）。
    @Published var lockReason: LockController.Reason?
    /// 更新提醒（跳转形态）。
    @Published var updateNotice: UpdateNotice.Notice?
    /// 短提示。
    @Published var toast: String?
    /// 外观模式：原生界面主题（跟随系统 / 浅色 / 深色）；改动立即写回偏好。
    @Published var appearanceMode: AppearanceMode
    /// mDNS 发现到的桌面。
    @Published private(set) var discoveredServices: [DiscoveredService] = []

    /// 页面装载器（由 WebView 协调器注入）。
    private var pageLoader: (() -> Void)?

    /// 页面是否已经装载过（决定回前台要不要 reload）。
    private var pageLoaded = false
    /// 正在换主机（载荷未就位）：此时回前台不重载，避免用旧载荷重载。
    private var switching = false
    /// 当前已装载的主机 id。
    private var loadedHostId: String?
    /// 引导载荷是否就绪（就绪后才装载页面）。
    private var payloadReady = false
    /// 待执行的敏感动作：解锁通过后才跑。
    private var pendingSensitiveAction: (() -> Void)?

    init(environment: AppEnvironment) {
        self.environment = environment
        self.appearanceMode = environment.preferences.appearanceMode
        applyAppearanceOverride()
    }


    /// 切换外观模式：写回偏好并立即生效。
    func setAppearanceMode(_ mode: AppearanceMode) {
        appearanceMode = mode
        environment.preferences.appearanceMode = mode
        applyAppearanceOverride()
    }

    /// 把外观覆盖直接落到 UIWindow 上。SwiftUI 的 preferredColorScheme 对 iOS 26 上
    /// 的根窗口与 sheet 传播不可靠（真机实测 sheet 收不到、根层不刷新），UIKit 层的
    /// overrideUserInterfaceStyle 覆盖所有 presentation，动态色（DesignTokens）也随之解析。
    func applyAppearanceOverride() {
        let style: UIUserInterfaceStyle
        switch appearanceMode {
        case .system: style = .unspecified
        case .light: style = .light
        case .dark: style = .dark
        }
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            for window in scene.windows {
                window.overrideUserInterfaceStyle = style
            }
        }
    }

    /// preferredColorScheme 用的覆盖：跟随系统时为 nil。
    var colorSchemeOverride: ColorScheme? {
        switch appearanceMode {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
    // MARK: - 生命周期

    /// 壳启动：连当前主机、开发现、查更新。
    func start() async {
        environment.discovery.onChange = { [weak self] services in
            Task { @MainActor in self?.discoveredServices = services }
        }
        environment.discovery.start()
        await checkUpdate()
        await syncCurrentHost()
    }

    /// 进入后台：记下时刻（回前台超时要重新验证）。
    func sceneDidEnterBackground() {
        environment.lock.onBackground()
    }

    /// 回到前台：可能要验证；否则按需重连。
    func sceneDidBecomeActive() {
        guard let reason = environment.lock.needsUnlock() else {
            Task { await syncCurrentHost() }
            return
        }
        presentLock(reason: reason)
    }

    /// 回前台后的同步：当前主机被换掉了就切代理目标 + 重载页面；否则按需重连。
    func syncCurrentHost() async {
        refreshHosts()
        guard let current = environment.registry.current() else {
            statusText = "未配置主机"
            status = .unknown
            return
        }
        if current.id != loadedHostId {
            await applyHost(current)
            return
        }
        // 回前台自动重连：页面的 WS 在后台必然断（iOS suspended），
        // 壳层必须实现「回前台重连」这条路径。
        if pageLoaded && !switching {
            ShellLog.info("回到前台：重载页面以重建连接")
            loadPage()
        }
    }

    // MARK: - 主机

    /// 切换主机（壳桥与页面内浮层切换器都走这里）。
    @discardableResult
    func switchHost(id: String) -> Bool {
        guard let host = environment.registry.find(id: id) else {
            showToast("找不到该主机")
            return false
        }
        showToast("正在切换主机：\(host.displayName)")
        Task { await applyHost(host) }
        return true
    }

    /// 应用一台主机：连接（含降级链）→ 取引导载荷 → 装载页面。
    func applyHost(_ host: HostEntry) async {
        environment.registry.setCurrent(id: host.id)
        environment.payloadStore.clear()
        switching = true
        statusText = "正在连接主机：\(host.displayName)"
        status = .unknown
        let outcome = await environment.connector.connect(host)
        switching = false
        switch outcome {
        case .connected(let updated, let payload):
            environment.payloadStore.set(payload)
            payloadReady = true
            loadedHostId = updated.id
            statusText = "已连接：\(updated.displayName)"
            status = .connected
            refreshHosts()
            loadPage()
        case .needsRepair(let updated, let reason):
            // 不改 loadedHostId：这一台没连上，下次回前台要重试，而不是当成「已装载」。
            statusText = "需重新配对：\(reason)"
            status = .needsRepair
            refreshHosts()
            showToast("\(updated.displayName)：\(reason)")
        case .offline(_, let reason):
            statusText = "连接失败：\(reason)"
            status = .offline
            refreshHosts()
        }
    }

    /// 重新读一遍主机列表（管理页与顶栏都靠它刷新）。
    func refreshHosts() {
        hosts = environment.registry.list()
        currentHost = environment.registry.current()
    }

    /// 移除主机（敏感操作：要过生物锁）。
    func removeHost(_ host: HostEntry) {
        requireUnlock { [weak self] in
            guard let self else { return }
            self.environment.registry.remove(id: host.id)
            self.showToast("已移除主机：\(host.displayName)")
            self.refreshHosts()
            Task { await self.syncCurrentHost() }
        }
    }

    /// 重命名主机（展示名，仅本机；不改 origin 与凭证）。
    func renameHost(_ host: HostEntry, to name: String) {
        var updated = host
        updated.label = name
        environment.registry.upsert(updated)
        showToast("已重命名")
        refreshHosts()
    }

    // MARK: - 配对

    /// 用一条配对链接完成配对（扫码与粘贴拿到的是同一条链接）。
    func pair(linkText: String) async -> PairFailure? {
        guard let link = PairLink.parse(linkText) else {
            return .malformed
        }
        switch await environment.pairingService.pair(link: link) {
        case .paired(let host):
            refreshHosts()
            statusText = "已连接：\(host.displayName)"
            status = .connected
            loadedHostId = host.id
            await applyHost(host)
            return nil
        case .failed(let failure):
            return failure
        }
    }

    /// 进入配对屏（敏感操作：要过生物锁）。
    func presentPairing() {
        requireUnlock { [weak self] in
            self?.isPairingPresented = true
        }
    }

    // MARK: - 生物锁

    /// 敏感动作：先过生物锁。
    func requireUnlock(_ action: @escaping () -> Void) {
        guard environment.lock.enabled else {
            action()
            return
        }
        pendingSensitiveAction = action
        environment.lock.lockNow()
        presentLock(reason: .sensitive)
    }

    /// 拉起锁屏。
    private func presentLock(reason: LockController.Reason) {
        lockReason = reason
        if !environment.gate.available() {
            // 设备既没生物特征也没密码时放行并记录，否则用户会被自己的 App 锁死。
            ShellLog.warn("设备没有可用的验证方式（无生物特征 / 无 PIN），本次跳过锁屏")
            unlockSucceeded()
            return
        }
    }

    /// 验证通过：解锁并执行待办的敏感动作。
    func unlockSucceeded() {
        environment.lock.unlock()
        let action = pendingSensitiveAction
        pendingSensitiveAction = nil
        lockReason = nil
        action?()
    }

    /// 锁屏上的「验证」按钮。
    func authenticate() {
        let reason = lockReason ?? .cold
        environment.gate.authenticate(title: "DSH Desktop PlusM 已锁定", subtitle: Self.lockMessage(for: reason)) { [weak self] ok in
            Task { @MainActor in
                guard let self else { return }
                if ok {
                    self.unlockSucceeded()
                } else {
                    ShellLog.info("生物锁验证未通过")
                }
            }
        }
    }

    /// 锁屏文案（按触发场景）。
    static func lockMessage(for reason: LockController.Reason) -> String {
        switch reason {
        case .cold: return "验证以继续访问你的桌面主机。"
        case .background: return "离开超过 1 分钟。验证以继续访问你的桌面主机。"
        case .sensitive: return "该操作会改动你的主机配置，验证后继续。"
        }
    }

    // MARK: - 更新提醒

    /// 检查更新（跳转形态）。
    func checkUpdate() async {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let notice = await environment.updateNotice.check(currentVersion: version)
        updateNotice = notice
    }

    /// 打开下载页（iOS 不支持应用内安装：引导用户用 SideStore 重新导入）。
    func openDownloadPage() {
        guard let url = updateNotice?.downloadURL else { return }
        UIApplication.shared.open(url)
    }

    /// 「不再提示此版本」：把该版本拉黑并收起提醒卡片。
    ///
    /// 拉黑的是**某一个具体版本**（不是整个渠道）：更高的版本仍然会提醒。
    func ignoreUpdateVersion() {
        guard let notice = updateNotice else { return }
        environment.updateNotice.ignore(version: notice.version)
        updateNotice = nil
        showToast("不再提示 \(notice.version)")
    }

    // MARK: - 页面

    /// 装载页面（重装用户脚本 + 重载）。
    private func loadPage() {
        payloadReady = true
        pageLoaded = true
        pageLoader?()
    }

    /// WebView 就位后登记页面装载器；载荷已就绪时立刻装载。
    func attachPageLoader(_ loader: @escaping () -> Void) {
        pageLoader = loader
        if payloadReady { loader() }
    }

    /// 壳桥快照（主机列表，不含凭证）。
    func bridgeSnapshotScript() -> String {
        BridgeScript.snapshotScript(
            hosts: environment.registry.list(),
            current: environment.registry.current()
        )
    }

    /// 短提示（2 秒后自动消失）。
    func showToast(_ message: String) {
        toast = message
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if toast == message { toast = nil }
        }
    }
}
