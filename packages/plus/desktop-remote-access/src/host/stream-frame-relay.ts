//! 流式通道的帧中继（#151）：浏览器 ↔ 本机宿主 ↔ A 机 mux 之间，逐帧把会话 id 换成对面认识的那个。
//!
//! 流式路由原先把 WebSocket 字节原样透传。帧里带的是本机镜像 id（打开帧的参数、上行数据）或远端会话 id
//! （下行数据），对面都不认识。这里把字节流拆成一帧一帧：完整的未压缩文本帧解析后按方向替换 id，再按输出
//! 方向要求的掩码重新编码；二进制、分片、压缩帧与控制帧不翻译，原样重编码转发。
import type { Socket } from 'node:net'
import { replaceSessionIds } from './mirror-id.js'
import { OP_TEXT, decodeFrame, encodeFrame, type DecodedFrame } from './ws-frame.js'

/** 文本帧的翻译器：返回改写后的文本；返回原串表示不动。 */
export type FrameTextTranslator = (text: string) => string

/** mux 帧里与翻译有关的部分。 */
interface MuxFrame {
  type?: unknown
  payload?: unknown
  value?: unknown
}

/**
 * 生成一个方向的文本帧翻译器。
 * @param pairs 「帧里现在写的 id → 应该换成的 id」；只替换整串相等的值。
 * @returns 翻译器：打开帧改写参数，数据帧改写值，其余类型原样返回。
 */
export function streamFrameTranslator(pairs: Record<string, string>): FrameTextTranslator {
  return (text) => {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return text }
    if (parsed === null || typeof parsed !== 'object') return text
    const frame = parsed as MuxFrame
    if (frame.type === 'open') {
      const payload = frame.payload
      if (payload === null || typeof payload !== 'object') return text
      const args = (payload as { args?: unknown }).args
      const next = replaceSessionIds(args, pairs)
      return next === args ? text : JSON.stringify({ ...frame, payload: { ...(payload as object), args: next } })
    }
    if (frame.type === 'item') {
      const next = replaceSessionIds(frame.value, pairs)
      return next === frame.value ? text : JSON.stringify({ ...frame, value: next })
    }
    return text
  }
}

/** 一段字节的中继结果。 */
export interface RelayResult {
  /** 待写往对端的帧，已按输出方向编码。 */
  out: Buffer[]
  /** 尚不完整的帧头尾，留待与下一段拼接。 */
  rest: Buffer
  /** 遇到非法帧头：调用方应断开这条连接。 */
  invalid: boolean
}

/**
 * 把一段字节里的完整帧逐个翻译并重新编码。
 * @param chunk 这一段收到的字节（应已拼上一次剩下的部分）。
 * @param translate 文本帧翻译器。
 * @param maskedOutput 输出方向是否必须带掩码（写给对端服务器时为 true）。
 * @returns 待发出的帧、剩余的不完整字节、是否遇到非法帧。
 */
export function relayFrames(chunk: Buffer, translate: FrameTextTranslator, maskedOutput: boolean): RelayResult {
  const out: Buffer[] = []
  let offset = 0
  while (offset < chunk.length) {
    const frame = decodeFrame(chunk, offset)
    if (frame === null) break
    if (frame === undefined) return { out, rest: chunk.subarray(0, 0), invalid: true }
    offset += frame.total
    out.push(reencode(frame, translate, maskedOutput))
  }
  return { out, rest: chunk.subarray(offset), invalid: false }
}

/** 一帧的再编码：可翻译的文本帧改写后再编码，其余帧只调整掩码方向。 */
function reencode(frame: DecodedFrame, translate: FrameTextTranslator, maskedOutput: boolean): Buffer {
  const options = { fin: frame.fin, rsv1: frame.rsv1, masked: maskedOutput }
  if (frame.opcode === OP_TEXT && frame.fin && !frame.rsv1) {
    const text = translate(frame.payload.toString('utf8'))
    if (text !== frame.payload.toString('utf8')) return encodeFrame(OP_TEXT, Buffer.from(text, 'utf8'), options)
    return encodeFrame(OP_TEXT, frame.payload, options)
  }
  return encodeFrame(frame.opcode, frame.payload, options)
}

/**
 * 在两条连接之间做单向中继：收到的每段字节先拼进缓冲，再逐帧翻译、编码、写给对端。
 * @param source 收数据的一端。
 * @param target 写数据的一端。
 * @param translate 文本帧翻译器。
 * @param maskedOutput 写给对端时是否带掩码。
 * @param initial 握手时随升级请求一并到达的字节，先于 data 事件处理。
 * @returns 停止中继并清理监听的函数。
 */
export function relaySocket(
  source: Socket,
  target: Socket,
  translate: FrameTextTranslator,
  maskedOutput: boolean,
  initial: Buffer = Buffer.alloc(0),
): () => void {
  let pending = initial
  const drain = (): void => {
    const { out, rest, invalid } = relayFrames(pending, translate, maskedOutput)
    pending = rest
    if (invalid) {
      source.destroy()
      target.destroy()
      return
    }
    if (out.length > 0 && !target.destroyed) target.write(Buffer.concat(out))
  }
  const onData = (chunk: Buffer): void => {
    pending = Buffer.concat([pending, chunk])
    drain()
  }
  source.on('data', onData)
  if (pending.length > 0) drain()
  return () => { source.off('data', onData) }
}
