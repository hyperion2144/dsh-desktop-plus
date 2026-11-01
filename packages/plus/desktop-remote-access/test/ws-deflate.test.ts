// permessage-deflate 终止（ws-deflate.ts）测试。
// 单元层：双向转码（压缩↔明文、掩码位翻转、分片合并、控制帧透传、坏流即断）。
// 端到端：直连路径上 lane 自己应答协商（上游看不到扩展），且双向字节确实被转码；
// 非直连路径（浏览器直连）保持原样，协商与字节都不经手。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import http from 'node:http'
import { deflateRawSync, constants as zlibConstants } from 'node:zlib'
import { createRewriteProxy } from '../src/host/proxy.js'
import { encodeFrame, decodeFrame } from '../src/host/ws-frame.js'
import {
  DEFLATE_EXTENSION,
  compressMessage,
  createDeflateDirection,
  decompressMessage,
} from '../src/host/ws-deflate.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 浏览器/上游发出的压缩载荷：deflate + sync-flush，去掉尾部 00 00 FF FF。 */
function deflatePayload(plain: Buffer): Buffer {
  const out = deflateRawSync(plain, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
  const tail = out.length >= 4 && out[out.length - 4] === 0x00 && out[out.length - 3] === 0x00
    && out[out.length - 2] === 0xff && out[out.length - 1] === 0xff
  return tail ? out.subarray(0, out.length - 4) : out
}

/** 上游（dsh）帧：不掩码。 */
const up = (opcode: number, payload: Buffer, opts: { fin?: boolean; rsv1?: boolean } = {}) =>
  encodeFrame(opcode, payload, opts)

/** 页面（客户端）帧：必须掩码。 */
const page = (opcode: number, payload: Buffer, opts: { fin?: boolean; rsv1?: boolean } = {}) =>
  encodeFrame(opcode, payload, { ...opts, masked: true })

/** 一条长到值得压缩的消息。 */
const BIG = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, result: { text: 'x'.repeat(2000) } }))

test('压缩往返：消息可还原；短消息不压缩（返回 null）', () => {
  const z = compressMessage(BIG)
  assert.ok(z !== null, '长消息应产生压缩载荷')
  assert.ok(z.length < BIG.length, '压缩后必须更小')
  assert.deepEqual(decompressMessage(z), BIG)
  assert.equal(compressMessage(Buffer.from('tiny')), null, '短消息压缩反而变大，必须返回 null')
})

test('页面→dsh：压缩帧被解成明文，并重新加上客户端掩码', () => {
  const dir = createDeflateDirection({ toClient: false })
  const out = dir.push(page(0x2, deflatePayload(BIG), { rsv1: true }))
  const f = decodeFrame(out, 0)
  assert.ok(f !== null && f !== undefined)
  assert.equal(f.rsv1, false, '发给 dsh 的帧不能再带 RSV1（dsh 侧没有协商压缩）')
  assert.equal(f.masked, true, '客户端→服务器方向的帧必须带掩码')
  assert.deepEqual(f.payload, BIG)
  assert.equal(dir.broken, false)
})

test('dsh→页面：明文帧被压缩，RSV1 置位，页面可解回原文', () => {
  const dir = createDeflateDirection({ toClient: true })
  const f = decodeFrame(dir.push(up(0x1, BIG)), 0)
  assert.ok(f !== null && f !== undefined)
  assert.equal(f.rsv1, true, '发给页面的消息应压缩（RSV1=1）')
  assert.equal(f.masked, false, '服务器→客户端方向的帧不能带掩码')
  assert.deepEqual(decompressMessage(f.payload), BIG)
})

test('短消息不压缩：RSV1=0 照常可发（协议允许逐条消息决定）', () => {
  const f = decodeFrame(createDeflateDirection({ toClient: true }).push(up(0x2, Buffer.from('pong'))), 0)
  assert.ok(f !== null && f !== undefined)
  assert.equal(f.rsv1, false)
  assert.deepEqual(f.payload, Buffer.from('pong'))
})

