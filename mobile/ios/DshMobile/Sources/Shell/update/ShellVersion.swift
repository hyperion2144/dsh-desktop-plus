import Foundation

/// 版本串不合法的原因。
///
/// 与 node 侧 `scripts/plus/mobile-version.mjs`、Kotlin 侧 `MobileVersion.kt`
/// 的失败形态一一对应（同一组输入，四端必须一起拒绝）。
enum ShellVersionError: Error, Equatable {
    /// 空串。
    case empty
    /// 含构建元数据（`+`）——SemVer §10：构建元数据不参与比较。
    case buildMetadata(String)
    /// 核心段不是 `X.Y.Z`。
    case coreFormat(String)
    /// 预发布段不是 `<标签>.<序号>`。
    case prereleaseFormat(String)
    /// 预发布标签不在表里。
    case unknownPrereleaseLabel(String)
    /// plus 计数为 0（`.plus.0` 不是一次发版）。
    case plusCountTooSmall(String)
    /// 数字段不是十进制整数。
    case notANumber(field: String, text: String)
    /// 数字段有前导零（SemVer §9 禁前导零）。
    case leadingZeros(field: String, text: String)
    /// 数字段超出取值上限。
    case outOfRange(field: String, text: String, max: Int)
}

/// 壳版本号（`X.Y.Z[-<label>.<index>][.plus.N]`）的解析、比较与安装版本号推导。
///
/// spec #55「更新与发版」：版本号跟随桌面 plus 版本，更新判定**自行按 SemVer 比较，不依赖列表顺序**。
///
/// ## 与事实源逐条对齐
///
/// 事实源是 `scripts/plus/mobile-version.mjs`（发版流水线），运行时端口是
/// `mobile/android/.../update/MobileVersion.kt`（Android 壳），本实现是第三份。
/// 三者必须给出同一个答案——同一组输入、同一个安装版本号、同一个比较结论。
/// 一致性由共享测试向量 `scripts/plus/test/mobile-version.vectors.json` 锁定：
/// node / Kotlin / Swift / ArkTS 四端各跑一遍同一份向量。
///
/// 对齐的规则（改一处必须改三处）：
///
///  1. **含 `+` 的版本串一律拒绝**（SemVer §10）：构建元数据不参与比较，
///     把 `.plus.N` 挪到 `+` 之后会让所有版本比较相等，更新判定直接失效。
///  2. **数字段不补零**（SemVer §9）：`02.2.2`、`0.2.2-alpha.02`、
///     `0.2.2-alpha.2.plus.010` 都是非法版本。
///  3. **字段有上限**：major/minor ≤ 9，patch / 预发布序号 / plus 计数 ≤ 99，
///     预发布标签表 ≤ 9 个（标签序号 = 表下标）。
///  4. **预发布标签必须在表里**：未知标签的构建号不可推导，不能猜。
///
/// ## 两套解析：推导用严格版，比较用 SemVer 版
///
/// - `parse` / `init?`：严格版（上面四条规则），用于推导 `CFBundleVersion` / `versionCode`；
/// - `compareVersions`：SemVer 版（核心三段无前导零 + 预发布标识符逐段比较），
///   用于「是不是更新的版本」——与 node 侧 `comparePlusVersions`、Kotlin 侧
///   `MobileVersion.compare` 同一套规则。
///
/// 两者对同一串输入的判定不同是**已知且刻意**的：`0.2.2.plus.3`（正式版 base + plus 计数）
/// 推导得出（base = `0.2.2`），但不是合法 SemVer，比较时拒绝——node 与 Kotlin 同款。
struct ShellVersion: Comparable, CustomStringConvertible {
    /// 预发布段：标签 + 标签序号 + 预发布序号。
    struct Prerelease: Equatable {
        /// 标签（`alpha` / `beta` / `rc`）。
        let label: String
        /// 标签序号（表下标）。
        let rank: Int
        /// 预发布序号（`alpha.2` 里的 2）。
        let index: Int
    }

