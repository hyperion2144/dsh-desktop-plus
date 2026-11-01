import { http } from '@kit.NetworkKit';
import { JSON } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { Json, JsonNode } from '../util/Json';
import { ShellLog } from '../ShellLog';

/** 一次发往 lane 的请求描述。 */
export class LaneRequest {
  url: string;
  method: string;
  /** 壳持有的会话 cookie（页面永远拿不到）。 */
  cookie: string | null;
  headers: Map<string, string>;
  /** 请求体。 */
  body: Uint8Array | null;

  constructor(url: string, method: string, cookie: string | null, headers: Map<string, string>, body: Uint8Array | null) {
    this.url = url;
    this.method = method;
    this.cookie = cookie;
    this.headers = headers;
    this.body = body;
  }
}

/** lane 响应：状态 + 头 + 响应体。 */
export class LaneResponse {
  status: number;
  reason: string;
  headers: Map<string, string>;
  body: Uint8Array;

  constructor(status: number, reason: string, headers: Map<string, string>, body: Uint8Array) {
    this.status = status;
    this.reason = reason;
    this.headers = headers;
    this.body = body;
  }

  /** 响应体按 UTF-8 解码成文本（仅用于小响应，如 index.html）。 */
  text(): string {
    return LaneHttpClient.decode(this.body);
  }
}

/**
 * 壳侧的 HTTP 客户端（发往 lane）。
 *
 * 只用平台 `@ohos.net.http`：它同时处理明文与 TLS（隧道形态的 lane 是 https）、
 * 分块传输与重定向，壳不需要自己实现 HTTP 协议栈。
 *
 * ## 头怎么传
 *
 * ArkTS 的对象字面量必须有**声明过的类型**（`arkts-no-untyped-obj-literals`），
 * 而 `@ohos.net.http` 的 `header` 形参类型是 `Object`——两头对不上。
 * 这里把头先拼成一段 JSON 文本、再用 ArkTS 的严格 JSON 解析成 `Object`：
 * 类型是 `Object`（不是 `any`），运行期就是一个普通对象，正好是 http 模块要的形状。
 */
export class LaneHttpClient {
  readonly connectTimeoutMs: number;
  readonly readTimeoutMs: number;

  constructor(connectTimeoutMs: number = 10000, readTimeoutMs: number = 30000) {
    this.connectTimeoutMs = connectTimeoutMs;
    this.readTimeoutMs = readTimeoutMs;
  }

