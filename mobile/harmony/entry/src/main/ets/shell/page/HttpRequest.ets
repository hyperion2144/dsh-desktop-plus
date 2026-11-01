import { Bytes } from '../util/Bytes';

/**
 * 一次 HTTP 请求的头。
 *
 * 键统一小写（HTTP 头名大小写不敏感）。
 */
export class HttpRequestHead {
  method: string = '';
  /** 请求目标（路径 + 查询串）。 */
  target: string = '';
  /** 路径部分。 */
  path: string = '';
  /** 查询串（不含 `?`）。 */
  query: string = '';
  headers: Map<string, string> = new Map<string, string>();
  /** 请求体长度（`Content-Length`；没有就是 0）。 */
  contentLength: number = 0;

  /** 取一个头；没有就是空串。 */
  header(name: string): string {
    const value = this.headers.get(name.toLowerCase());
    return value === undefined ? '' : value;
  }

  /** 是不是 WebSocket 升级请求。 */
  isWebSocketUpgrade(): boolean {
    return this.header('upgrade').toLowerCase() === 'websocket';
  }
}

/**
 * HTTP/1.1 请求解析器。
 *
 * 壳内 HTTP 服务是**逐块**收数据的（TCP 的消息边界与 HTTP 的边界无关），
 * 所以这里要自己把「头 + 体」拼起来：先等 `\r\n\r\n`，再按 `Content-Length` 等体。
 */
export class HttpRequestParser {
  private buffer: Uint8Array = new Uint8Array(0);
  private headValue: HttpRequestHead | null = null;
  /** 头在 buffer 里的长度（体从它后面开始）。 */
  private headLength: number = 0;

  /** 收到一段数据。 */
  push(chunk: Uint8Array): void {
    this.buffer = Bytes.concat(this.buffer, chunk);
    if (this.headValue === null) {
      const end = HttpRequestParser.findHeaderEnd(this.buffer);
      if (end < 0) {
        return;
      }
      const text = Bytes.decode(Bytes.range(this.buffer, 0, end));
      this.headValue = HttpRequestParser.parseHead(text);
      this.headLength = end;
    }
  }

  /** 请求头；还没收全时返回 null。 */
  head(): HttpRequestHead | null {
    return this.headValue;
  }

  /** 请求体；头或体没收全时返回空数组。 */
  body(): Uint8Array {
    if (this.headValue === null || this.buffer.length < this.headLength + this.headValue.contentLength) {
      return new Uint8Array(0);
    }
    return Bytes.range(this.buffer, this.headLength, this.headLength + this.headValue.contentLength);
  }

  /**
   * 头与体之后还剩下的字节。
   *
   * WebSocket 升级请求没有 body，页面可能把首批帧和握手放在同一个 TCP 包里——
   * 那些帧就在这里，必须转给 lane，否则第一批消息会丢。
   */
  remainder(): Uint8Array {
    if (this.headValue === null) {
      return new Uint8Array(0);
    }
    const start = this.headLength + this.headValue.contentLength;
    if (this.buffer.length <= start) {
      return new Uint8Array(0);
    }
    return Bytes.range(this.buffer, start, this.buffer.length);
  }

  /** 请求是否已收全（头 + 体）。 */
  complete(): boolean {
    if (this.headValue === null) {
      return false;
    }
    return this.buffer.length >= this.headLength + this.headValue.contentLength;
  }

  /** 找 `\r\n\r\n` 的结束位置（不含分隔符）；找不到返回 -1。 */
  private static findHeaderEnd(buffer: Uint8Array): number {
    const marker = Bytes.encode('\r\n\r\n');
    const at = Bytes.indexOf(buffer, marker, 0);
    return at < 0 ? -1 : at + marker.length;
  }

  /** 解析请求头文本。 */
  private static parseHead(text: string): HttpRequestHead {
    const head = new HttpRequestHead();
    const lines = text.split('\r\n');
    if (lines.length > 0) {
      const requestLine = lines[0].split(' ');
      if (requestLine.length >= 2) {
        head.method = requestLine[0].toUpperCase();
        head.target = requestLine[1];
      }
    }
    const questionAt = head.target.indexOf('?');
    if (questionAt >= 0) {
      head.path = head.target.substring(0, questionAt);
      head.query = head.target.substring(questionAt + 1);
    } else {
      head.path = head.target;
    }
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index];
      const separator = line.indexOf(':');
      if (separator <= 0) {
        continue;
      }
      const name = line.substring(0, separator).trim().toLowerCase();
      const value = line.substring(separator + 1).trim();
      head.headers.set(name, value);
    }
    const length = head.header('content-length');
    if (length.length > 0) {
      const parsed = Number(length);
      head.contentLength = isNaN(parsed) ? 0 : parsed;
    }
    return head;
  }
}
