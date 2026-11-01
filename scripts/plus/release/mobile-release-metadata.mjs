#!/usr/bin/env node
// 移动端发版元数据生成（发版流水线用，票 #66）。
//
// 用法：
//   node scripts/plus/release/mobile-release-metadata.mjs \
//     --version 0.2.2-alpha.2.plus.2 \
//     --out-dir dist/mobile-metadata \
//     --artifact android=build/app-release.apk \
//     --artifact ios=build/DshMobile.ipa \
//     [--channel nightly] [--release-date 2026-11-01T00:00:00.000Z]
//
// 产出：
//   <out-dir>/nightly-android.yml   Android 更新元数据（壳拉它做版本比对）
//   <out-dir>/nightly-ios.yml       iOS 更新元数据
//   <out-dir>/summary.json          流水线清单：资产名 + sha512 + size
//
// 元数据的**形状**由 `scripts/plus/mobile-metadata.mjs` 决定（纯函数，纯函数就是
// 唯一事实源）；本模块只做「读产物 → 算摘要 → 落盘 → 出清单」。
//
// 为什么单独一层 CLI：`mobile-metadata.mjs` 是纯函数（不读文件、不联网、单测友好），
// 发版流水线需要的是「给定产物路径，产出文件」——那是 I/O 侧的活，分开放。

import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MOBILE_CHANNEL, MOBILE_PLATFORMS, mobileArtifactName, mobileChannelFiles } from '../mobile-metadata.mjs'
import { digestArtifact } from './artifact-digest.mjs'

/**
 * 解析命令行参数。
 * @param {string[]} argv 参数数组（不含 node 与脚本名）
 * @returns {{version: string, outDir: string, artifacts: {platform: string, path: string}[], channel: string, releaseDate: string}}
 */
export function parseArguments(argv) {
  const options = { channel: DEFAULT_MOBILE_CHANNEL, artifacts: [], releaseDate: new Date().toISOString() }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = argv[index + 1]
    if (argument === '--version') {
      options.version = requireValue(argument, next)
      index += 1
    } else if (argument === '--out-dir') {
      options.outDir = requireValue(argument, next)
      index += 1
    } else if (argument === '--channel') {
      options.channel = requireValue(argument, next)
      index += 1
    } else if (argument === '--release-date') {
      options.releaseDate = requireValue(argument, next)
      index += 1
    } else if (argument === '--artifact') {
      const value = requireValue(argument, next)
      const separator = value.indexOf('=')
      if (separator <= 0) throw new Error(`--artifact 需要 <platform>=<path>，收到：${value}`)
      options.artifacts.push({ platform: value.slice(0, separator), path: value.slice(separator + 1) })
      index += 1
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  if (options.version === undefined) throw new Error('missing --version <plus 版本>')
  if (options.outDir === undefined) throw new Error('missing --out-dir <目录>')
  if (options.artifacts.length === 0) throw new Error('missing --artifact <platform>=<path>（至少一个）')
  return options
}

/**
 * 取一个参数的值；缺值时当场报错（不发版流水线里静默跳过）。
 * @param {string} name 参数名
 * @param {string | undefined} value 下一个参数
 * @returns {string}
 */
function requireValue(name, value) {
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

/**
 * 产物的扩展名必须与平台对上（apk / ipa）——接错产物是发版事故，挡住。
 * @param {string} platform 平台
 * @param {string} path 产物路径
 */
function assertExtension(platform, path) {
  const expected = MOBILE_PLATFORMS[platform]
  if (expected === undefined) throw new Error(`unknown mobile platform: ${platform}`)
  if (!basename(path).endsWith(`.${expected}`)) {
    throw new Error(`artifact for ${platform} must be a .${expected} file: ${path}`)
  }
}

/**
 * 生成移动端更新元数据文件与流水线清单（并落盘）。
 * @param {object} options 版本、产物清单、输出目录、渠道、发布时间
 * @returns {Promise<{files: Record<string, {filename: string, contents: string}>, summary: object, written: string[]}>}
 */
export async function generateMobileReleaseMetadata(options) {
  const artifacts = []
  for (const artifact of options.artifacts) {
    assertExtension(artifact.platform, artifact.path)
    const digest = await digestArtifact(artifact.path)
    artifacts.push({
      platform: artifact.platform,
      filename: mobileArtifactName(artifact.platform, options.version),
      source: artifact.path,
      sha512: digest.sha512,
      size: digest.size,
    })
  }
  const files = mobileChannelFiles({
    version: options.version,
    artifacts,
    releaseDate: options.releaseDate,
    channel: options.channel,
  })
  const summary = {
    version: options.version,
    channel: options.channel,
    releaseDate: new Date(options.releaseDate).toISOString(),
    artifacts: artifacts.map(artifact => ({
      platform: artifact.platform,
      assetName: artifact.filename,
      source: artifact.source,
      sha512: artifact.sha512,
      size: artifact.size,
      metadata: files[artifact.platform].filename,
    })),
  }
  const outDir = resolve(options.outDir)
  mkdirSync(outDir, { recursive: true })
  const written = []
  for (const file of Object.values(files)) {
    const path = join(outDir, file.filename)
    writeFileSync(path, file.contents)
    written.push(path)
  }
  const summaryPath = join(outDir, 'summary.json')
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  written.push(summaryPath)
  return { files, summary, written }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const { summary } = await generateMobileReleaseMetadata(options)
    for (const artifact of summary.artifacts) {
      console.log(`${artifact.platform}: ${artifact.assetName}（${artifact.size} 字节，sha512 ${artifact.sha512.slice(0, 16)}…）`)
      console.log(`  元数据：${artifact.metadata}`)
    }
  } catch (error) {
    console.error(`mobile-release-metadata: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