  /**
   * 发一次请求并读完整响应体。
   *
   * @throws 业务错误（网络不可达、超时等）；调用方据此判定「主机不可达」。
   */
  async send(request: LaneRequest): Promise<LaneResponse> {
    const task = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: LaneHttpClient.methodOf(request.method),
        // 按字节取：壳要转发的是 bundle / 资源 / SSE，按字符串取会把二进制弄坏。
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: this.connectTimeoutMs,
        readTimeout: this.readTimeoutMs,
        usingCache: false,
        header: LaneHttpClient.headerObject(request),
      };
      if (request.body !== null && request.body.length > 0) {
        options.extraData = LaneHttpClient.copyBytes(request.body).buffer;
      }
      const response = await task.request(request.url, options);
      const headers = LaneHttpClient.headersOf(response.header);
      const body = LaneHttpClient.bodyOf(response.result as string | ArrayBuffer);
      return new LaneResponse(response.responseCode, LaneHttpClient.reasonOf(response.responseCode), headers, body);
    } finally {
      task.destroy();
    }
  }

  /**
   * 发一次请求并**流式**读回响应体。
   *
   * 事件流的响应不能被读进内存再吐回去（长响应会把内存吃光、也会丢掉实时性），
   * 所以这里用 http 模块的 `dataReceive` 增量回调。
   *
   * @param onHeaders 收到响应头时回调。
   * @param onChunk 收到一段响应体时回调。
   * @returns 响应状态码。
   */
  async sendStreaming(request: LaneRequest, onHeaders: (headers: Map<string, string>) => void,
    onChunk: (chunk: Uint8Array) => void): Promise<number> {
    const task = http.createHttp();
    const options: http.HttpRequestOptions = {
      method: LaneHttpClient.methodOf(request.method),
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: this.connectTimeoutMs,
      // 事件流是长连接：读超时给足，别把流掐断。
      readTimeout: 3600000,
      usingCache: false,
      header: LaneHttpClient.headerObject(request),
    };
    if (request.body !== null && request.body.length > 0) {
      options.extraData = LaneHttpClient.copyBytes(request.body).buffer;
    }
    task.on('headersReceive', (header: Object) => {
      onHeaders(LaneHttpClient.headersOf(header));
    });
    task.on('dataReceive', (data: ArrayBuffer) => {
      onChunk(new Uint8Array(data));
    });
    return new Promise<number>((resolve, reject) => {
      task.requestInStream(request.url, options, (error: BusinessError, code: number) => {
        task.destroy();
        if (error) {
          reject(error);
          return;
        }
        resolve(code);
      });
    });
  }

  /** 把请求头拼成 http 模块要的 `Object`。 */
  private static headerObject(request: LaneRequest): Object {
    const parts: string[] = [];
    request.headers.forEach((value: string, name: string) => {
      if (value.length > 0) {
        parts.push(`"${LaneHttpClient.quote(name)}":"${LaneHttpClient.quote(value)}"`);
      }
    });
    if (request.cookie !== null && request.cookie.length > 0) {
      parts.push(`"Cookie":"${LaneHttpClient.quote(request.cookie)}"`);
    }
    const parsed = JSON.parse(`{${parts.join(',')}}`);
    if (parsed === null) {
      return JSON.parse('{}') as Object;
    }
    return parsed;
  }

  /** JSON 字符串转义（头里的值可能是 cookie，含分号与等号）。 */
  private static quote(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index++) {
      const ch = value.charAt(index);
      if (ch === '"' || ch === '\\') {
        result += `\\${ch}`;
      } else if (ch === '\n') {
        result += '\\n';
      } else if (ch === '\r') {
        result += '\\r';
      } else if (ch === '\t') {
        result += '\\t';
      } else {
        result += ch;
      }
    }
    return result;
  }

  /** 把方法名映射到平台枚举。 */
  private static methodOf(method: string): http.RequestMethod {
    const upper = method.toUpperCase();
    if (upper === 'POST') {
      return http.RequestMethod.POST;
    }
    if (upper === 'PUT') {
      return http.RequestMethod.PUT;
    }
    if (upper === 'DELETE') {
      return http.RequestMethod.DELETE;
    }
    if (upper === 'HEAD') {
      return http.RequestMethod.HEAD;
    }
    if (upper === 'OPTIONS') {
      return http.RequestMethod.OPTIONS;
    }
    if (upper === 'PATCH') {
      return http.RequestMethod.PATCH;
    }
    return http.RequestMethod.GET;
  }

  /** 状态码对应的原因短语。 */
  private static reasonOf(status: number): string {
    if (status === 200) {
      return 'OK';
    }
    if (status === 401) {
      return 'Unauthorized';
    }
    if (status === 403) {
      return 'Forbidden';
    }
    if (status === 404) {
      return 'Not Found';
    }
    if (status === 502) {
      return 'Bad Gateway';
    }
    if (status === 503) {
      return 'Service Unavailable';
    }
    return '';
  }

  /** 文本 → UTF-8 字节。 */
  static encode(text: string): Uint8Array {
    const bytes: number[] = [];
    for (let index = 0; index < text.length; index++) {
      let code = text.charCodeAt(index);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
        const next = text.charCodeAt(index + 1);
        code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
        index += 1;
        bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return new Uint8Array(bytes);
  }

  /** UTF-8 字节 → 文本。 */
  static decode(bytes: Uint8Array): string {
    let result = '';
    let index = 0;
    while (index < bytes.length) {
      const byte = bytes[index];
      if (byte < 0x80) {
        result += String.fromCharCode(byte);
        index += 1;
      } else if (byte < 0xE0) {
        result += String.fromCharCode(((byte & 0x1F) << 6) | (bytes[index + 1] & 0x3F));
        index += 2;
      } else if (byte < 0xF0) {
        result += String.fromCharCode(((byte & 0x0F) << 12) | ((bytes[index + 1] & 0x3F) << 6) | (bytes[index + 2] & 0x3F));
        index += 3;
      } else {
        const code = ((byte & 0x07) << 18) | ((bytes[index + 1] & 0x3F) << 12) | ((bytes[index + 2] & 0x3F) << 6) |
          (bytes[index + 3] & 0x3F);
        const adjusted = code - 0x10000;
        result += String.fromCharCode(0xD800 + (adjusted >> 10), 0xDC00 + (adjusted & 0x3FF));
        index += 4;
      }
    }
    return result;
  }

  /** 记录一条出站请求（排查用）。 */
  static trace(method: string, url: string, status: number): void {
    ShellLog.info(`${method} ${url} （HTTP ${status}）`);
  }

  /**
   * 把平台返回的头对象整理成小写键的 Map。
   *
   * 平台的响应头是一个无类型的 `Object`，ArkTS 不允许按字段下标读它，
   * 所以这里先序列化成 JSON、再用自己的 JSON 读器取字段——类型完整、键值都拿得到。
   */
  static headersOf(raw: Object | undefined): Map<string, string> {
    const headers: Map<string, string> = new Map<string, string>();
    if (raw === undefined || raw === null) {
      return headers;
    }
    const parsed = Json.parse(JSON.stringify(raw));
    if (parsed === null) {
      return headers;
    }
    const names = parsed.keys();
    for (const name of names) {
      const node = parsed.get(name);
      if (node === null) {
        continue;
      }
      headers.set(name.toLowerCase(), LaneHttpClient.headerValue(node));
    }
    return headers;
  }

  /** 一个头字段的值：标量取本身，数组按逗号连接（set-cookie 常是数组）。 */
  private static headerValue(node: JsonNode): string {
    if (node.isArray()) {
      const parts: string[] = [];
      for (let index = 0; index < node.size(); index++) {
        const item = node.item(index);
        if (item !== null) {
          parts.push(item.asString());
        }
      }
      return parts.join(', ');
    }
    return node.asString();
  }

  /** 把平台的响应体整理成字节（字符串响应按 UTF-8 编码）。 */
  static bodyOf(result: string | ArrayBuffer): Uint8Array {
    if (typeof result === 'string') {
      return LaneHttpClient.encode(result);
    }
    return new Uint8Array(result);
  }

  /** 复制一段字节（平台的 extraData 要独占一段 ArrayBuffer）。 */
  static copyBytes(bytes: Uint8Array): Uint8Array {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return copy;
  }
}
