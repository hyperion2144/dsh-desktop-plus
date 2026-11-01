// 移动端更新元数据生成（票 #58）。
//
// 移动端壳的更新检查只拉一份几百字节的小文件（不碰 api.github.com 的 60 次/小时限额），
// 所以沿用桌面已经在用的 **channel yml** 形态：同一个 GitHub Release 里多发一份移动端元数据，
// 每个平台一份。桌面发的是 `nightly.yml` / `nightly-mac.yml` / `nightly-linux.yml`，
// 移动端对应 `nightly-android.yml` / `nightly-ios.yml`。
//
// 元数据字段与桌面 channel yml **逐字同形**（见 `renderChannelMetadata`）：
//
//   version: <plus 版本>
//   files:
//     - url: <产物文件名>
//       sha512: <产物 sha512（base64）>
//       size: <产物流字节数>
//   path: <产物文件名>
//   sha512: <产物 sha512（base64）>
//   releaseDate: '<ISO 时间>'
//
// 说明：
//   - `files[].url` 是**文件名**而不是完整 URL——客户端相对 feed 根拼接（与桌面一致）。
//   - 元数据里**不含**移动端自己的安装版本号（versionCode / CFBundleVersion）：
//     它由 plus 版本经 `mobile-version.mjs` 的公式确定性推出，客户端本地算即可，
//     元数据因此保持与桌面同形（桌面那一侧也没有额外字段）。
//   - 本模块是**纯函数**：不读文件、不联网。产物的 sha512 / size 由发版流水线算好后传入。

import { parsePlusVersion } from './mobile-version.mjs'

/** 随发版直发的移动平台 → 产物扩展名（鸿蒙不随发版，见 spec #55）。 */
export const MOBILE_PLATFORMS = { android: 'apk', ios: 'ipa' }

/** 渠道名：桌面用的就是 `nightly`（plus 版本号必带 prerelease，`latest` 渠道会被 stable-only 校验拒绝）。 */
export const DEFAULT_MOBILE_CHANNEL = 'nightly'

/** 产物名前缀：与桌面 `dsh-desktop-plus-<version>-<os>-<arch>...` 同族，移动端加 `mobile` 段。 */
const ARTIFACT_PREFIX = 'dsh-desktop-plus-mobile'

/** sha512 校验和的形状：64 字节 base64（与桌面发版元数据同一形状）。 */
const SHA512_PATTERN = /^[A-Za-z0-9+/]{86}==$/

/**
 * 平台是否受支持。
 * @param {string} platform
 * @returns {boolean}
 */
export function isMobilePlatform(platform) {
  return Object.prototype.hasOwnProperty.call(MOBILE_PLATFORMS, platform)
}

/**
 * 移动端产物文件名（发版流水线与元数据共用同一套命名）。
 * @param {string} platform `android` / `ios`
 * @param {string} version plus 版本
 * @returns {string}
 */
export function mobileArtifactName(platform, version) {
  const extension = MOBILE_PLATFORMS[platform]
  if (extension === undefined) {
    throw new Error(`unknown mobile platform: ${platform} (expected one of ${Object.keys(MOBILE_PLATFORMS).join(', ')})`)
  }
  return `${ARTIFACT_PREFIX}-${version}-${platform}.${extension}`
}

/**
 * 移动端元数据文件名（随 Release 上传的 asset 名）。
 * @param {string} platform `android` / `ios`
 * @param {string} [channel] 渠道名，默认 `nightly`
 * @returns {string}
 */
export function mobileChannelFileName(platform, channel = DEFAULT_MOBILE_CHANNEL) {
  if (!isMobilePlatform(platform)) throw new Error(`unknown mobile platform: ${platform}`)
  return `${channel}-${platform}.yml`
}

/**
 * 归一化发布时间：接受 Date 或 ISO 字符串，统一成毫秒精度的 ISO 串。
 * @param {Date | string} releaseDate
 * @returns {string}
 */
function normalizeReleaseDate(releaseDate) {
  const date = releaseDate instanceof Date ? releaseDate : new Date(String(releaseDate))
  if (Number.isNaN(date.getTime())) throw new Error(`invalid release date: ${releaseDate}`)
  return date.toISOString()
}