    /// 原始版本串。
    let raw: String
    /// 主版本号。
    let major: Int
    /// 次版本号。
    let minor: Int
    /// 修订号。
    let patch: Int
    /// 预发布段（正式版为 nil）。
    let prerelease: Prerelease?
    /// plus 计数（`.plus.N` 的 N；没有 `.plus.N` 段时为 0）。
    let plusCount: Int
    /// 预发布层级（level）：预发布 = 标签序号×100 + 预发布序号；正式版 = 999。
    let level: Int
    /// 预发布标签序号表：下标即标签序号（rank = index）。
    ///
    /// **追加式维护**：已在用的标签不能插队——插队会改写历史构建号（版本号不可重排）。
    /// 与 `scripts/plus/mobile-version.mjs` 的 `PRERELEASE_LABELS` 保持一致。
    static let prereleaseLabels = ["alpha", "beta", "rc"]

    /// 正式版（无预发布段）的 level：必须大于任何预发布 level（8×100+99 = 899）。
    static let stableLevel = 999

    /// 预发布标签序号上限：level = 序号×100 + 预发布序号，必须留得下正式版的 999。
    static let maxLabelRank = 8

    /// 字段取值上限（与位权一起决定推导公式的容量）。
    static let limitMajor = 9
    static let limitMinor = 9
    static let limitPatch = 99
    static let limitIndex = 99
    static let limitPlus = 99

    /// 描述（原始串）。
    var description: String { raw }

    /// 解析一个版本串；不合法时返回 nil（想知道原因用 `parse`）。
    init?(_ text: String) {
        guard let version = try? ShellVersion.parse(text) else { return nil }
        self = version
    }

    /// 成员初始化（解析结果落位）。
    private init(
        raw: String,
        major: Int,
        minor: Int,
        patch: Int,
        prerelease: Prerelease?,
        plusCount: Int,
        level: Int
    ) {
        self.raw = raw
        self.major = major
        self.minor = minor
        self.patch = patch
        self.prerelease = prerelease
        self.plusCount = plusCount
        self.level = level
    }

    /// 解析一个版本串；不合法时抛出 `ShellVersionError`（带原因）。
    ///
    /// 规则与 `scripts/plus/mobile-version.mjs` 的 `parsePlusVersion`、
    /// `MobileVersion.kt` 的 `parse` 逐条对齐：含 `+` 拒绝、数字段不补零、
    /// 字段有上限、预发布标签必须在表里。
    static func parse(_ text: String) throws -> ShellVersion {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { throw ShellVersionError.empty }
        // GitHub tag 带 `v` 前缀，比较前先剥掉。
        let raw = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
        if raw.contains("+") {
            throw ShellVersionError.buildMetadata(text)
        }

        // 拆 `.plus.N` 后缀：base 与 plus 计数分开（N 从 1 起）。
        var base = raw
        var plus = 0
        if let plusRange = base.range(of: ".plus.", options: .backwards) {
            let countText = String(base[plusRange.upperBound...])
            if !countText.isEmpty, countText.allSatisfy({ $0.isASCII && $0.isNumber }) {
                plus = try ShellVersion.parseBoundedInteger(countText, field: "plus count", max: limitPlus)
                if plus == 0 { throw ShellVersionError.plusCountTooSmall(text) }
                base = String(base[..<plusRange.lowerBound])
            }
        }

        // 核心三段 + 预发布段。
        var core = base
        var prereleasePart = ""
        if let dash = base.firstIndex(of: "-") {
            core = String(base[..<dash])
            prereleasePart = String(base[base.index(after: dash)...])
        }
        let coreParts = core.split(separator: ".", omittingEmptySubsequences: false)
        guard coreParts.count == 3 else { throw ShellVersionError.coreFormat(text) }
        let major = try ShellVersion.parseBoundedInteger(String(coreParts[0]), field: "major", max: limitMajor)
        let minor = try ShellVersion.parseBoundedInteger(String(coreParts[1]), field: "minor", max: limitMinor)
        let patch = try ShellVersion.parseBoundedInteger(String(coreParts[2]), field: "patch", max: limitPatch)

        var prerelease: Prerelease?
        if !prereleasePart.isEmpty {
            let pieces = prereleasePart.split(separator: ".", omittingEmptySubsequences: false)
            guard pieces.count == 2 else { throw ShellVersionError.prereleaseFormat(prereleasePart) }
            let label = String(pieces[0])
            guard ShellVersion.isPrereleaseLabel(label) else {
                throw ShellVersionError.prereleaseFormat(prereleasePart)
            }
            guard let rank = prereleaseLabels.firstIndex(of: label) else {
                throw ShellVersionError.unknownPrereleaseLabel(label)
            }
            guard rank <= maxLabelRank else {
                throw ShellVersionError.outOfRange(field: "prerelease label", text: label, max: maxLabelRank)
            }
            let index = try ShellVersion.parseBoundedInteger(
                String(pieces[1]),
                field: "prerelease index",
                max: limitIndex
            )
            prerelease = Prerelease(label: label, rank: rank, index: index)
        }

        let level = prerelease.map { $0.rank * 100 + $0.index } ?? stableLevel
        if prerelease != nil && level >= stableLevel {
            throw ShellVersionError.outOfRange(
                field: "prerelease level",
                text: String(level),
                max: stableLevel - 1
            )
        }
        return ShellVersion(
            raw: trimmed,
            major: major,
            minor: minor,
            patch: patch,
            prerelease: prerelease,
            plusCount: plus,
            level: level
        )
    }

