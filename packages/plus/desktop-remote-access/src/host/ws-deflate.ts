// permessage-deflate 终止（RFC 7692）：lane 自答扩展，两端各说各的压缩。
//
// 为什么 lane 必须解压而不是原样转发：页面（浏览器内核）会自己带上
// `Sec-WebSocket-Extensions: permessage-deflate`，而 lane 向上游（dsh 网关）
// **不转交**这个协商——于是 dsh 侧是不压缩的明文连接。若把页面的压缩帧原样
// 灌给 dsh，网关把 deflate 字节当明文解析，必然是协议错误 + 主动关连接
// （手机端表现就是「历史加载失败」后立刻重连）。所以方向是固定的：
//
//   页面 ──压缩帧──▶ lane 解压 ──明文帧──▶ dsh
//   页面 ◀──压缩帧── lane 压缩 ◀──明文帧── dsh
//
// 好处是压缩只发生在「手机 ↔ 局域网 lane」这一跳（弱网带宽真正省在这里），
// 而 dsh 网关看到的字节流与本地浏览器完全一致——它那边任何压缩相关的路径
// 都不再参与，也就没有「压缩态和心跳/判死窗口互相干扰」的可能。
//
// 上下文接管：协商里固定 `client_no_context_takeover; server_no_context_takeover`，
// 每条消息独立压缩，不跨消息保留字典——lane 因而可以按消息同步编解码，
// 不需要每条连接维护 zlib 流状态（弱网断连重建时也没有残态可留）。
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from 'node:zlib'
import {
  decodeFrame,
  encodeFrame,
  isControlOpcode,
  closePayload,
  OP_CLOSE,
  OP_CONTINUATION,
} from './ws-frame.js'
import type { HeaderBag } from './proxy.js'

/** lane 对页面应答的扩展参数（同时也是我们唯一支持的形态）。 */
export const DEFLATE_EXTENSION = 'permessage-deflate; client_no_context_takeover; server_no_context_takeover'

/** 小于该长度的消息不压缩：deflate 的固定开销与控制帧交错延迟不划算。 */
const COMPRESS_MIN_BYTES = 256

/** 单条消息累计上限：超限按协议错误关闭（1009），绝不让 lane 内存被一条消息拖爆。 */
const MESSAGE_MAX_BYTES = 100 * 1024 * 1024

/** deflate 的 sync-flush 尾标记：压缩输出要去掉它，解压要补上（等价于 Z_SYNC_FLUSH）。 */
const ZLIB_OPTS = { finishFlush: zlibConstants.Z_SYNC_FLUSH } as const

/** 页面是否提出了 permessage-deflate 协商。 */
export function wantsPermessageDeflate(headers: HeaderBag): boolean {
  const raw = headers['sec-websocket-extensions']
  const list = Array.isArray(raw) ? raw.join(',') : String(raw ?? '')
  return /(^|,)\s*permessage-deflate\b/i.test(list)
}

/** 剥掉页面提的压缩协商：dsh 侧必须是明文连接（由 lane 负责压缩终点）。 */
export function stripDeflateOffer(headers: HeaderBag): void {
  delete headers['sec-websocket-extensions']
}

/** 压缩一条消息；压缩后不更小则返回 null（对端允许未压缩消息，RSV1=0 即可）。 */
export function compressMessage(plain: Buffer): Buffer | null {
  if (plain.length < COMPRESS_MIN_BYTES) return null
  const out = deflateRawSync(plain, ZLIB_OPTS)
  // 去掉 Z_SYNC_FLUSH 的 00 00 FF FF 尾巴（RFC 7692 §7.2.1：载荷不带 flush 标记）。
  const cut = out.length >= 4
    && out[out.length - 4] === 0x00 && out[out.length - 3] === 0x00
    && out[out.length - 2] === 0xff && out[out.length - 1] === 0xff
    ? out.subarray(0, out.length - 4)
    : out
  return cut.length < plain.length ? cut : null
}

/** 解压一条消息（调用方保证是完整消息）。 */
export function decompressMessage(compressed: Buffer): Buffer {
  return inflateRawSync(compressed, ZLIB_OPTS)
}