test('控制帧立即透传且翻转掩码位（不能被消息聚合吞掉）', () => {
  const toPage = createDeflateDirection({ toClient: true })
  const ping = decodeFrame(toPage.push(up(0x9, Buffer.from('hb'))), 0)
  assert.ok(ping !== null && ping !== undefined)
  assert.equal(ping.opcode, 0x9)
  assert.deepEqual(ping.payload, Buffer.from('hb'))

  const toUp = createDeflateDirection({ toClient: false })
  const pong = decodeFrame(toUp.push(page(0xa, Buffer.from('hb'))), 0)
  assert.ok(pong !== null && pong !== undefined)
  assert.equal(pong.opcode, 0xa)
  assert.equal(pong.masked, true, '控制帧发往上游同样按客户端方向补上掩码')
})

test('分片消息先攒后发：合并成一条完整消息', () => {
  const dir = createDeflateDirection({ toClient: true })
  assert.equal(dir.push(up(0x1, Buffer.from('abc'), { fin: false })).length, 0, '首帧未 FIN：不产出字节')
  const f = decodeFrame(dir.push(up(0x0, Buffer.from('def'))), 0)
  assert.ok(f !== null && f !== undefined)
  assert.equal(f.opcode, 0x1, '续帧合并后保留首帧操作码')
  assert.deepEqual(f.payload, Buffer.from('abcdef'))
})

test('任意切分：消息被拆成多个 chunk 喂入也能拼回', () => {
  const dir = createDeflateDirection({ toClient: false })
  const whole = page(0x2, deflatePayload(BIG), { rsv1: true })
  const outs: Buffer[] = []
  for (let i = 0; i < whole.length; i += 7) outs.push(dir.push(whole.subarray(i, i + 7)))
  const f = decodeFrame(Buffer.concat(outs), 0)
  assert.ok(f !== null && f !== undefined)
  assert.deepEqual(f.payload, BIG)
})

test('解压失败的压缩流：判定帧流不可信并回关闭帧', () => {
  const dir = createDeflateDirection({ toClient: true })
  const out = dir.push(up(0x2, Buffer.from('not deflate at all '.repeat(40)), { rsv1: true }))
  assert.equal(dir.broken, true)
  const f = decodeFrame(out, 0)
  assert.ok(f !== null && f !== undefined)
  assert.equal(f.opcode, 0x8, '坏流回 close 帧（1007）')
  assert.equal(f.payload.readUInt16BE(0), 1007)
})

/** 上游桩：记录 upgrade 请求头与收到的字节；可选升级后主动发一条明文消息。 */
async function startUpstream(greet: Buffer | null) {
  const sockets: import('node:net').Socket[] = []
  const state = { headers: null as Record<string, unknown> | null, bytes: [] as Buffer[] }
  const server = http.createServer((_q, r) => r.end())
  server.on('connection', (s) => sockets.push(s))
  server.on('upgrade', (req, sock) => {
    state.headers = { ...req.headers }
    sockets.push(sock)
    sock.on('error', () => { })
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: test\r\n\r\n')
    sock.on('data', (c: Buffer) => state.bytes.push(c))
    if (greet !== null) setTimeout(() => { try { sock.write(encodeFrame(0x1, greet)) } catch { /* 已断 */ } }, 30)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  return {
    port: (server.address() as { port: number }).port,
    state,
    close: () => { for (const s of sockets) { try { s.destroy() } catch { /* noop */ } } server.closeAllConnections?.(); server.close() },
  }
}

/** 页面侧：向 lane 发起 upgrade（可带压缩协商），收集 101 响应头与全部入站字节。 */
function pageConnect(lanePort: number, path: string, headers: Record<string, string>) {
  return new Promise<{
    socket: import('node:net').Socket
    responseHeaders: http.IncomingHttpHeaders
    bytes: () => Buffer
  }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('page upgrade timeout')), 5000)
    const req = http.request(`http://127.0.0.1:${lanePort}${path}`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'AQIDBAUGBwgJCgsMDQ4P',
        ...headers,
      },
    })
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer)
      socket.on('error', () => { })
      const chunks: Buffer[] = head?.length ? [head] : []
      socket.on('data', (c) => chunks.push(c as Buffer))
      resolve({ socket, responseHeaders: res.headers, bytes: () => Buffer.concat(chunks) })
    })
    req.on('error', (e) => { clearTimeout(timer); reject(e) })
    req.end()
  })
}

