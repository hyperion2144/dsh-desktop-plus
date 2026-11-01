import SwiftUI

/// dsh 视觉 token。
///
/// 值逐条取自上游，**不自造色值**：
///
/// - `upstream/packages/client/ui-theme/src/styles/design-platform.css`
///   - 静态色板：deepseek-450 / deepseek-400 / deepseek-500、neutral-bluish-*
///   - dark body（App 为深色主题）：bg-base / bg-layer-2 / bg-layer-3、
///     label-primary|secondary|tertiary|caption、border-l1|l2、state-success-primary
/// - `upstream/packages/client/ui-theme/src/styles/base.css`
///   - 圆角：radius-sm/md/lg/xl = 8/12/16/20
/// - `upstream/packages/client/ui-primitives/src/FileTypeIcon.module.css`
///   - 文件类型紫（隧道徽标补充色）
///
/// 原型对照：`prototype/ui-mock/index.html`（wayfinder #54 定稿 · 管理页变体 A）。
/// 深色底上的白色透明度换算：6% → alpha 0.06，12% → alpha 0.12。
enum DesignTokens {
    // MARK: - 主题
    // MARK: - 主题

    /// 用动态色包装：跟随系统深浅模式各取一值（浅/深色值均取自上游 design-platform.css，
    /// light body 与 dark body 两段，不自造色值）。
    private static func theme(_ light: UIColor, _ dark: UIColor) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }

    private static let rgb = { (r: CGFloat, g: CGFloat, b: CGFloat) in UIColor(red: r / 255, green: g / 255, blue: b / 255, alpha: 1) }

    // MARK: - 表面

    /// 基面：light neutral-bluish-00 / dark neutral-bluish-950（`dsw-alias-bg-base`）。
    static let bgBase = theme(rgb(255, 255, 255), rgb(21, 21, 23))

    /// 卡片面板：light neutral-bluish-00 / dark neutral-bluish-850（`dsw-alias-bg-layer-2`）；
    /// 浅色下卡片与基面同色，靠边框区分（与上游 light 一致）。
    static let bgLayer2 = theme(rgb(255, 255, 255), rgb(44, 44, 46))

    /// 交互底：light neutral-bluish-00 / dark neutral-bluish-800（`dsw-alias-bg-layer-3`）。
    static let bgLayer3 = theme(rgb(255, 255, 255), rgb(53, 54, 56))

    /// ghost 交互底：light rgba(0,0,0,.04)（light body 的分层色）/ dark neutral-bluish-750。
    static let bgChip = theme(UIColor(white: 0, alpha: 0.04), rgb(67, 69, 74))

    // MARK: - 文字

    /// 主文字：light neutral-bluish-1000 / dark neutral-bluish-50（`dsw-alias-label-primary`）。
    static let labelPrimary = theme(rgb(15, 17, 21), rgb(249, 250, 251))

    /// 次文字：light neutral-bluish-700 / dark neutral-bluish-300（`dsw-alias-label-secondary`）。
    static let labelSecondary = theme(rgb(97, 102, 107), rgb(207, 211, 214))

    /// 三级文字：light neutral-bluish-600 / dark neutral-bluish-400（`dsw-alias-label-tertiary`）。
    static let labelTertiary = theme(rgb(129, 133, 140), rgb(173, 178, 184))

    /// 说明文字：light neutral-bluish-400 / dark neutral-bluish-600（`dsw-alias-label-caption`）。
    static let labelCaption = theme(rgb(173, 178, 184), rgb(129, 133, 140))

    // MARK: - 边框

    /// 一级边框：`dsw-alias-border-l1` = light rgba(0,0,0,.04) / dark rgba(255,255,255,.06)。
    static let borderL1 = theme(UIColor(white: 0, alpha: 0.04), UIColor(white: 1, alpha: 0.06))

    /// 二级边框：`dsw-alias-border-l2` = light rgba(0,0,0,.1) / dark rgba(255,255,255,.12)。
    static let borderL2 = theme(UIColor(white: 0, alpha: 0.1), UIColor(white: 1, alpha: 0.12))

    // MARK: - 主色与状态（静态色，不随主题）

    /// 品牌主色：deepseek-450（`dsw-alias-state-business-primary`）。
    static let brand = Color(red: 86 / 255, green: 134 / 255, blue: 254 / 255)

    /// 链接色：deepseek-400（`dsw-static-deepseek-400`）。
    static let link = Color(red: 122 / 255, green: 170 / 255, blue: 255 / 255)

    /// 深主色：deepseek-500（`dsw-static-deepseek-500`）。
    static let brandDeep = Color(red: 65 / 255, green: 118 / 255, blue: 230 / 255)

    /// 成功：green-500（`dsw-alias-state-success-primary`）。
    static let success = Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255)

    /// 错误：red-600（`dsw-alias-state-error-primary`）。
    static let danger = Color(red: 236 / 255, green: 19 / 255, blue: 19 / 255)

    /// 隧道徽标：文件类型紫（`dsh-file-type-violet`）。
    static let violet = Color(red: 139 / 255, green: 118 / 255, blue: 246 / 255)

    // MARK: - 圆角

    /// 圆角 sm：8。
    static let radiusSmall: CGFloat = 8
    /// 圆角 md：12。
    static let radiusMedium: CGFloat = 12
    /// 圆角 lg：16。
    static let radiusLarge: CGFloat = 16
    /// 圆角 xl：20。
    static let radiusExtraLarge: CGFloat = 20
}

/// 状态点的颜色（管理页）。
extension HostStatus {
    /// 状态点颜色（语义 → token）。
    var color: Color {
        switch self {
        case .connected: return DesignTokens.success
        case .needsRepair: return DesignTokens.danger
        case .offline: return DesignTokens.labelTertiary
        case .unknown: return DesignTokens.labelCaption
        }
    }

    /// 状态文案。
    var label: String {
        switch self {
        case .connected: return "已连接"
        case .offline: return "未连接"
        case .needsRepair: return "需重新配对"
        case .unknown: return "状态未知"
        }
    }
}

/// 主机副行（地址 · 状态 · 设备已配对）：管理页大卡与浮层切换器共用一份算法。
extension HostEntry {
    /// 副行的分段：地址 · 状态 · （设备已配对）。
    var detailParts: [String] {
        var parts = [displayOrigin, status.label]
        if deviceId != nil { parts.append("设备已配对") }
        return parts
    }

    /// 副行文案：地址 · 状态 · （设备已配对）。
    var detailLine: String {
        detailParts.joined(separator: " · ")
    }
}

/// 形态徽标的颜色（原型：lan 绿 / mdns 链接蓝 / tunnel 紫）。
extension HostForm {
    /// 徽标颜色。
    var color: Color {
        switch self {
        case .lan: return DesignTokens.success
        case .mdns: return DesignTokens.link
        case .tunnel: return DesignTokens.violet
        case .direct: return DesignTokens.link
        }
    }
}
