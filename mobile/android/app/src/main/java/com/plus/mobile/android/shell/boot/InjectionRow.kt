package com.plus.mobile.android.shell.boot

/**
 * 一条注入行。
 *
 * 与 upstream 的 `IndexInjection`（`upstream/packages/host/webserver/src/injections.ts`）同构的
 * 最小子集——本票只需要「脚本 / 外部脚本 / 预载提示」三类承载：
 *
 *  - [Script]        内联脚本：模块加载 facade（`__ModuleLoader__`）、`__DSH_BOOT__` 全局赋值等
 *  - [ScriptSrc]     外部脚本：bootstrap 阶段的插件 combo（文档相对，形如 `plugins/??…&rev=…`）
 *  - [ScriptPreload] 提示性预载：application 阶段的 combo 预载
 *
 * 上游还有 `style` / `html` 两类，本票的页面渲染不需要，故不建模。
 */
sealed interface InjectionRow {

    /** 内联脚本（上游 kind=script）。 */
    data class Script(val text: String) : InjectionRow

    /** 外部脚本（上游 kind=script-src）。 */
    data class ScriptSrc(val src: String) : InjectionRow

    /** 提示性预载（上游 kind=script-preload）。 */
    data class ScriptPreload(val src: String) : InjectionRow
}
