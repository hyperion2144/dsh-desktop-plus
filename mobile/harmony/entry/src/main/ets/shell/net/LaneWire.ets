import { http } from '@kit.NetworkKit';

/**
 * lane 并发请求的纯辅助函数，独立成模块的原因：
 * @Concurrent 函数体只允许引用 **import 进来的符号**与局部变量——
 * 同文件顶层函数会被 es2abc 拒绝（10705000），所以这些函数必须放在
 * 可被 LaneRequestTask 显式 import 的独立模块里。
 */

/** 把方法名映射到平台枚举（与 LaneHttpClient 同表）。 */
export function laneMethodOf(method: string): http.RequestMethod {
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

/** 状态码对应的原因短语（与 LaneHttpClient 同表）。 */
export function laneReasonOf(status: number): string {
  if (status === 200) {
    return laneQuote('OK');
  }
  if (status === 401) {
    return laneQuote('Unauthorized');
  }
  if (status === 403) {
    return laneQuote('Forbidden');
  }
  if (status === 404) {
    return laneQuote('Not Found');
  }
  if (status === 500) {
    return laneQuote('Internal Server Error');
  }
  if (status === 502) {
    return laneQuote('Bad Gateway');
  }
  return laneQuote('Response');
}

/** JSON 字符串转义（头与 cookie 里可能含分号等号，须转义后再嵌入）。 */
export function laneQuote(value: string): string {
  let result = '"';
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
  return `${result}"`;
}

/** 往字节串的指定偏移写一个大端 uint32（并发函数体只认导入符号，所以住在这里）。 */
export function lanePutU32(out: Uint8Array, at: number, value: number): void {
  out[at] = (value >>> 24) & 0xff;
  out[at + 1] = (value >>> 16) & 0xff;
  out[at + 2] = (value >>> 8) & 0xff;
  out[at + 3] = value & 0xff;
}

/** 从字节串的指定偏移读一个大端 uint32。 */
export function laneGetU32(source: Uint8Array, at: number): number {
  return ((source[at] << 24) | (source[at + 1] << 16) | (source[at + 2] << 8) | source[at + 3]) >>> 0;
}