test('直连路径：lane 应答压缩协商，上游看不到扩展；双向字节都被转码', async () => {
  const ups = await startUpstream(BIG)
  const proxy = createRewriteProxy({ upstreamHost: '127.0.0.1', upstreamPort: ups.port, wsPingIntervalMs: 0 })
  const lanePort = await new Promise<number>((r) => proxy.server.listen(0, '127.0.0.1', () => r((proxy.server.address() as { port: number }).port)))
  try {
    const pageSide = await pageConnect(lanePort, '/__dsh_ws/tok/api/remote.mux', {
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    })
    // ① 协商由 lane 应答，参数锁死为无上下文接管
    assert.equal(pageSide.responseHeaders['sec-websocket-extensions'], DEFLATE_EXTENSION)
    // ② 上游（dsh）根本看不到这次协商：它是一条明文连接
    await sleep(60)
    assert.equal(ups.state.headers?.['sec-websocket-extensions'], undefined, '不得把页面的压缩协商转交给 dsh')
    // ③ 页面发压缩帧 → 上游收到的必须是明文帧
    pageSide.socket.write(page(0x2, deflatePayload(BIG2), { rsv1: true }))
    await sleep(120)
    const received = Buffer.concat(ups.state.bytes)
    const upFrame = decodeFrame(received, 0)
    assert.ok(upFrame !== null && upFrame !== undefined, '上游应收到可解析的帧')
    assert.equal(upFrame.rsv1, false, 'dsh 侧帧不能带 RSV1')
    assert.deepEqual(upFrame.payload, BIG2)
    // ④ 上游明文帧 → 页面收到的必须是压缩帧（RSV1=1），且能解回原文
    const shown = Buffer.concat([pageSide.bytes(), Buffer.alloc(0)])
    const frames: Buffer[] = []
    for (let off = 0; off < shown.length;) {
      const f = decodeFrame(shown, off)
      if (f === null || f === undefined) break
      frames.push(shown.subarray(off, off + f.total))
      off += f.total
    }
    const dataFrames = frames.map((raw) => decodeFrame(raw, 0)).filter((f) => f !== null && f !== undefined && f.opcode === 0x1)
    assert.ok(dataFrames.length >= 1, '页面应收到上游的文本消息')
    const first = dataFrames[0]!
    assert.equal(first.rsv1, true, '发给页面的消息必须压缩')
    assert.deepEqual(decompressMessage(first.payload), BIG)
    pageSide.socket.destroy()
  } finally { proxy.server.closeAllConnections?.(); proxy.server.close(); ups.close() }
})

/** 直连路径上页面发来的另一条消息（与 BIG 不同，便于区分方向）。 */
const BIG2 = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'stream.open', params: { tail: 'y'.repeat(1500) } }))

test('非直连路径：浏览器直连不终止压缩（协商与字节都原样过）', async () => {
  const ups = await startUpstream(null)
  const proxy = createRewriteProxy({ upstreamHost: '127.0.0.1', upstreamPort: ups.port, wsPingIntervalMs: 0 })
  const lanePort = await new Promise<number>((r) => proxy.server.listen(0, '127.0.0.1', () => r((proxy.server.address() as { port: number }).port)))
  try {
    const pageSide = await pageConnect(lanePort, '/api/remote.mux', {
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    })
    await sleep(60)
    assert.equal(ups.state.headers?.['sec-websocket-extensions'], 'permessage-deflate; client_max_window_bits', '普通路径不改写协商')
    assert.equal(pageSide.responseHeaders['sec-websocket-extensions'], undefined, 'lane 不在普通路径上应答压缩')
    pageSide.socket.destroy()
  } finally { proxy.server.closeAllConnections?.(); proxy.server.close(); ups.close() }
})
