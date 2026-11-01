package com.plus.mobile.android.shell.update

/**
 * 版本串不合法。
 *
 * 与 node 侧的失败形态一一对应（同一组输入，两侧都必须拒绝）——
 * 跨实现一致性由 `app/src/test/java/com/plus/mobile/android/shell/update/MobileVersionTest.kt`
 * 锁定。
 */
class MobileVersionException(message: String) : IllegalArgumentException(message)

/**
 * 移动端版本号的事实源：解析、推导（versionCode / CFBundleVersion）与比较。
 *
 * ## 这是 node 侧事实源的 Kotlin 端口
 *
 * node 侧的事实源是 `scripts/plus/mobile-version.mjs`（票 #58）：plus 版本
 * `X.Y.Z[-<label>.<index>][.plus.N]` → 移动端安装版本号（Android `versionCode`、
 * iOS `CFBundleVersion`）的**确定性推导公式**。
 *
 * 壳在运行时要做两件事，都必须与发版侧同一套公式：
 *
 *  1. **推导**：把 feed 里的 plus 版本推成安装版本号，与本机已装版本号比对，
 *     确认这次更新「装得上」（覆盖安装要求版本号更高）；
 *  2. **比较**：按 SemVer 优先级判定「是不是更新的版本」——不依赖列表顺序。
 *
 * 两边是两次独立实现（node 侧给发版流水线用，Kotlin 侧给壳运行时用），
 * 因此**公式、字段上限、已知坑必须逐条对齐**，一致性由同一组数值锁定：
 * 见 `MobileVersionTest.kt` 里的跨实现测试向量（取自 node 侧单测
 * `scripts/plus/test/mobile-version.test.mjs`）。
 *
 * ## 推导公式（与 node 侧逐字同形）
 *
 * ```
 * plus 版本 = `X.Y.Z` [`-<label>.<index>`] [`.plus.<N>`]
 *
 *   字段（十进制混合进制打包，位权由低到高）：
 *     N      plus 计数       0..99    位权 1
 *     level  预发布层级     0..999   位权 100        （正式版 = 999）
 *     patch  上游补丁号     0..99    位权 100_000
 *     minor  上游次版本号   0..9     位权 10_000_000
 *     major  上游主版本号   0..9     位权 100_000_000
 *
 *   Android versionCode = major×10^8 + minor×10^7 + patch×10^5 + level×10^2 + N
 *   iOS CFBundleVersion = `major.minor.(patch×10^5 + level×10^2 + N)`
 * ```
 *
 * `level` = 预发布标签序号×100 + 预发布序号；正式版（无预发布段）= 999。
 *
 * ## 已知坑（SemVer 2.0.0 §9 / §10，与 node 侧同样显式拒绝）
 *
 *  1. plus 计数 N **不能补零**：`0.2.2-alpha.2.plus.010` 不是合法 SemVer（§9 禁前导零）。
 *  2. `.plus.N` **不能挪到 `+` 之后**：`0.2.2-alpha.2+plus.10` 与 `+plus.9` 优先级相等
 *     （§10：构建元数据不参与比较），更新判定会直接失效。
 */
object MobileVersion {

    /** Android 安装器接受的最大 versionCode（Android 9+ 拒装 versionCode ≥ 2,100,000,000 的包）。 */
    const val ANDROID_MAX_VERSION_CODE = 2_100_000_000L

    /**
     * 上游预发布标签表：下标即标签序号（rank = index）。
     *
     * **追加式维护**：已在用的标签不能插队——插队会改写历史构建号（版本号不可重排）。
     * 上游换标签（alpha → beta）时在表尾追加即可。
     */
    val PRERELEASE_LABELS = listOf("alpha", "beta", "rc")

    /** 正式版（无预发布段）的 level：必须大于任何预发布 level（8×100+99 = 899）。 */
    private const val STABLE_LEVEL = 999

    /** 预发布标签序号上限：level = 序号×100 + 预发布序号，必须留得下正式版的 999。 */
    private const val MAX_LABEL_RANK = 8

    /** 字段取值上限（与位权一起决定推导公式的容量）。 */
    private const val LIMIT_MAJOR = 9
    private const val LIMIT_MINOR = 9
    private const val LIMIT_PATCH = 99
    private const val LIMIT_INDEX = 99
    private const val LIMIT_PLUS = 99

    private val CORE_PATTERN = Regex("""^(\d+)\.(\d+)\.(\d+)$""")
    private val PRERELEASE_PATTERN = Regex("""^([0-9A-Za-z-]+)\.(\d+)$""")
    private val PLUS_SUFFIX_PATTERN = Regex("""\.plus\.(\d+)$""")

    /** 预发布段：标签 + 标签序号 + 预发布序号。 */
    data class Prerelease(val label: String, val rank: Int, val index: Int)

