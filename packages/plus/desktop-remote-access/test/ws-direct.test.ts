// 直连数据面的端到端契约（lane 侧）：
//   cookie → `POST /__dsh-mobile/api/pair/ws-token` → 令牌
//   令牌进路径 `ws://lane/__dsh_ws/<token>/api/remote.mux` → 建连（无需 cookie）
//
// 这条链路就是手机壳现在走的那条：页面 origin 与 lane 跨站，cookie（SameSite=Lax）
// 在握手时不出现，唯一能携带凭证的位置是 URL；lane 验签后还原会话值，仍走既有设备判定。
// 这里同时钉住压缩终止的方向性：页面压缩帧 → 上游明文帧，上游明文 → 页面压缩帧。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import http from 'node:http'
import { deflateRawSync, constants as zlibConstants } from 'node:zlib'
import { createRemoteAccessService } from '../src/host/index.js'
import { createMemoryStorage } from '../src/host/pairing.js'
import { LANE_PREFIX } from '../src/host/lane-routes.js'
import { DEFLATE_EXTENSION, decompressMessage } from '../src/host/ws-deflate.js'
import { encodeFrame, decodeFrame } from '../src/host/ws-frame.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 浏览器/页面发出的压缩载荷（deflate + sync-flush，去掉尾部标记）。 */
function deflatePayload(plain: Buffer): Buffer {
  const out = deflateRawSync(plain, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
  const trimmed = out.length >= 4 && out.subarray(out.length - 4).equals(Buffer.from([0x00, 0x00, 0xff, 0xff]))
  return trimmed ? out.subarray(0, out.length - 4) : out
}

/** 上游桩：WS 升级即 101，记录请求头与收到的字节。 */
function startUpstream() {
  const sockets: import('node:net').Socket[] = []
  const state = {
    headers: null as Record<string, unknown> | null,
    bytes: [] as Buffer[],
    sock: null as import('node:net').Socket | null,
  }
  const server = http.createServer((_q, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('upstream') })
  server.on('connection', (s) => sockets.push(s))
  server.on('upgrade', (req, sock) => {
    state.headers = { ...req.headers }
    state.sock = sock
    sockets.push(sock)
    sock.on('error', () => { })
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: test\r\n\r\n')
    sock.on('data', (c: Buffer) => state.bytes.push(c))
  })
  return {
    server,
    state,
    close: () => { for (const s of sockets) { try { s.destroy() } catch { /* noop */ } } server.closeAllConnections?.(); server.close() },
  }
}

/** 向 lane 发起 WS 升级，返回 101 响应头 + 入站字节收集器。 */
function upgrade(lanePort: number, path: string, headers: Record<string, string>) {
  return new Promise<{ socket: import('node:net').Socket; res: http.IncomingMessage; bytes: () => Buffer }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('upgrade timeout')), 5000)
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
      resolve({ socket, res, bytes: () => Buffer.concat(chunks) })
    })
    req.on('error', (e) => { clearTimeout(timer); reject(e) })
    // 升级被拒（401 等）不会触发 upgrade 事件，而是走正常 HTTP 响应：必须在这里收尾，
    // 否则只能等超时（把它当成「连接没反应」，判定就失去意义了）。
    req.on('response', (res) => {
      clearTimeout(timer)
      res.resume()
      reject(new Error(`rejected:${res.statusCode}`))
    })
    req.end()
  })
}

const BIG = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'stream.data', params: { chunk: 'z'.repeat(1200) } }))

