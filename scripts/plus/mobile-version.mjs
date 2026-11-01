// 移动端安装版本号推导（票 #58）。
//
// Android `versionCode` 与 iOS `CFBundleVersion` 都必须是**单调递增的整数**：系统只接受
// 比已装版本更高的构建号，否则覆盖安装被拒（Android 报 INSTALL_FAILED_VERSION_DOWNGRADE）。
// plus 版本本身是字符串（`0.2.2-alpha.2.plus.9`），当不了构建号，所以这里定义一条
// **确定性推导公式**：同一个 plus 版本永远推出同一个构建号，且版本越新构建号越大。
//
// ── 公式 ───────────────────────────────────────────────────────────────────────
//
//   plus 版本 = `X.Y.Z` [`-<label>.<index>`] [`.plus.<N>`]
//
//   字段（十进制混合进制打包，位权由低到高）：
//     N      plus 计数       0..99    位权 1
//     level  预发布层级     0..999   位权 100          （正式版 = 999）
//     patch  上游补丁号     0..99    位权 100_000
//     minor  上游次版本号   0..9     位权 10_000_000
//     major  上游主版本号   0..9     位权 100_000_000
//
//   Android versionCode = major×10^8 + minor×10^7 + patch×10^5 + level×10^2 + N
//                         （上限 999,999,999 < Android 安装上限 2,100,000,000）
//   iOS CFBundleVersion = `major.minor.(patch×10^5 + level×10^2 + N)`
//                         （Apple 只收 1~3 段点分整数；第 3 段正好是 Android 号的低位部分）
//
//   level 的取值：预发布 = `标签序号×100 + 预发布序号`；正式版（无预发布段）= 999。
//   标签序号取自 `PRERELEASE_LABELS`（追加式，见下）；预发布序号 = `<label>.<index>` 的 index。
//
// ── 为什么这么切分 ─────────────────────────────────────────────────────────────
//
//   SemVer 规定「同一 base 的所有预发布 < 同一 base 的正式版 < 下一个 base 的预发布」。
//   要把这个序压成一个整数，字段必须按「base 的主/次/补丁号 → 预发布层级 → plus 计数」
//   的优先级从高到低排，并且每级要留得下下一级的全部取值（否则会串位）：
//     patch 位权 10^5 > level 上限 999×100 + N 上限 99 = 99,999      ✓
//     minor 位权 10^7 > patch 上限 99×10^5 = 9,900,000               ✓
//     major 位权 10^8 > minor 上限 9×10^7 = 90,000,000               ✓
//
//   于是 `0.2.2-alpha.2.plus.9 < 0.2.2-alpha.2.plus.10 < 0.2.2-alpha.3` 在数值上成立：
//   同一 base 内 plus 计数进位只动最低位，预发布序号进位动 level，跨 base 动高位。
//
// ── 已知坑（SemVer 2.0.0 §9 / §10）───────────────────────────────────────────
//
//   ① plus 计数 N **不能补零**：`0.2.2-alpha.2.plus.010` 不是合法 SemVer（§9 禁前导零）。
//   ② `.plus.N` **不能挪到 `+` 之后**：`0.2.2-alpha.2+plus.10` 与 `+plus.9` 优先级相等
//      （§10：构建元数据不参与比较），更新判定会直接失效。
//   本模块两条都显式拒绝（`parsePlusVersion` / `comparePlusVersions`），测试锁定。

import { compare as semverCompare, valid as semverValid } from 'semver'

/** Android 安装器接受的最大 versionCode（Android 9+ 拒装 versionCode ≥ 2,100,000,000 的包）。 */
export const ANDROID_MAX_VERSION_CODE = 2_100_000_000

/** 字段取值上限（与位权一起决定推导公式的容量，见文件头公式表）。 */
const LIMITS = { major: 9, minor: 9, patch: 99, index: 99, plus: 99 }

/** 预发布标签序号上限：level = 序号×100 + 预发布序号，必须留得下正式版的 999。 */
const MAX_LABEL_RANK = 8

