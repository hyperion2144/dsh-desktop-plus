import SwiftUI

/// DSH Desktop Plus 移动端 · iOS 壳的入口。
///
/// 壳是一个**原生薄壳**：页面是壳内自带的 upstream web 产物（本地加载），
/// 数据面全部走当前桌面主机的 lane。
@main
struct DshMobileApp: App {
    @State private var environment = AppEnvironment()
    @State private var controller: ShellController

    init() {
        let environment = AppEnvironment()
        _environment = State(initialValue: environment)
        _controller = State(initialValue: ShellController(environment: environment))
    }

    var body: some Scene {
        WindowGroup {
            RootView(controller: controller)
                // 跟随外观偏好（system 时为 nil 即跟随系统）；此前这里硬编码 .dark，
                // 压住了所有下层的外观覆盖，是浅色切换对根层不生效的元凶。
                .preferredColorScheme(controller.colorSchemeOverride)
        }
    }
}
