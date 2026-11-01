/**
 * 字节工具：UTF-8 编解码与字节数组的常用操作。
 *
 * 壳内的 HTTP 服务与 WS 直连路径都要在字节层面工作（请求头是 ASCII、body 可能是二进制），
 * 所以这些操作集中在这里，而不是散落在各处。
 */
export class Bytes {
  /** 拼接两段字节。 */
  static concat(first: Uint8Array, second: Uint8Array): Uint8Array {
    const result = new Uint8Array(first.length + second.length);
    result.set(first);
    result.set(second, first.length);
    return result;
  }

  /** 取一段字节的副本（不共享底层缓冲）。 */
  static range(source: Uint8Array, start: number, end: number): Uint8Array {
    const from = Math.max(0, Math.min(start, source.length));
    const to = Math.max(from, Math.min(end, source.length));
    const result = new Uint8Array(to - from);
    result.set(source.subarray(from, to));
    return result;
  }

  /** 在字节数组里找一段字节的首次出现位置；找不到返回 -1。 */
  static indexOf(source: Uint8Array, needle: Uint8Array, from: number): number {
    if (needle.length === 0 || source.length < needle.length) {
      return -1;
    }
    const limit = source.length - needle.length;
    for (let index = Math.max(0, from); index <= limit; index++) {
      let matched = true;
      for (let offset = 0; offset < needle.length; offset++) {
        if (source[index + offset] !== needle[offset]) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return index;
      }
    }
    return -1;
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

  /** 字节 → 十六进制文本（调试用）。 */
  static toHex(bytes: Uint8Array): string {
    const digits = '0123456789abcdef';
    let result = '';
    for (let index = 0; index < bytes.length; index++) {
      result += digits.charAt((bytes[index] >> 4) & 0xF);
      result += digits.charAt(bytes[index] & 0xF);
    }
    return result;
  }

  /** 生成一段随机字节（WebSocket 握手用）。 */
  static random(length: number): Uint8Array {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    return bytes;
  }

  /**
   * Base64 编码（RFC 4648 标准字母表）。
   *
   * 为什么自己实现：平台提供的 `util.Base64Helper` 在 ArkTS 的类型系统里是 `any`，
   * 用它写 `const x = util.Base64Helper.encodeToStringSync(...)` 会被
   * `arkts-no-any-unknown` 拦下。这里的实现与 Node 的 `Buffer.toString('base64')` 逐字节核对过。
   */
  static toBase64(bytes: Uint8Array): string {
    return bytesToBase64(bytes);
  }

  /** Base64 解码（忽略空白与填充以外的字符）。 */
  static fromBase64(text: string): Uint8Array {
    return bytesFromBase64(text);
  }
}

/** 字节 → Base64（模块级实现：TaskPool 并发函数引用的是这一份）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const b0 = bytes[index];
    const b1 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const b2 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    result += chars.charAt(b0 >> 2);
    result += chars.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    result += index + 1 < bytes.length ? chars.charAt(((b1 & 0x0F) << 2) | (b2 >> 6)) : '=';
    result += index + 2 < bytes.length ? chars.charAt(b2 & 0x3F) : '=';
  }
  return result;
}

/** Base64 → 字节（模块级实现：TaskPool 并发函数引用的是这一份）。 */
export function bytesFromBase64(text: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // 先收集字符值，不把过滤后的字符拼成巨型字符串：大请求体那样解码一次会
  // 生成成百 MB 的中间字符串（正是真机卡死时的主线程分配热点）。
  const codes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = chars.indexOf(text.charAt(index));
    if (code >= 0) {
      codes.push(code);
    }
  }
  const bytes = new Uint8Array(Math.floor(codes.length * 3 / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;
  for (let index = 0; index < codes.length; index++) {
    buffer = (buffer << 6) | codes[index];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[position] = (buffer >> bits) & 0xFF;
      position += 1;
    }
  }
  return bytes;
}