    /** plus 版本解析结果：推导公式的字段。 */
    data class PlusVersion(
        val major: Int,
        val minor: Int,
        val patch: Int,
        val prerelease: Prerelease?,
        val plus: Int,
        val level: Int,
    )

    /**
     * 解析 plus 版本 → 推导公式的字段。
     *
     * @param version `X.Y.Z[-<label>.<index>][.plus.N]`，允许带 `v` 前缀
     */
    fun parse(version: String): PlusVersion {
        if (version.isBlank()) {
            throw MobileVersionException("plus version must be a non-empty string")
        }
        val raw = version.trim().let { if (it.startsWith("v")) it.substring(1) else it }
        if (raw.contains('+')) {
            throw MobileVersionException(
                "plus version $version: build metadata is not allowed — keep \".plus.N\" in the prerelease part, " +
                    "moving it after \"+\" makes every build compare equal (SemVer §10)",
            )
        }

        val plusMatch = PLUS_SUFFIX_PATTERN.find(raw)
        val plus = if (plusMatch == null) {
            0
        } else {
            val count = parseBoundedInteger(plusMatch.groupValues[1], "plus count", LIMIT_PLUS)
            // N 从 1 起：`.plus.0` 不是一次发版。
            if (count == 0) throw MobileVersionException("plus count must be at least 1")
            count
        }
        val base = if (plusMatch == null) raw else raw.substring(0, plusMatch.range.first)

        val dash = base.indexOf('-')
        val core = if (dash == -1) base else base.substring(0, dash)
        val prereleasePart = if (dash == -1) "" else base.substring(dash + 1)

        val coreMatch = CORE_PATTERN.matchEntire(core)
            ?: throw MobileVersionException("unexpected upstream version: $base")
        val major = parseBoundedInteger(coreMatch.groupValues[1], "major", LIMIT_MAJOR)
        val minor = parseBoundedInteger(coreMatch.groupValues[2], "minor", LIMIT_MINOR)
        val patch = parseBoundedInteger(coreMatch.groupValues[3], "patch", LIMIT_PATCH)

        val prerelease = if (prereleasePart.isEmpty()) {
            null
        } else {
            val match = PRERELEASE_PATTERN.matchEntire(prereleasePart)
                ?: throw MobileVersionException(
                    "unsupported prerelease \"$prereleasePart\": expected \"<label>.<index>\"",
                )
            val label = match.groupValues[1]
            val rank = PRERELEASE_LABELS.indexOf(label)
            if (rank == -1) {
                throw MobileVersionException(
                    "unknown prerelease label \"$label\": append it to PRERELEASE_LABELS in " +
                        "scripts/plus/mobile-version.mjs (append only — inserting would renumber published build codes)",
                )
            }
            if (rank > MAX_LABEL_RANK) {
                throw MobileVersionException(
                    "prerelease label \"$label\" has rank $rank, past the supported range (max $MAX_LABEL_RANK)",
                )
            }
            Prerelease(
                label = label,
                rank = rank,
                index = parseBoundedInteger(match.groupValues[2], "prerelease index", LIMIT_INDEX),
            )
        }

        val level = prerelease?.let { it.rank * 100 + it.index } ?: STABLE_LEVEL
        if (prerelease != null && level >= STABLE_LEVEL) {
            throw MobileVersionException("prerelease level $level collides with the stable level $STABLE_LEVEL")
        }
        return PlusVersion(major, minor, patch, prerelease, plus, level)
    }

    /**
     * 移动端安装版本号（Android versionCode）——从 plus 版本确定性推导，单调递增。
     */
    fun versionCode(version: String): Int {
        val parsed = parse(version)
        val code = parsed.major * 100_000_000 +
            parsed.minor * 10_000_000 +
            parsed.patch * 100_000 +
            parsed.level * 100 +
            parsed.plus
        if (code > ANDROID_MAX_VERSION_CODE) {
            throw MobileVersionException(
                "mobile version code $code exceeds the Android limit $ANDROID_MAX_VERSION_CODE",
            )
        }
        return code
    }

    /**
     * 移动端安装版本号（iOS 形态：CFBundleVersion）——与 versionCode 同一套字段，同一单调序。
     *
     * Android 壳用不到这一项，但两端必须同一套字段，故一并实现（便于跨端对拍）。
     */
    fun bundleVersion(version: String): String {
        val parsed = parse(version)
        return "${parsed.major}.${parsed.minor}." +
            (parsed.patch * 100_000 + parsed.level * 100 + parsed.plus)
    }

    /**
     * 比较两个版本（SemVer 优先级）。
     *
     * 与 node 侧 `comparePlusVersions` 同一套规则：先比主/次/补丁号，
     * 再比预发布段（标识符逐个比：数字标识符按数值比，数字 < 字母数字，前缀相同则长的更高），
     * 有预发布 < 无预发布；构建元数据不参与比较（且本实现直接拒绝 `+` 形态）。
     */
    fun compare(left: String, right: String): Int {
        val l = SemVer.parse(left)
        val r = SemVer.parse(right)
        if (l.major != r.major) return l.major.compareTo(r.major)
        if (l.minor != r.minor) return l.minor.compareTo(r.minor)
        if (l.patch != r.patch) return l.patch.compareTo(r.patch)
        return comparePrerelease(l.prerelease, r.prerelease)
    }