test('直连数据面：cookie 换令牌 → 令牌进路径建连 → 双向压缩终止', async () => {
  const up = startUpstream()
  await new Promise<void>((r) => up.server.listen(0, '127.0.0.1', () => r()))
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: (up.server.address() as { port: number }).port,
    platform: 'darwin',
  })
  const lp = await svc.listen()
  const base = `http://127.0.0.1:${lp}`
  let pageSocket: import('node:net').Socket | null = null
  try {
    // ① 配对拿 cookie（真机流程同款）
    const token = svc.store.mint()
    const acc = await fetch(`${base}/api/pair/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ token, name: 'Pixel 9' }),
    })
    assert.equal(acc.status, 200)
    const cookie = String(acc.headers.get('set-cookie') ?? '').split(';')[0]!
    assert.ok(cookie.includes('dsh_mobile_session='))

    // ② 用 cookie 换直连令牌
    const minted = await fetch(`${base}${LANE_PREFIX}/api/pair/ws-token`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', Connection: 'close' },
      body: '{}',
    })
    assert.equal(minted.status, 200)
    const direct = String(((await minted.json()) as { token?: string }).token ?? '')
    assert.ok(direct.length > 0, '应签发直连令牌')

    // ③ 令牌进路径建连：握手阶段**不带 cookie**（跨站时浏览器就是这样）
    const page = await upgrade(lp, `/__dsh_ws/${direct}/api/remote.mux`, {
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    })
    assert.equal(page.res.headers['sec-websocket-extensions'], DEFLATE_EXTENSION, '压缩由 lane 应答')
    pageSocket = page.socket
    await sleep(80)
    assert.equal(up.state.headers?.['sec-websocket-extensions'], undefined, '上游不参与压缩协商')
    // 令牌是 lane 的门禁凭证，不是 dsh 的：上游不该看到移动端会话 cookie（dsh 自己的
    // 凭证由 upstreamAuth 单独附加）。这一条同时钉住「令牌不污染上游请求」。
    assert.notEqual(String(up.state.headers?.cookie ?? '').includes('dsh_mobile_session='), true, '移动端会话 cookie 不得透给上游')

    // ④ 页面压缩帧 → 上游明文帧
    page.socket.write(encodeFrame(0x2, deflatePayload(BIG), { rsv1: true, masked: true }))
    await sleep(150)
    const got = decodeFrame(Buffer.concat(up.state.bytes), 0)
    assert.ok(got !== null && got !== undefined, '上游应收到可解析的明文帧')
    assert.equal(got.rsv1, false)
    assert.deepEqual(got.payload, BIG)

    // ⑤ 上游明文 → 页面压缩帧
    // ⑤ 上游明文 → 页面压缩帧（方向对偶：页面拿到的必须是 RSV1 帧）
    up.state.sock?.write(encodeFrame(0x2, BIG))
    await sleep(150)
    const back = decodeFrame(page.bytes(), 0)
    assert.ok(back !== null && back !== undefined, '页面应收到上游消息')
    assert.equal(back.rsv1, true, '发给页面的消息必须压缩')
    assert.deepEqual(decompressMessage(back.payload), BIG)
    await sleep(50)
    page.socket.destroy()
  } finally {
    // 断言失败时也要收掉页面侧 socket，否则关闭流程要等它自己超时（测试变慢）。
    try { pageSocket?.destroy() } catch { /* noop */ }
    svc.proxy.server.closeAllConnections?.()
    await svc.close()
    up.close()
  }
})

test('直连鉴权：没有令牌 / 令牌被篡改 → 401，不能白拿数据面', async () => {
  const up = startUpstream()
  await new Promise<void>((r) => up.server.listen(0, '127.0.0.1', () => r()))
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: (up.server.address() as { port: number }).port,
    platform: 'darwin',
  })
  const lp = await svc.listen()
  try {
    // 未配对设备拿不到令牌
    const denied = await fetch(`http://127.0.0.1:${lp}${LANE_PREFIX}/api/pair/ws-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Connection: 'close' },
      body: '{}',
    })
    assert.equal(denied.status, 401, '未配对不能签发令牌')

    // 伪造令牌（改了签名）进路径：升级必须被拒
    const forged = 'eyJ4IjoxfQ.9999999999999.forgedsignature'
    await assert.rejects(() => upgrade(lp, `/__dsh_ws/${forged}/api/remote.mux`, {}), /rejected:401/)
  } finally {
    svc.proxy.server.closeAllConnections?.()
    await svc.close()
    up.close()
  }
})

test('HTTP 直连：Bearer 令牌可读接口，无令牌仍然 401', async () => {
  const up = startUpstream()
  await new Promise<void>((r) => up.server.listen(0, '127.0.0.1', () => r()))
  const svc = createRemoteAccessService({
    storage: createMemoryStorage(),
    upstreamPort: (up.server.address() as { port: number }).port,
    platform: 'darwin',
  })
  const lp = await svc.listen()
  const base = `http://127.0.0.1:${lp}`
  try {
    const token = svc.store.mint()
    const acc = await fetch(`${base}/api/pair/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Connection: 'close' },
      body: JSON.stringify({ token, name: 'iPad' }),
    })
    const cookie = String(acc.headers.get('set-cookie') ?? '').split(';')[0]!
    const minted = await fetch(`${base}${LANE_PREFIX}/api/pair/ws-token`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', Connection: 'close' },
      body: '{}',
    })
    const direct = String(((await minted.json()) as { token?: string }).token ?? '')

    const ok = await fetch(`${base}/api/settings/describe`, {
      headers: { authorization: `Bearer ${direct}`, Connection: 'close' },
    })
    assert.equal(ok.status, 200, 'Bearer 令牌可直连上游接口')
    assert.equal(await ok.text(), 'upstream')

    const anon = await fetch(`${base}/api/settings/describe`, { headers: { Connection: 'close' } })
    assert.equal(anon.status, 401, '不带凭证仍然 401')
  } finally {
    svc.proxy.server.closeAllConnections?.()
    await svc.close()
    up.close()
  }
})

