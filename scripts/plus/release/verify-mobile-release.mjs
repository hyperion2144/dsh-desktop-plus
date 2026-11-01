#!/usr/bin/env node
// 移动端更新链路的发布后校验（发版流水线用，票 #66）。
//
// 用法：
//   node scripts/plus/release/verify-mobile-release.mjs \
//     --feed https://github.com/<repo>/releases/download/<tag>/nightly-android.yml \
//     [--artifact-dir <目录>]
//
// 校验三件事——正好是壳启动时做的三件事：
//   1. feed 能下载（壳拉的就是这份小文件，不走 api.github.com 的额度池）；
//   2. 元数据里的 `files[].url` 相对 feed 目录能解析出产物地址（壳的拼接规则）；
//   3. 产物的 sha512 与字节数与元数据一致（壳下载后比对的就是这两个，对不上就不装）。
//
// 这一份解析是**独立实现**的（壳那边是 Kotlin/Python 的另一份）：发布后校验要
// 能发现「生成器写出来的形状」与「客户端读出来的形状」不一致，所以不能用生成器
// 自己的解析器给自己打分。

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 解析 channel yml（键结构固定，见 `scripts/plus/mobile-metadata.mjs`）。
 * @param {string} text yml 文本
 * @returns {{version: string, files: {url: string, sha512: string, size: number}[], path: string, sha512: string, releaseDate: string}}
 */
export function parseChannelMetadata(text) {
  const files = []
  let version = null
  let path = null
  let sha512 = null
  let releaseDate = null
  let current = null
  let inFiles = false

  /** 把当前列表项收进 files。 */
  const flush = () => {
    if (current !== null) files.push(current)
    current = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const indented = /^\s/.test(raw)
    if (!indented) {
      flush()
      inFiles = false
      const { key, value } = splitEntry(line)
      if (key === 'version') version = value
      else if (key === 'files') inFiles = true
      else if (key === 'path') path = value
      else if (key === 'sha512') sha512 = value
      else if (key === 'releaseDate') releaseDate = value
      continue
    }
    if (!inFiles) continue
    if (line.startsWith('- ')) {
      flush()
      const { key, value } = splitEntry(line.slice(2).trim())
      current = { url: key === 'url' ? value : '', sha512: '', size: 0 }
      if (key !== 'url') {
        applyAttribute(current, key, value)
      }
      continue
    }
    if (current !== null) {
      const { key, value } = splitEntry(line)
      applyAttribute(current, key, value)
    }
  }
  flush()

  if (version === null || version === '') throw new Error('channel metadata: missing version')
  if (path === null || path === '') throw new Error('channel metadata: missing path')
  if (files.length === 0) throw new Error('channel metadata: missing files')
  return { version, files, path, sha512: sha512 ?? '', releaseDate: releaseDate ?? '' }
}

/**
 * 给一个产物条目补字段。
 * @param {{url: string, sha512: string, size: number}} file 产物条目
 * @param {string} key 键
 * @param {string} value 值
 */
function applyAttribute(file, key, value) {
  if (key === 'url') file.url = value
  else if (key === 'sha512') file.sha512 = value
  else if (key === 'size') file.size = Number(value)
}

/**
 * 拆 `key: value`；值两侧的引号剥掉。
 * @param {string} line 一行
 * @returns {{key: string, value: string}}
 */
function splitEntry(line) {
  const index = line.indexOf(':')
  if (index <= 0) throw new Error(`channel metadata: malformed line "${line}"`)
  const key = line.slice(0, index).trim()
  const value = line.slice(index + 1).trim()
  return { key, value: unquote(value) }
}

/**
 * 剥掉值两侧的引号。
 * @param {string} value 值
 * @returns {string}
 */
function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) return value.slice(1, -1)
  }
  return value
}

/**
 * 产物地址：相对 feed 所在目录拼接（壳的规则，见 `UpdateFeed.artifactUrl`）。
 * @param {string} feedUrl feed 地址
 * @param {string} fileName 元数据里的文件名
 * @returns {string}
 */
export function resolveArtifactUrl(feedUrl, fileName) {
  const url = feedUrl.trim()
  const index = url.lastIndexOf('/')
  const base = index <= 0 ? url : url.slice(0, index)
  return `${base.replace(/\/+$/, '')}/${fileName.replace(/^\/+/, '')}`
}

/**
 * 拉一份 feed，解析，并把它的产物拉下来比对 sha512 与大小。
 * @param {object} options feed 地址与产物落盘目录
 * @returns {Promise<{version: string, artifactUrl: string, size: number, sha512: string}>}
 */
export async function verifyChannelFeed({ feedUrl, artifactDir }) {
  const response = await fetch(feedUrl)
  if (!response.ok) throw new Error(`feed 下载失败：HTTP ${response.status} ${feedUrl}`)
  const metadata = parseChannelMetadata(await response.text())
  const file = metadata.files[0]
  const artifactUrl = resolveArtifactUrl(feedUrl, file.url)
  const artifactResponse = await fetch(artifactUrl)
  if (!artifactResponse.ok) throw new Error(`产物下载失败：HTTP ${artifactResponse.status} ${artifactUrl}`)
  const bytes = Buffer.from(await artifactResponse.arrayBuffer())
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  if (sha512 !== file.sha512) {
    throw new Error(`产物 sha512 不匹配：元数据 ${file.sha512}，实际 ${sha512}（${artifactUrl}）`)
  }
  if (bytes.length !== file.size) {
    throw new Error(`产物大小不匹配：元数据 ${file.size}，实际 ${bytes.length}（${artifactUrl}）`)
  }
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(join(artifactDir, file.url), bytes)
  return { version: metadata.version, artifactUrl, size: bytes.length, sha512 }
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const argv = process.argv.slice(2)
  const feedIndex = argv.indexOf('--feed')
  const dirIndex = argv.indexOf('--artifact-dir')
  const feedUrl = feedIndex === -1 ? undefined : argv[feedIndex + 1]
  const artifactDir = dirIndex === -1 ? resolve('dist/mobile-verify') : resolve(argv[dirIndex + 1])
  if (feedUrl === undefined) {
    console.error('verify-mobile-release: missing --feed <url>')
    process.exit(1)
  }
  try {
    const result = await verifyChannelFeed({ feedUrl, artifactDir })
    console.log(`feed ${feedUrl}`)
    console.log(`  版本：${result.version}`)
    console.log(`  产物：${result.artifactUrl}`)
    console.log(`  sha512 与大小都对上了（${result.size} 字节）`)
  } catch (error) {
    console.error(`verify-mobile-release: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