    /// 解析无前导零的非负整数并做上界检查（只收 ASCII 数字，与 node 侧 `\d` 同义）。
    private static func parseBoundedInteger(_ text: String, field: String, max: Int) throws -> Int {
        if text.isEmpty || !text.allSatisfy({ $0.isASCII && $0.isNumber }) {
            throw ShellVersionError.notANumber(field: field, text: text)
        }
        if text.count > 1 && text.hasPrefix("0") {
            throw ShellVersionError.leadingZeros(field: field, text: text)
        }
        guard let value = Int(text) else {
            throw ShellVersionError.outOfRange(field: field, text: text, max: max)
        }
        if value > max {
            throw ShellVersionError.outOfRange(field: field, text: text, max: max)
        }
        return value
    }

    /// 预发布标识符的合法字符（SemVer §9：只允许字母数字与连字符）。
    private static func isPrereleaseLabel(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
    }

    /// 预发布标签（`alpha` / `beta` / `rc`；正式版为 nil）。
    var prereleaseLabel: String? { prerelease?.label }

    /// 预发布序号（`alpha.2` 里的 2；正式版为 nil）。
    var prereleaseIndex: Int? { prerelease?.index }

    /// iOS 安装版本号（`CFBundleVersion`）。
    ///
    /// 公式与 `scripts/plus/mobile-version.mjs` 的 `mobileBundleVersion` 逐字一致：
    /// `major.minor.(patch×10^5 + level×10^2 + N)`（Apple 只收 1~3 段点分整数）。
    var bundleVersion: String {
        "\(major).\(minor).\(patch * 100_000 + level * 100 + plusCount)"
    }

    /// Android 安装版本号（`versionCode`）——与 iOS 同一套字段、同一单调序。
    var versionCode: Int {
        major * 100_000_000 + minor * 10_000_000 + patch * 100_000 + level * 100 + plusCount
    }

    /// 比较两个版本（SemVer 优先级）。
    ///
    /// 与 node 侧 `comparePlusVersions`、Kotlin 侧 `MobileVersion.compare` 同一套规则：
    /// 核心三段按数值比，预发布标识符逐段比（数字标识符按数值、数字 < 字母数字、
    /// 前缀相同则段多的更高），有预发布 < 无预发布；构建元数据（`+`）不参与比较——
    /// 本实现直接拒绝这种形态。
    ///
    /// - Throws: 版本串不合法时抛 `ShellVersionError`。
    static func compareVersions(_ left: String, _ right: String) throws -> Int {
        let l = try SemVer.parse(left)
        let r = try SemVer.parse(right)
        if l.major != r.major { return l.major < r.major ? -1 : 1 }
        if l.minor != r.minor { return l.minor < r.minor ? -1 : 1 }
        if l.patch != r.patch { return l.patch < r.patch ? -1 : 1 }
        return comparePrerelease(l.prerelease, r.prerelease)
    }

