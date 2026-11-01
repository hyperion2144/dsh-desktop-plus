// 产物的校验和与大小（发版流水线用，票 #66）。
//
// 移动端更新元数据里要写产物的 sha512 与字节数：壳下载 apk 后比对 sha512，
// 对不上就不装（见 `mobile/android/.../shell/update/ApkDownloader.kt`）。
//
// 形状与桌面 channel yml 一致：**sha512 是 64 字节摘要的 base64**（不是 hex）——
// 桌面那份由 electron-builder 生成，本模块与它同形，客户端解析器才是一套。
//
// 这一层只做 I/O 与摘要计算：不懂版本、不懂渠道、不懂元数据形状（那些在
// `scripts/plus/mobile-metadata.mjs`）。

import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'

/**
 * 产物的 sha512（base64）与字节数。
 *
 * 摘要与大小取自**同一份字节**：读完之后再 stat，文件在这中间被换掉的话，
 * 大小与摘要就对不上——发版流水线里产物是刚构建出来的，不会发生。
 *
 * @param {string} path 产物路径
 * @returns {Promise<{sha512: string, size: number}>} sha512（base64）与字节数
 */
export async function digestArtifact(path) {
  const hash = createHash('sha512')
  const stream = createReadStream(path)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return { sha512: hash.digest('base64'), size: statSync(path).size }
}
