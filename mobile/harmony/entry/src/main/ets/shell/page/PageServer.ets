import { socket } from '@kit.NetworkKit';
import { resourceManager } from '@kit.LocalizationKit';
import { BootPayloadStore } from '../boot/BootPayloadStore';
import { DistAssetSource } from './DistAssetSource';
import { HostEntry } from '../host/HostTypes';
import { HttpRequestHead, HttpRequestParser } from './HttpRequest';
import { LaneHttpClient, LaneRequest, LaneResponse } from '../net/LaneHttpClient';
import { ShellLog } from '../ShellLog';
import { ShellSettings } from '../ShellSettings';
import { Bytes } from '../util/Bytes';

/**
 * 壳内的回环 HTTP 服务：页面的 origin 就是它。
 *
 * ## 为什么自带一个 HTTP 服务，而不是用 ArkWeb 的请求拦截
 *
 *  - **主文档**：ArkWeb 的 `onInterceptRequest` 不拦主框架，`onLoadIntercept` 又没法直接替换响应体；
 *  - **请求体**：拦截拿不到 POST 的 body；
 *  - **流式**：拦截的响应体必须完整备好，SSE / 事件流无法透传。
 *
 * 自带服务解决了这三件事。注意页面与数据面**不同源**：页面来自本机回环，
 * WebSocket 由页面带令牌直连 lane（见 HostConnector.socketBaseOf），壳不再中继
 * ——也就没有「两次握手 + 字节搬运」这一段。HTTP 仍然同源转发（短请求，无稳定性问题）。
 *
 * ## 路由
 *
 * | 路径 | 去处 |
 * |---|---|
 * | `/__dsh-mobile-shell/boot.json` | 引导载荷（注入行 + `__DSH_TRANSPORT__` 配置） |
 * | `/api/`、`/plugins/`、`/assets/`、`/__dsh-mobile/`、`/_loopback/` | 转发到当前主机 lane（凭证由壳附加） |
 * | 其余 | 壳内自带的 dist（构建产物） |
 *
 * 不在白名单里的路径既不本地命中也不转发：宁可 404，也不要把未知路径盲转给主机。
 */
export class PageServer {
  private server: socket.TCPSocketServer | null = null;
  private portValue: number = 0;
  private readonly manager: resourceManager.ResourceManager;
  private readonly payloadStore: BootPayloadStore;
  private readonly hostProvider: () => HostEntry | null;
  private readonly client: LaneHttpClient;
  private readonly assets: DistAssetSource;

  constructor(manager: resourceManager.ResourceManager, payloadStore: BootPayloadStore,
    hostProvider: () => HostEntry | null, client: LaneHttpClient) {
    this.manager = manager;
    this.payloadStore = payloadStore;
    this.hostProvider = hostProvider;
    this.client = client;
    this.assets = new DistAssetSource(manager);
  }

  /** 启动服务（绑定回环上的一个临时端口）。 */
  async start(): Promise<void> {
    await this.assets.loadBootScript();
    const server = socket.constructTCPSocketServerInstance();
    const port = await PageServer.listenOnFreePort(server);
    if (port <= 0) {
      throw new Error('壳内页面服务无法绑定端口');
    }
    this.server = server;
    this.portValue = port;
    server.on('connect', (connection: socket.TCPSocketConnection) => {
      this.serve(connection);
    });
    ShellLog.info(`壳内页面服务已启动：${this.origin()}`);
  }

  /** 停止服务。 */
  async stop(): Promise<void> {
    if (this.server !== null) {
      const server = this.server;
      this.server = null;
      this.portValue = 0;
      try {
        await server.close();
      } catch (error) {
        // 已关闭。
      }
    }
  }

  /** 页面 origin（壳内资产与数据面的基准）。 */
  origin(): string {
    return `http://${ShellSettings.PAGE_HOST}:${this.portValue}`;
  }


  /** 处理一条连接上的 HTTP 请求。 */
  private serve(connection: socket.TCPSocketConnection): void {
    const parser = new HttpRequestParser();
    let handled = false;
    const onMessage = (info: socket.SocketMessageInfo): void => {
      if (handled) {
        return;
      }
      parser.push(new Uint8Array(info.message));
      const head = parser.head();
      if (head === null) {
        return;
      }
      if (head.isWebSocketUpgrade()) {
        // 数据面不再经过壳：WS 由页面带令牌直连 lane。走到这里说明是旧页面或第三方
        // 尝试——明确回 501，不让它挂在半开连接上。
        handled = true;
        connection.off('message', onMessage);
        const reply = PageServer.writeResponse(connection, 501, 'Not Implemented',
          PageServer.headerMap('application/json; charset=utf-8', ''),
          Bytes.encode('{"error":"websocket 直连 lane，壳不再中继"}'));
        reply.catch(() => {
          connection.close().catch(() => {
            // 已关闭。
          });
        });
        return;
      }
      if (!parser.complete()) {
        return;
      }
      handled = true;
      this.handleRequest(connection, head, parser.body());
    };
    connection.on('message', onMessage);
    connection.on('error', () => {
      // 连接出错：直接收掉。
      connection.close().catch(() => {
        // 已关闭。
      });
    });
  }