    /** candidate 是否比 current 新（移动端更新判定用）。 */
    fun isNewer(candidate: String, current: String): Boolean = compare(candidate, current) > 0

    /**
     * 解析无前导零的非负整数并做上界检查（ASCII 数字，与 node 侧 `\d` 同义）。
     */
    private fun parseBoundedInteger(text: String, label: String, max: Int): Int {
        if (text.isEmpty() || !text.all { it in '0'..'9' }) {
            throw MobileVersionException("$label must be a non-negative integer: $text")
        }
        if (text.length > 1 && text.startsWith("0")) {
            throw MobileVersionException("$label must not have leading zeros: $text")
        }
        val value = text.toIntOrNull()
            ?: throw MobileVersionException("$label is out of range: $text")
        if (value > max) {
            throw MobileVersionException("$label exceeds the supported range (max $max): $text")
        }
        return value
    }

    /** 比较预发布段：null（无预发布）比任何预发布都高。 */
    private fun comparePrerelease(left: List<String>?, right: List<String>?): Int {
        if (left == null && right == null) return 0
        if (left == null) return 1
        if (right == null) return -1
        val shared = minOf(left.size, right.size)
        for (index in 0 until shared) {
            val result = compareIdentifier(left[index], right[index])
            if (result != 0) return result
        }
        return left.size.compareTo(right.size)
    }

    /** 比较单个预发布标识符（SemVer §11）。 */
    private fun compareIdentifier(left: String, right: String): Int {
        val leftNumeric = left.all { it in '0'..'9' }
        val rightNumeric = right.all { it in '0'..'9' }
        return when {
            leftNumeric && rightNumeric -> compareNumeric(left, right)
            leftNumeric -> -1   // 数字标识符的优先级低于字母数字标识符
            rightNumeric -> 1
            else -> left.compareTo(right)
        }
    }

    /** 数字标识符按数值比较（无前导零，故先比位数再比字典序）。 */
    private fun compareNumeric(left: String, right: String): Int {
        if (left.length != right.length) return left.length - right.length
        return left.compareTo(right)
    }

    /**
     * 一般 SemVer 版本（用于比较，不用于推导）。
     *
     * 与 node `semver` 的 `valid()` 同一套合法性：核心三段无前导零、
     * 预发布标识符非空且数字标识符无前导零。
     */
    private data class SemVer(
        val major: Int,
        val minor: Int,
        val patch: Int,
        val prerelease: List<String>?,
    ) {
        companion object {

            private val CORE = Regex("""^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$""")

            fun parse(version: String): SemVer {
                if (version.isBlank()) {
                    throw MobileVersionException("version must be a non-empty string")
                }
                val raw = version.trim().let { if (it.startsWith("v")) it.substring(1) else it }
                if (raw.contains('+')) {
                    throw MobileVersionException(
                        "version $version: build metadata is not allowed — \".plus.N\" must stay in the " +
                            "prerelease part, moving it after \"+\" makes every build compare equal (SemVer §10)",
                    )
                }
                val dash = raw.indexOf('-')
                val core = if (dash == -1) raw else raw.substring(0, dash)
                val prereleasePart = if (dash == -1) "" else raw.substring(dash + 1)

                val match = CORE.matchEntire(core)
                    ?: throw MobileVersionException("not a valid SemVer version: $version")
                val identifiers = if (prereleasePart.isEmpty()) {
                    null
                } else {
                    prereleasePart.split('.').also { list ->
                        list.forEach { identifier ->
                            if (identifier.isEmpty()) {
                                throw MobileVersionException("not a valid SemVer version: $version")
                            }
                            if (!identifier.all { it.isAsciiLetterOrDigit() || it == '-' }) {
                                throw MobileVersionException("not a valid SemVer version: $version")
                            }
                            if (identifier.all { it in '0'..'9' } &&
                                identifier.length > 1 &&
                                identifier.startsWith("0")
                            ) {
                                throw MobileVersionException(
                                    "version $version: prerelease identifier \"$identifier\" must not have " +
                                        "leading zeros (SemVer §9)",
                                )
                            }
                        }
                    }
                }
                return SemVer(
                    major = match.groupValues[1].toInt(),
                    minor = match.groupValues[2].toInt(),
                    patch = match.groupValues[3].toInt(),
                    prerelease = identifiers,
                )
            }

            private fun Char.isAsciiLetterOrDigit(): Boolean =
                this in '0'..'9' || this in 'a'..'z' || this in 'A'..'Z'
        }
    }
}