/** 单向转码器：吃一侧的原始帧字节，吐对端的原始帧字节。 */
export interface DeflateDirection {
  /** 输入一段原始字节（可为任意切分），返回要写往对端的字节（可能是空）。 */
  push(chunk: Buffer): Buffer
  /** 连接断开时丢弃半条消息（半条消息无法转码，也没有对端可写）。 */
  reset(): void
  /** 帧流已不可信（解压失败 / 消息超限）：调用方应关闭连接。 */
  readonly broken: boolean
}

/** 转码方向：toClient=true 是 dsh→页面（输出不掩码）；false 是页面→dsh（输出必须掩码）。 */
export interface DeflateDirectionOptions {
  toClient: boolean
}

/**
 * 创建单向转码器。行为要点：
 *  - 控制帧（close/ping/pong）立即透传，且按目标方向重写掩码位；
 *  - 数据帧按**消息**聚合，FIN 时才产出：压缩消息先解压，再按目标方向重新编码；
 *  - 分片消息合并成单帧转发（mux 不对帧边界做假设，合并反而少一次分片头）；
 *  - 输出帧保留原操作码（text/binary），RSV1 由目标方向决定。
 */
export function createDeflateDirection({ toClient }: DeflateDirectionOptions): DeflateDirection {
  let buf: Buffer | null = null
  let msgOpcode = OP_CONTINUATION
  let msgCompressed = false
  let msgParts: Buffer[] = []
  let msgBytes = 0
  let broken = false

  const encodeOut = (opcode: number, payload: Buffer, rsv1: boolean): Buffer =>
    encodeFrame(opcode, payload, { rsv1, masked: !toClient })

  /** 收尾一条完整消息 → 对端帧。 */
  const finishMessage = (): Buffer => {
    const joined = msgParts.length === 1 ? msgParts[0]! : Buffer.concat(msgParts)
    msgParts = []
    msgBytes = 0
    let plain = joined
    if (msgCompressed) {
      try {
        plain = decompressMessage(joined)
      } catch {
        // 页面给的压缩流解不开：不是可恢复错误，按协议错误关闭。
        broken = true
        return encodeOut(OP_CLOSE, closePayload(1007, 'deflate'), false)
      }
    }
    if (!toClient) return encodeOut(msgOpcode, plain, false)
    const z = compressMessage(plain)
    if (z === null) return encodeOut(msgOpcode, plain, false)
    return encodeOut(msgOpcode, z, true)
  }

  return {
    get broken() { return broken },
    reset() {
      buf = null
      msgParts = []
      msgBytes = 0
      msgCompressed = false
    },
    push(chunk: Buffer): Buffer {
      if (broken) return Buffer.alloc(0)
      buf = buf === null ? chunk : Buffer.concat([buf, chunk])
      const out: Buffer[] = []
      let offset = 0
      while (offset < buf.length) {
        const frame = decodeFrame(buf, offset)
        if (frame === null) break
        if (frame === undefined) {
          // 帧信封非法：转码无法继续（不知道载荷边界），按协议错误关闭。
          broken = true
          out.push(encodeOut(OP_CLOSE, closePayload(1002, 'frame'), false))
          offset = buf.length
          break
        }
        offset += frame.total
        if (isControlOpcode(frame.opcode)) {
          out.push(encodeFrame(frame.opcode, frame.payload, { fin: frame.fin, masked: !toClient }))
          continue
        }
        if (frame.opcode !== OP_CONTINUATION) {
          // 新消息首帧：RSV1 只在这里有意义。
          msgOpcode = frame.opcode
          msgCompressed = frame.rsv1
          msgParts = []
          msgBytes = 0
        } else if (msgParts.length === 0) {
          // 无首帧的续帧：帧流已乱，放弃转码。
          broken = true
          out.push(encodeOut(OP_CLOSE, closePayload(1002, 'continuation'), false))
          offset = buf.length
          break
        }
        msgBytes += frame.payload.length
        if (msgBytes > MESSAGE_MAX_BYTES) {
          broken = true
          out.push(encodeOut(OP_CLOSE, closePayload(1009, 'too big'), false))
          offset = buf.length
          break
        }
        msgParts.push(frame.payload)
        if (frame.fin) out.push(finishMessage())
      }
      buf = offset >= buf.length ? null : buf.subarray(offset)
      return out.length === 0 ? Buffer.alloc(0) : Buffer.concat(out)
    },
  }
}