  /** 分发一次请求。 */
  private async handleRequest(connection: socket.TCPSocketConnection, head: HttpRequestHead,
    body: Uint8Array): Promise<void> {
    const path = this.localPath(head.path);
    if (path === ShellSettings.BOOT_PAYLOAD_PATH) {
      await this.serveBootPayload(connection);
      return;
    }
    if (ShellSettings.isForwardedPath(path)) {
      // 壳内自带的 dist 资产本地优先：壳内 index.html 引用的是同一次构建的哈希，
      // 桌面主机的 dist 是另一个版本时转发只会 404（实机踩过）。
      if (path.startsWith('/assets/')) {
        const relative = path.startsWith('/') ? path.substring(1) : path;
        const local = await this.assets.read(relative);
        if (local !== null) {
          await PageServer.writeResponse(connection, 200, 'OK',
            PageServer.headerMap(DistAssetSource.mimeTypeOf(relative), ''), local);
          return;
        }
      }
      await this.forwardToLane(connection, head, body);
      return;
    }
    await this.serveAsset(connection, path);
  }

  /**
   * 把请求路径映射成本服务的路径。
   *
   * lane 的「回环改写」补丁会把 `ws://127.0.0.1:<port>` 改写成 `<origin>/_loopback/<port>/…`。
   * 壳的页面 origin 本身就是回环，改写会指向壳自己；而插件的这些请求实质是
   * 「dsh 端口的 exact API 路由」（/api/<前缀>.<cmd>），应当剥掉任意
   * `/_loopback/<port>/` 前缀后按白名单转发 lane——否则插件数据面全体 502
   * （真机实锤：archive-manager 的 sidebar/update 全部 502）。
   */
  private localPath(path: string): string {
    if (path.startsWith(ShellSettings.LOOPBACK_PREFIX)) {
      const rest = path.substring(ShellSettings.LOOPBACK_PREFIX.length);
      const slashAt = rest.indexOf('/');
      if (slashAt >= 0) {
        return rest.substring(slashAt);
      }
      return '/';
    }
    return path;
  }

  /** 引导载荷：注入行 + `__DSH_TRANSPORT__` 配置。 */
  private async serveBootPayload(connection: socket.TCPSocketConnection): Promise<void> {
    const payload = this.payloadStore.get();
    if (payload === null) {
      await PageServer.writeResponse(connection, 503, 'Service Unavailable',
        PageServer.headerMap('application/json; charset=utf-8', ''),
        Bytes.encode('{"error":"引导载荷未就绪"}'));
      return;
    }
    await PageServer.writeResponse(connection, 200, 'OK',
      PageServer.headerMap('application/json; charset=utf-8', 'no-store'),
      Bytes.encode(payload.toJson()));
  }

  /** 壳内自带资产。 */
  private async serveAsset(connection: socket.TCPSocketConnection, path: string): Promise<void> {
    const relative = path.startsWith('/') ? path.substring(1) : path;
    if (relative.length === 0 || relative === 'index.html') {
      const document = await this.assets.document();
      if (document === null) {
        await PageServer.writeResponse(connection, 404, 'Not Found',
          PageServer.headerMap('application/json; charset=utf-8', ''),
          Bytes.encode('{"error":"壳内没有页面产物，请先同步 dist"}'));
        return;
      }
      await PageServer.writeResponse(connection, 200, 'OK',
        PageServer.headerMap('text/html; charset=utf-8', 'no-store'), document);
      return;
    }
    const bytes = await this.assets.read(relative);
    if (bytes === null) {
      await PageServer.writeResponse(connection, 404, 'Not Found',
        PageServer.headerMap('application/json; charset=utf-8', ''),
        Bytes.encode('{"error":"页面资源不存在"}'));
      return;
    }
    await PageServer.writeResponse(connection, 200, 'OK',
      PageServer.headerMap(DistAssetSource.mimeTypeOf(relative), ''), bytes);
  }

  /** 转发到当前主机 lane（凭证由壳附加，页面拿不到）。 */
  private async forwardToLane(connection: socket.TCPSocketConnection, head: HttpRequestHead,
    body: Uint8Array): Promise<void> {
    const host = this.hostProvider();
    if (host === null) {
      await PageServer.writeResponse(connection, 503, 'Service Unavailable',
        PageServer.headerMap('application/json; charset=utf-8', ''),
        Bytes.encode('{"error":"未配置主机"}'));
      return;
    }
    const target = `${host.laneOrigin.replace(/\/+$/, '')}${head.path}` +
      (head.query.length > 0 ? `?${head.query}` : '');
    const headers = PageServer.forwardedHeaders(head);
    const request = new LaneRequest(target, head.method, host.sessionCookie, headers, body);
    const accept = head.header('accept');
    if (accept.includes('text/event-stream')) {
      await this.forwardStreaming(connection, request);
      return;
    }
    let response: LaneResponse;
    try {
      response = await this.client.send(request);
    } catch (error) {
      await PageServer.writeResponse(connection, 502, 'Bad Gateway',
        PageServer.headerMap('application/json; charset=utf-8', ''),
        Bytes.encode('{"error":"转发到主机失败"}'));
      return;
    }
    const shownPath = head.path.length > 120 ? `${head.path.substring(0, 120)}…` : head.path;
    ShellLog.info(`转发 ${head.method} ${shownPath}（HTTP ${response.status}）`);
    const outHeaders: Map<string, string> = new Map<string, string>();
    response.headers.forEach((value: string, name: string) => {
      if (!PageServer.DROPPED_RESPONSE_HEADERS.includes(name)) {
        outHeaders.set(name, value);
      }
    });
    if (!outHeaders.has('content-type')) {
      outHeaders.set('content-type', 'application/octet-stream');
    }
    await PageServer.writeResponse(connection, response.status, response.reason, outHeaders, response.body);
  }