/**
 * 校验并归一化一个平台产物描述。
 * @param {{ filename?: string, url?: string, sha512: string, size: number }} artifact
 * @param {string} platform
 * @param {string} version
 * @returns {{ filename: string, url: string, sha512: string, size: number }}
 */
function normalizeArtifact(artifact, platform, version) {
  if (artifact === null || typeof artifact !== 'object') {
    throw new Error(`missing artifact for platform ${platform}`)
  }
  const filename = artifact.filename ?? mobileArtifactName(platform, version)
  if (typeof filename !== 'string' || filename === '') {
    throw new Error(`artifact filename must be a non-empty string (platform ${platform})`)
  }
  if (typeof artifact.sha512 !== 'string' || !SHA512_PATTERN.test(artifact.sha512)) {
    throw new Error(`artifact sha512 must be base64 of a 64-byte digest (platform ${platform})`)
  }
  if (!Number.isInteger(artifact.size) || artifact.size <= 0) {
    throw new Error(`artifact size must be a positive integer (platform ${platform})`)
  }
  return { filename, url: artifact.url ?? filename, sha512: artifact.sha512, size: artifact.size }
}

/**
 * 生成一个平台的移动端更新元数据（字段与桌面 channel yml 同形）。
 * @param {{ version: string, platform: string, artifact: object, releaseDate: Date | string }} input
 * @returns {{ version: string, files: { url: string, sha512: string, size: number }[], path: string, sha512: string, releaseDate: string }}
 */
export function mobileChannelMetadata({ version, platform, artifact, releaseDate }) {
  if (!isMobilePlatform(platform)) {
    throw new Error(`unknown mobile platform: ${platform} (expected one of ${Object.keys(MOBILE_PLATFORMS).join(', ')})`)
  }
  // 版本合法性由 plus 版本解析器裁决（顺带挡住补零 / 构建元数据那两个已知坑）。
  parsePlusVersion(version)
  const normalized = normalizeArtifact(artifact, platform, version)
  return {
    version,
    files: [{ url: normalized.url, sha512: normalized.sha512, size: normalized.size }],
    path: normalized.filename,
    sha512: normalized.sha512,
    releaseDate: normalizeReleaseDate(releaseDate),
  }
}

/**
 * 把元数据渲染成桌面 channel yml 形态的 YAML 文本（键序与桌面一致，缩进两空格）。
 * @param {ReturnType<typeof mobileChannelMetadata>} metadata
 * @returns {string}
 */
export function renderChannelMetadata(metadata) {
  const lines = [`version: ${metadata.version}`, 'files:']
  for (const file of metadata.files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    lines.push(`    size: ${file.size}`)
  }
  lines.push(`path: ${metadata.path}`)
  lines.push(`sha512: ${metadata.sha512}`)
  // releaseDate 始终加引号：裸 ISO 串会被 YAML 解析成时间戳而不是字符串。
  lines.push(`releaseDate: '${metadata.releaseDate}'`)
  return `${lines.join('\n')}\n`
}

/**
 * 给定 plus 版本与平台产物清单，生成各平台一份移动端更新元数据文件。
 *
 * @param {{ version: string, artifacts: object[], releaseDate: Date | string, channel?: string }} input
 *   `artifacts` 每项含 `platform`，以及 `filename`（缺省按 `mobileArtifactName` 推）、
 *   `sha512`、`size`。
 * @returns {Record<string, { filename: string, contents: string }>} 平台 → 元数据文件
 */
export function mobileChannelFiles({ version, artifacts, releaseDate, channel = DEFAULT_MOBILE_CHANNEL }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('mobile metadata needs at least one platform artifact')
  }
  const files = {}
  for (const artifact of artifacts) {
    const platform = artifact?.platform
    if (!isMobilePlatform(platform)) {
      throw new Error(`unknown mobile platform: ${platform} (expected one of ${Object.keys(MOBILE_PLATFORMS).join(', ')})`)
    }
    if (files[platform] !== undefined) {
      throw new Error(`duplicate mobile artifact for platform ${platform}`)
    }
    const metadata = mobileChannelMetadata({ version, platform, artifact, releaseDate })
    files[platform] = { filename: mobileChannelFileName(platform, channel), contents: renderChannelMetadata(metadata) }
  }
  return files
}
