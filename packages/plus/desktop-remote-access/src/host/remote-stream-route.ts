//! 双向流代理路由：浏览器 ↔ 本机 ↔ A 机 mux。
//!
//! 单向代理（remote-stream.ts）只能拿下行；终端的输入走流载体的 uplink，
//! 必须双向。这里在宿主注册一条 WebSocket upgrade 路由，握手完成后不透传字节，
//! 而是逐帧中继（stream-frame-relay.ts）：帧里的会话 id 在两个方向上各换成对面认识的那个——
//! 浏览器发来的是本机镜像 id，A 机回的是远端会话 id。
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { RemoteHostRecord } from './remote-hosts.js'
import { relaySocket, streamFrameTranslator } from './stream-frame-relay.js'

/** 路由路径。 */
export const REMOTE_STREAM_ROUTE = '/api/remote-access.stream'

/** 一条远程会话流的目标：A 机，以及这条镜像在 A 上对应的远端会话 id。 */
export interface RemoteStreamTarget {
  host: RemoteHostRecord
  remoteSessionId: string
}

/** 计算 Sec-WebSocket-Accept。 */
function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
}

/** 打开一条到 A 机 mux 的客户端连接。 */
function connectUpstream(host: RemoteHostRecord): Promise<import('node:net').Socket> {
  const origin = new URL(host.origin)
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: origin.hostname,
      port: origin.port === '' ? 80 : Number(origin.port),
      path: '/api/remote.mux',
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        // 握手 key 必须是 16 字节的 base64（RFC 6455）。
        'sec-websocket-key': randomBytes(16).toString('base64'),
        cookie: `dsh_mobile_session=${host.cookie}`,
      },
    })
    request.on('upgrade', (_response, socket) => { resolve(socket) })
    request.on('response', (response) => { reject(new Error(`mux upgrade 被拒：HTTP ${String(response.statusCode)}`)) })
    request.on('error', (error) => { reject(error) })
    request.end()
  })
}

/** 宿主 webServer 里这条路由用到的最小表面。 */
export interface UpgradeRegistrar {
  /** 注册一条 upgrade 路由。 */
  registerUpgrade: (route: {
    path: string
    handler: (request: http.IncomingMessage, socket: import('node:net').Socket, head: Buffer) => void
  }) => () => void
}

/**
 * 注册双向流代理路由。
 * @param webServer 宿主 webServer。
 * @param resolveTarget 按本机镜像会话 id 找 A 机与远端会话 id；不是远程会话返回 undefined。
 * @returns 注销函数。
 */
export function installRemoteStreamRoute(
  webServer: UpgradeRegistrar,
  resolveTarget: (sessionId: string) => RemoteStreamTarget | undefined,
): () => void {
  return webServer.registerUpgrade({
    path: REMOTE_STREAM_ROUTE,
    handler: (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const target = sessionId === '' ? undefined : resolveTarget(sessionId)
      const key = request.headers['sec-websocket-key']
      if (target === undefined || typeof key !== 'string') {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
        socket.end()
        return
      }
      void (async () => {
        let upstream: import('node:net').Socket
        try {
          upstream = await connectUpstream(target.host)
        } catch {
          socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
          socket.end()
          return
        }
        socket.write([
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${acceptKey(key)}`,
          '', '',
        ].join('\r\n'))
        // 浏览器 → A：本机镜像 id 换成远端会话 id，帧按客户端方向带掩码；
        // A → 浏览器：远端会话 id 换回本机镜像 id，帧按服务器方向不带掩码。
        relaySocket(socket, upstream, streamFrameTranslator({ [sessionId]: target.remoteSessionId }), true, head)
        relaySocket(upstream, socket, streamFrameTranslator({ [target.remoteSessionId]: sessionId }), false)
        const close = (): void => {
          try { socket.destroy() } catch { /* 已断开 */ }
          try { upstream.destroy() } catch { /* 已断开 */ }
        }
        socket.on('close', close)
        socket.on('error', close)
        upstream.on('close', close)
        upstream.on('error', close)
      })()
    },
  })
}