  /** 流式转发（事件流）：响应用分块传输，边到边发。 */
  private async forwardStreaming(connection: socket.TCPSocketConnection, request: LaneRequest): Promise<void> {
    let started = false;
    try {
      await this.client.sendStreaming(request, (headers: Map<string, string>) => {
        if (started) {
          return;
        }
        started = true;
        const head = 'HTTP/1.1 200 OK\r\n' +
          'Content-Type: text/event-stream; charset=utf-8\r\n' +
          'Transfer-Encoding: chunked\r\n' +
          'Cache-Control: no-store\r\n' +
          'Connection: close\r\n' +
          '\r\n';
        connection.send({ data: head }).catch(() => {
          // 页面已断开。
        });
      }, (chunk: Uint8Array) => {
        // 二进制拼帧：每个 SSE 块都做一轮 UTF-8 解码再编码会拖死主线程（流式输出时块如潮水）。
        const framed = Bytes.concat(Bytes.concat(Bytes.encode(`${chunk.length.toString(16)}\r\n`), chunk),
          PageServer.CRLF_BYTES);
        connection.send({ data: framed }).catch(() => {
          // 页面已断开。
        });
      });
    } catch (error) {
      ShellLog.warn('流式转发失败');
    }
    if (started) {
      connection.send({ data: '0\r\n\r\n' }).catch(() => {
        // 页面已断开。
      });
    }
    connection.close().catch(() => {
      // 已关闭。
    });
  }

  /** 转发时搬运的请求头：逐跳头与凭证相关的头由壳自己管。 */
  private static forwardedHeaders(head: HttpRequestHead): Map<string, string> {
    const headers: Map<string, string> = new Map<string, string>();
    head.headers.forEach((value: string, name: string) => {
      if (!PageServer.SKIPPED_REQUEST_HEADERS.includes(name)) {
        headers.set(name, value);
      }
    });
    headers.set('accept-encoding', 'identity');
    return headers;
  }

  /** 一组响应头（ArkTS 的对象字面量必须有声明过的类型，所以这里用 Map 传）。 */
  private static headerMap(contentType: string, cacheControl: string): Map<string, string> {
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Content-Type', contentType);
    if (cacheControl.length > 0) {
      headers.set('Cache-Control', cacheControl);
    }
    return headers;
  }

  /** 写一个完整响应（带 Content-Length，随后关闭连接）。 */
  private static async writeResponse(connection: socket.TCPSocketConnection, status: number, reason: string,
    headers: Map<string, string>, body: Uint8Array): Promise<void> {
    let head = `HTTP/1.1 ${status} ${reason}\r\n`;
    headers.forEach((value: string, name: string) => {
      head += `${name}: ${value}\r\n`;
    });
    head += `Content-Length: ${body.length}\r\n`;
    head += 'Connection: close\r\n\r\n';
    try {
      await connection.send({ data: head });
      if (body.length > 0) {
        await connection.send({ data: body.buffer });
      }
    } catch (error) {
      // 页面已断开。
    }
    await connection.close().catch(() => {
      // 已关闭。
    });
  }

  /** 绑定回环上的一个端口。 */
  private static async listenOnFreePort(server: socket.TCPSocketServer): Promise<number> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const port = attempt === 0 ? 0 : 20000 + Math.floor(Math.random() * 40000);
      try {
        await server.listen({ address: ShellSettings.PAGE_HOST, port: port });
        const address = await server.getLocalAddress();
        const bound = address.port ?? 0;
        if (bound > 0) {
          return bound;
        }
      } catch (error) {
        // 端口被占：换下一个。
      }
    }
    return -1;
  }

  /** 转发时不搬运的请求头。 */
  private static readonly SKIPPED_REQUEST_HEADERS: string[] = [
    'host',
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
    'accept-encoding',
    'cookie',
    'content-length',
  ];

  /** 响应里不搬运的头：逐跳头与内容编码（壳统一按 identity 传输）。 */
  private static readonly DROPPED_RESPONSE_HEADERS: string[] = [
    'connection',
    'keep-alive',
    'proxy-connection',
    'transfer-encoding',
    'upgrade',
    'content-encoding',
    'content-length',
  ];

  /** SSE 分块帧的收尾（CRLF 的字节形式）。 */
  private static readonly CRLF_BYTES: Uint8Array = Bytes.encode('\r\n');
}
