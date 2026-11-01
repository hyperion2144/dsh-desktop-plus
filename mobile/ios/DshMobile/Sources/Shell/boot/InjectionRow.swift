import Foundation

/// 一条注入行。
///
/// 与 upstream 的 `IndexInjection`（`upstream/packages/host/webserver/src/injections.ts`）同构的
/// 最小子集——壳只需要「脚本 / 外部脚本 / 预载提示」三类承载：
/// - `script`：内联脚本（模块加载 facade `__ModuleLoader__`、`__DSH_BOOT__` 全局赋值等）
/// - `scriptSrc`：外部脚本（bootstrap 阶段的插件 combo，文档相对，形如 `plugins/??…&rev=…`）
/// - `scriptPreload`：提示性预载（application 阶段的 combo 预载）
///
/// 上游还有 `style` / `html` 两类，壳的页面渲染不需要，故不建模。
enum InjectionRow: Equatable {
    /// 内联脚本（上游 kind=script）。
    case script(text: String)
    /// 外部脚本（上游 kind=script-src）。
    case scriptSrc(src: String)
    /// 提示性预载（上游 kind=script-preload）。
    case scriptPreload(src: String)
}
