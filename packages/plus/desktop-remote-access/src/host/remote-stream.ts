//! 远端流代理：把 A 机的 typert 流（终端输出、任务列表、文件变更）接到本机。
//!
//! typert 的流不走 HTTP：直接 POST 会被网关拒绝（stream Remote methods must be
//! opened through the stream carrier），必须开 WebSocket 到 `/api/remote.mux`，
//! 用 `{type:'open', streamId, endpoint, payload}` 打开一条逻辑流。
//! 这里实现一个最小 WS 客户端（握手 + 文本帧），只做这件事。
import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { RemoteHostRecord } from './remote-hosts.js'

/** 一条远端流的帧。 */
export interface RemoteStreamFrame {
  /** 帧类型。 */
  type: 'item' | 'error' | 'end'
  /** 帧负载（item 时是流的值）。 */
  value?: unknown
  /** 错误信息（error 时）。 */
  error?: { code?: string, message?: string }
}

/** 最小 WebSocket 文本帧客户端。 */
class TextSocket {
  private readonly socket: import('node:net').Socket
  private buffer = Buffer.alloc(0)
  private readonly listeners = new Set<(text: string) => void>()
  private closed = false

  constructor(socket: import('node:net').Socket) {
    this.socket = socket
    socket.on('data', (chunk: Buffer) => { this.consume(chunk) })
    socket.on('close', () => { this.closed = true })
    socket.on('error', () => { this.closed = true })
  }

  /** 是否已断开。 */
  get isClosed(): boolean { return this.closed }

  /** 订阅一条文本消息。 */
  onText(listener: (text: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 发送一条文本消息（客户端帧必须掩码）。 */
  send(text: string): void {
    if (this.closed) return
    const payload = Buffer.from(text, 'utf8')
    const mask = Buffer.from([1, 2, 3, 4])
    const header: number[] = [0x81]
    if (payload.length < 126) header.push(0x80 | payload.length)
    else if (payload.length < 65536) header.push(0x80 | 126, payload.length >> 8, payload.length & 0xff)
    else {
      header.push(0x80 | 127)
      for (let shift = 56; shift >= 0; shift -= 8) header.push((payload.length / 2 ** shift) & 0xff)
    }
    const masked = Buffer.from(payload)
    for (let i = 0; i < masked.length; i += 1) masked[i] = (masked[i] ?? 0) ^ (mask[i % 4] ?? 0)
    try { this.socket.write(Buffer.concat([Buffer.from(header), mask, masked])) } catch { this.closed = true }
  }

  /** 关闭连接。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.socket.destroy() } catch { /* 已断开 */ }
  }

  /** 解析累积的字节流，按帧边界派发文本消息。 */
  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 2) {
      const first = this.buffer[0] ?? 0
      const second = this.buffer[1] ?? 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) return
        length = ((this.buffer[2] ?? 0) << 8) | (this.buffer[3] ?? 0)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) return
        length = 0
        for (let i = 0; i < 8; i += 1) length = length * 256 + (this.buffer[2 + i] ?? 0)
        offset = 10
      }
      const maskOffset = masked ? 4 : 0
      if (this.buffer.length < offset + maskOffset + length) return
      const maskKey = masked ? this.buffer.subarray(offset, offset + 4) : undefined
      const body = Buffer.from(this.buffer.subarray(offset + maskOffset, offset + maskOffset + length))
      if (maskKey !== undefined) {
        for (let i = 0; i < body.length; i += 1) body[i] = (body[i] ?? 0) ^ (maskKey[i % 4] ?? 0)
      }
      this.buffer = this.buffer.subarray(offset + maskOffset + length)
      if (opcode === 0x8) { this.close(); return }
      if (opcode === 0x1) {
        const text = body.toString('utf8')
        for (const listener of [...this.listeners]) listener(text)
      }
    }
  }
}

/** 打开一条到 A 机 mux 的 WebSocket。 */
async function connectMux(host: RemoteHostRecord): Promise<TextSocket> {
  const origin = new URL(host.origin)
  // 握手 key 必须是 16 字节的 base64（RFC 6455），否则严格的服务端直接 400。
  const key = randomBytes(16).toString('base64')
  return await new Promise<TextSocket>((resolve, reject) => {
    const request = http.request({
      host: origin.hostname,
      port: origin.port === '' ? 80 : Number(origin.port),
      path: '/api/remote.mux',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': key,
        cookie: `dsh_mobile_session=${host.cookie}`,
        // 不带 origin：lane 会把 Host 改写成上游端口，带 origin 反而对不上被判 400。
        // 网关的 admitConnection 会校验来源：缺 origin 直接 400。
        origin: host.origin,
      },
    })
    request.on('upgrade', (_response, socket) => { resolve(new TextSocket(socket)) })
    request.on('response', (response) => { reject(new Error(`mux upgrade 被拒：HTTP ${String(response.statusCode)}`)) })
    request.on('error', (error) => { reject(error) })
    request.end()
  })
}

/**
 * 打开一条远端逻辑流。
 * @param host 已配对主机。
 * @param endpoint typert 端点，例如 `job/list`。
 * @param args 该端点的命名参数。
 * @param signal 取消信号。
 * @returns 帧序列。
 */
export async function* openRemoteStream(
  host: RemoteHostRecord,
  endpoint: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncIterable<unknown> {
  const socket = await connectMux(host)
  const streamId = randomUUID()
  const queue: RemoteStreamFrame[] = []
  let wake: (() => void) | undefined
  let finished = false
  const unsubscribe = socket.onText((text) => {
    let message: { type?: unknown, streamId?: unknown, value?: unknown, error?: { code?: string, message?: string } }
    try { message = JSON.parse(text) as typeof message } catch { return }
    if (message.streamId !== streamId) return
    if (message.type === 'item') queue.push({ type: 'item', value: message.value })
    else if (message.type === 'error') {
      queue.push({ type: 'error', ...(message.error === undefined ? {} : { error: message.error }) })
      finished = true
    }
    else if (message.type === 'end') { queue.push({ type: 'end' }); finished = true }
    wake?.()
  })
  const abort = (): void => { finished = true; wake?.() }
  signal?.addEventListener('abort', abort)
  socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
  try {
    while (true) {
      if (queue.length === 0) {
        if (finished) return
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
        continue
      }
      const frame = queue.shift()!
      if (frame.type === 'item') { yield frame.value; continue }
      if (frame.type === 'error') throw new Error(frame.error?.message ?? `${endpoint} 远端流失败`)
      return
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    unsubscribe()
    socket.send(JSON.stringify({ type: 'cancel', streamId }))
    socket.close()
  }
}
