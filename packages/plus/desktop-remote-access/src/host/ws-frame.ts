// WebSocket 帧信封原语（RFC 6455）：长度探测、解码、编码。
// 单独成模块的理由：lane 里有三处要解析同一条帧流——保活泵（注入 ping / 判死）、
// 压缩终止器（转码载荷）、诊断钩子（记录前几帧）。信封语义必须只有一份实现：
// 三处各写一套，任何一次字节对齐分歧都表现为「偶发 1008 掉线」，无法从日志定位。
import { randomBytes } from 'node:crypto'

/** 操作码：连续帧（分片消息的后续帧）。 */
export const OP_CONTINUATION = 0x0
/** 操作码：文本帧。 */
export const OP_TEXT = 0x1
/** 操作码：二进制帧（mux 走这个）。 */
export const OP_BINARY = 0x2
/** 操作码：关闭帧。 */
export const OP_CLOSE = 0x8
/** 操作码：ping。 */
export const OP_PING = 0x9
/** 操作码：pong。 */
export const OP_PONG = 0xa

/** wsFrameLength 结果哨兵：-1 帧/头不完整；-2 帧头声明非法（超长），调用方回退 raw 透传。 */
export const FRAME_INCOMPLETE = -1
export const FRAME_INVALID = -2
/** 单帧声明长度的安全上限（2GB-1）：防异常/恶意帧头把 lane 内存撑爆。 */
export const FRAME_LENGTH_CAP = 0x7fffffff

/** 控制帧（可与分片消息交错，不参与压缩）。 */
export function isControlOpcode(opcode: number): boolean {
  return (opcode & 0x8) !== 0
}

/**
 * 计算 offset 处一个 WebSocket 帧的完整字节数（只解析信封，不解释 RSV/扩展——
 * permessage-deflate 等扩展改变载荷语义，不改变信封长度；对「服务器帧带掩码」的非法
 * 输入保持宽容，按存在掩码键解析，保证透传字节不变）。
 * @returns 完整帧字节数；FRAME_INCOMPLETE；FRAME_INVALID。
 */
export function wsFrameLength(buf: Buffer, offset: number): number {
  if (buf.length - offset < 2) return FRAME_INCOMPLETE
  const masked = ((buf[offset + 1]! & 0x80) !== 0)
  const len7 = buf[offset + 1]! & 0x7f
  let headerLen = 2 + (masked ? 4 : 0)
  let payloadLen = len7
  if (len7 === 126) {
    if (buf.length - offset < headerLen + 2) return FRAME_INCOMPLETE
    payloadLen = buf.readUInt16BE(offset + 2)
    headerLen += 2
  } else if (len7 === 127) {
    if (buf.length - offset < headerLen + 8) return FRAME_INCOMPLETE
    const hi = buf.readUInt32BE(offset + 2)
    const lo = buf.readUInt32BE(offset + 6)
    if (hi > 0 || lo > FRAME_LENGTH_CAP) return FRAME_INVALID
    payloadLen = lo
    headerLen += 8
  }
  if (payloadLen > FRAME_LENGTH_CAP) return FRAME_INVALID
  // 载荷未到齐 = 帧不完整。**缺这一句就是丢字节**：调用方（保活泵）会按「完整帧」
  // 消费掉这一帧的已到部分，剩下的半边字节在下一段里被当成新帧头解析 → 整条流错位，
  // 页面侧表现为 WS 协议错误后重连（跨 TCP 段的大帧、手机弱网下的常态场景）。
  if (buf.length - offset < headerLen + payloadLen) return FRAME_INCOMPLETE
  return headerLen + payloadLen
}

/** 解码后的一帧（方向无关：masked 由信封决定，载荷已去掩码）。 */
export interface DecodedFrame {
  opcode: number
  fin: boolean
  /** permessage-deflate：该消息载荷被压缩（只允许出现在消息首帧）。 */
  rsv1: boolean
  masked: boolean
  payload: Buffer
  total: number
}

/**
 * 解码 offset 处一帧。返回完整帧；null = 帧/头不完整；undefined = 帧头非法。
 * 载荷总是复制出去（调用方可能长期持有，不能跟着输入缓冲被改写）。
 */
export function decodeFrame(buf: Buffer, offset: number): DecodedFrame | null | undefined {
  const n = wsFrameLength(buf, offset)
  if (n === FRAME_INCOMPLETE) return null
  if (n === FRAME_INVALID) return undefined
  const b0 = buf[offset]!
  const b1 = buf[offset + 1]!
  const masked = (b1 & 0x80) !== 0
  const len7 = b1 & 0x7f
  const headerLen = 2 + (len7 === 126 ? 2 : len7 === 127 ? 8 : 0) + (masked ? 4 : 0)
  const payload = Buffer.from(buf.subarray(offset + headerLen, offset + n))
  if (masked) applyMask(payload, buf.subarray(offset + headerLen - 4, offset + headerLen))
  return { opcode: b0 & 0x0f, fin: (b0 & 0x80) !== 0, rsv1: (b0 & 0x40) !== 0, masked, payload, total: n }
}

/** 就地掩码/去掩码（XOR 自反，两个方向同一份实现）。 */
export function applyMask(payload: Buffer, mask: Buffer): void {
  for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i % 4]!
}

/** 编码参数。 */
export interface EncodeFrameOptions {
  /** 默认 true（不置 FIN 即为中间分片）。 */
  fin?: boolean
  /** permessage-deflate 压缩位（只允许消息首帧置位）。 */
  rsv1?: boolean
  /** 默认 false：服务器帧不带掩码；客户端方向必须带。 */
  masked?: boolean
}

/**
 * 编码一帧。masked=true 时随机生成掩码键（安全无关的随机性即可：
 * 帧掩码只防中间代理缓存投毒，不承担密码学职责）。
 */
export function encodeFrame(opcode: number, payload: Buffer, opts: EncodeFrameOptions = {}): Buffer {
  const fin = opts.fin !== false
  const masked = opts.masked === true
  const b0 = (fin ? 0x80 : 0x00) | (opts.rsv1 === true ? 0x40 : 0x00) | (opcode & 0x0f)
  const len = payload.length
  const maskBit = masked ? 0x80 : 0x00
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([b0, maskBit | len])
  } else if (len <= 0xffff) {
    header = Buffer.allocUnsafe(4)
    header[0] = b0
    header[1] = maskBit | 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.allocUnsafe(10)
    header[0] = b0
    header[1] = maskBit | 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  if (!masked) return Buffer.concat([header, payload])
  const mask = randomBytes(4)
  const body = Buffer.from(payload)
  applyMask(body, mask)
  return Buffer.concat([header, mask, body])
}

/** 关闭帧的载荷（2 字节大端状态码 + 可选原因）。 */
export function closePayload(code: number, reason = ''): Buffer {
  const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason))
  body.writeUInt16BE(code & 0xffff, 0)
  if (reason.length > 0) body.write(reason, 2, 'utf8')
  return body
}