/**
 * 上游预发布标签表：下标即标签序号（rank = index）。
 *
 * **追加式维护**：已在用的标签不能插队——插队会改写历史构建号（版本号不可重排）。
 * 上游换标签（alpha → beta）时在表尾追加即可：新一轮的 level 一定大于上一轮，
 * 构建号因此仍然单调递增。
 */
export const PRERELEASE_LABELS = ['alpha', 'beta', 'rc']

/** 正式版（无预发布段）的 level：必须大于任何预发布 level（8×100+99 = 899）。 */
const STABLE_LEVEL = 999

const CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/
const PRERELEASE_PATTERN = /^([0-9A-Za-z-]+)\.(\d+)$/
const PLUS_SUFFIX_PATTERN = /\.plus\.(\d+)$/

/**
 * 解析无前导零的非负整数并做上界检查。
 * @param {string} text  数字文本
 * @param {string} label 字段名（错误信息用）
 * @param {number} max   上界（不含）
 * @returns {number}
 */
function parseBoundedInteger(text, label, max) {
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a non-negative integer: ${text}`)
  if (text.length > 1 && text.startsWith('0')) {
    throw new Error(`${label} must not have leading zeros: ${text}`)
  }
  const value = Number(text)
  if (value > max) throw new Error(`${label} exceeds the supported range (max ${max}): ${text}`)
  return value
}

/**
 * 拆出 `.plus.<N>` 后缀，返回剩余的 base 与 plus 计数。
 * @param {string} raw 已剥掉 `v` 前缀的版本串
 * @returns {{ base: string, plus: number }}
 */
function splitPlusSuffix(raw) {
  const match = PLUS_SUFFIX_PATTERN.exec(raw)
  if (match === null) return { base: raw, plus: 0 }
  // N 从 1 起：`.plus.0` 不是一次发版（版本号生成器产出的是 plus.1、plus.2…）。
  const plus = parseBoundedInteger(match[1], 'plus count', LIMITS.plus)
  if (plus === 0) throw new Error('plus count must be at least 1')
  return { base: raw.slice(0, match.index), plus }
}

/**
 * 解析 base（`X.Y.Z` 或 `X.Y.Z-<label>.<index>`）。
 * @param {string} base
 * @returns {{ major: number, minor: number, patch: number, prerelease: { label: string, rank: number, index: number } | null }}
 */
function parseBase(base) {
  const dash = base.indexOf('-')
  const core = dash === -1 ? base : base.slice(0, dash)
  const prereleasePart = dash === -1 ? '' : base.slice(dash + 1)
  const match = CORE_PATTERN.exec(core)
  if (match === null) throw new Error(`unexpected upstream version: ${base}`)
  const major = parseBoundedInteger(match[1], 'major', LIMITS.major)
  const minor = parseBoundedInteger(match[2], 'minor', LIMITS.minor)
  const patch = parseBoundedInteger(match[3], 'patch', LIMITS.patch)
  let prerelease = null
  if (prereleasePart !== '') {
    const pre = PRERELEASE_PATTERN.exec(prereleasePart)
    if (pre === null) {
      throw new Error(`unsupported prerelease "${prereleasePart}": expected "<label>.<index>"`)
    }
    const label = pre[1]
    const rank = PRERELEASE_LABELS.indexOf(label)
    if (rank === -1) {
      throw new Error(
        `unknown prerelease label "${label}": append it to PRERELEASE_LABELS in scripts/plus/mobile-version.mjs ` +
        '(append only — inserting would renumber published build codes)',
      )
    }
    if (rank > MAX_LABEL_RANK) {
      throw new Error(
        `prerelease label "${label}" has rank ${rank}, past the supported range (max ${MAX_LABEL_RANK})`,
      )
    }
    prerelease = { label, rank, index: parseBoundedInteger(pre[2], 'prerelease index', LIMITS.index) }
  }
  return { major, minor, patch, prerelease }
}

/**
 * 解析 plus 版本 → 推导公式的字段。
 * @param {string} version `X.Y.Z[-<label>.<index>][.plus.<N>]`，允许带 `v` 前缀
 * @returns {{ major: number, minor: number, patch: number, prerelease: object | null, plus: number, level: number }}
 */
export function parsePlusVersion(version) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('plus version must be a non-empty string')
  }
  const raw = version.startsWith('v') ? version.slice(1) : version
  if (raw.includes('+')) {
    throw new Error(
      `plus version ${version}: build metadata is not allowed — keep ".plus.N" in the prerelease part, ` +
      'moving it after "+" makes every build compare equal (SemVer §10)',
    )
  }
  const { base, plus } = splitPlusSuffix(raw)
  const { major, minor, patch, prerelease } = parseBase(base)
  const level = prerelease === null ? STABLE_LEVEL : prerelease.rank * 100 + prerelease.index
  if (prerelease !== null && level >= STABLE_LEVEL) {
    throw new Error(`prerelease level ${level} collides with the stable level ${STABLE_LEVEL}`)
  }
  return { major, minor, patch, prerelease, plus, level }
}

/**
 * 移动端安装版本号（Android versionCode）——从 plus 版本确定性推导，单调递增。
 * @param {string} version plus 版本
 * @returns {number} Android versionCode（≤ ANDROID_MAX_VERSION_CODE）
 */
export function mobileVersionCode(version) {
  const { major, minor, patch, level, plus } = parsePlusVersion(version)
  const code = major * 100_000_000 + minor * 10_000_000 + patch * 100_000 + level * 100 + plus
  if (code > ANDROID_MAX_VERSION_CODE) {
    throw new Error(`mobile version code ${code} exceeds the Android limit ${ANDROID_MAX_VERSION_CODE}`)
  }
  return code
}

/**
 * 移动端安装版本号（iOS CFBundleVersion）——与 versionCode 同一套字段，同一单调序。
 * @param {string} version plus 版本
 * @returns {string} 1~3 段点分整数，如 `0.2.200209`
 */
export function mobileBundleVersion(version) {
  const { major, minor, patch, level, plus } = parsePlusVersion(version)
  return `${major}.${minor}.${patch * 100_000 + level * 100 + plus}`
}

/**
 * 把版本串整理成可比较形态：剥 `v` 前缀，拒绝构建元数据与非法 SemVer。
 * @param {string} version
 * @returns {string}
 */
function comparableVersion(version) {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('version must be a non-empty string')
  }
  const raw = version.startsWith('v') ? version.slice(1) : version
  if (raw.includes('+')) {
    throw new Error(
      `version ${version}: build metadata is not allowed — ".plus.N" must stay in the prerelease part, ` +
      'moving it after "+" makes every build compare equal (SemVer §10)',
    )
  }
  const plus = PLUS_SUFFIX_PATTERN.exec(raw)
  if (plus !== null && plus[1].length > 1 && plus[1].startsWith('0')) {
    throw new Error(
      `version ${version}: plus count must not have leading zeros — ` +
      'SemVer §9 forbids them, so "plus.010" is not a valid version',
    )
  }
  if (semverValid(raw) === null) throw new Error(`not a valid SemVer version: ${version}`)
  return raw
}

/**
 * 比较两个 plus 版本（SemVer 优先级）。
 *
 * 复用 npm `semver`（仓库既有工具，upstream 各包同款）：plus 版本本身就是合法 SemVer，
 * `X.Y.Z[-pre].plus.N` 的预发布标识符是 `[..., 'plus', N]`，其中 N 是纯数字标识符，
 * 按数值比较（SemVer §11）——所以 plus.2 < plus.9 < plus.10 排得对。
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} -1 / 0 / 1
 */
export function comparePlusVersions(left, right) {
  return semverCompare(comparableVersion(left), comparableVersion(right))
}

/**
 * candidate 是否比 current 新（移动端更新判定用）。
 * @param {string} candidate 待比较的新版本
 * @param {string} current 已安装的版本
 * @returns {boolean}
 */
export function isNewerPlusVersion(candidate, current) {
  return comparePlusVersions(candidate, current) > 0
}