    /// SemVer 比较：核心按数值，预发布标识逐段比较（数字段按数值，其余按字典序）。
    static func < (lhs: ShellVersion, rhs: ShellVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        if lhs.patch != rhs.patch { return lhs.patch < rhs.patch }
        switch (lhs.prerelease, rhs.prerelease) {
        case (nil, nil):
            break
        case (_?, nil):
            // 有预发布标识的版本小于同核心的正式版。
            return true
        case (nil, _?):
            return false
        case let (left?, right?):
            if left.label != right.label { return left.label < right.label }
            if left.index != right.index { return left.index < right.index }
        }
        return lhs.plusCount < rhs.plusCount
    }

    /// 比较预发布段：nil（无预发布）比任何预发布都高。
    private static func comparePrerelease(_ left: [String]?, _ right: [String]?) -> Int {
        if left == nil && right == nil { return 0 }
        if left == nil { return 1 }
        if right == nil { return -1 }
        let leftIdentifiers = left ?? []
        let rightIdentifiers = right ?? []
        let shared = min(leftIdentifiers.count, rightIdentifiers.count)
        for index in 0..<shared {
            let result = compareIdentifier(leftIdentifiers[index], rightIdentifiers[index])
            if result != 0 { return result }
        }
        if leftIdentifiers.count == rightIdentifiers.count { return 0 }
        return leftIdentifiers.count < rightIdentifiers.count ? -1 : 1
    }

    /// 比较单个预发布标识符（SemVer §11）。
    private static func compareIdentifier(_ left: String, _ right: String) -> Int {
        let leftNumeric = left.allSatisfy { $0.isASCII && $0.isNumber }
        let rightNumeric = right.allSatisfy { $0.isASCII && $0.isNumber }
        if leftNumeric && rightNumeric {
            // 数字标识符无前导零：位数先比，再字典序。
            if left.count != right.count { return left.count < right.count ? -1 : 1 }
            if left == right { return 0 }
            return left < right ? -1 : 1
        }
        if leftNumeric { return -1 }
        if rightNumeric { return 1 }
        if left == right { return 0 }
        return left < right ? -1 : 1
    }

    /// 一般 SemVer 版本（用于比较，不用于推导）。
    ///
    /// 与 node `semver` 的 `valid()` 同一套合法性：核心三段无前导零、
    /// 预发布标识符非空且数字标识符无前导零。
    private struct SemVer {
        let major: Int
        let minor: Int
        let patch: Int
        let prerelease: [String]?

        static func parse(_ version: String) throws -> SemVer {
            let trimmed = version.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { throw ShellVersionError.empty }
            let raw = trimmed.hasPrefix("v") ? String(trimmed.dropFirst()) : trimmed
            if raw.contains("+") { throw ShellVersionError.buildMetadata(version) }
            var core = raw
            var prereleasePart = ""
            if let dash = raw.firstIndex(of: "-") {
                core = String(raw[..<dash])
                prereleasePart = String(raw[raw.index(after: dash)...])
            }
            let coreParts = core.split(separator: ".", omittingEmptySubsequences: false)
            guard coreParts.count == 3 else { throw ShellVersionError.coreFormat(version) }
            let major = try ShellVersion.parseBoundedInteger(
                String(coreParts[0]), field: "major", max: Int.max)
            let minor = try ShellVersion.parseBoundedInteger(
                String(coreParts[1]), field: "minor", max: Int.max)
            let patch = try ShellVersion.parseBoundedInteger(
                String(coreParts[2]), field: "patch", max: Int.max)
            var identifiers: [String]? = nil
            if !prereleasePart.isEmpty {
                var list: [String] = []
                for piece in prereleasePart.split(separator: ".", omittingEmptySubsequences: false) {
                    let identifier = String(piece)
                    guard ShellVersion.isPrereleaseLabel(identifier) else {
                        throw ShellVersionError.coreFormat(version)
                    }
                    if identifier.allSatisfy({ $0.isASCII && $0.isNumber }),
                       identifier.count > 1,
                       identifier.hasPrefix("0") {
                        throw ShellVersionError.leadingZeros(
                            field: "prerelease identifier",
                            text: identifier
                        )
                    }
                    list.append(identifier)
                }
                identifiers = list
            }
            return SemVer(major: major, minor: minor, patch: patch, prerelease: identifiers)
        }
    }
}
