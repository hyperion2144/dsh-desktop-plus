import { http } from '@kit.NetworkKit';
import { laneMethodOf, laneReasonOf, lanePutU32 } from './LaneWire';
import { Bytes } from '../util/Bytes';

/**
 * lane 请求的并发执行体，运行在 TaskPool 线程。
 *
 * 为什么存在：ArkWeb 的 JavaScriptProxy「异步方法」回调依然跑在**主线程**。
 * 真机 freeze 栈证实，在回调里直接发 HTTP 时，平台 http 模块的首步会在主线程
 * 同步向网络管理查询代理（netmanager 被系统冻结时这个 binder 调用可无限等待），
 * 请求/响应体的 base64 大解码也在主线程倾倒海量对象——两者叠加把主线程堵过
 * 6 秒，触发 THREAD_BLOCK_6S 整进程被杀。
 *
 * 所以请求桥的主线程侧只做 URL 校验与头拼装，解码与收发都搬进这个并发函数。
 *
 * ## 返回为什么是二进制（而不是 JSON 字符串）
 *
 * 早期版本把响应打成 `{"ok":…,"bodyBase64":"…"}` 的 JSON 字符串回主线程，
 * 结果主线程要 `JSON.parse` 几 MB 文本、再 `fromBase64` 几 MB——页面启动要拉
 * 几十个 200KB~2MB 的响应，主线程被解码淹没，照样触发 THREAD_BLOCK。
 * 现在直接返回一段自描述的 ArrayBuffer：主线程只做两次定长读 + 切片，
 * 响应体字节零拷贝直通 socket。
 *
 * 布局（大端）：
 * ```text
 * kind(4)  = 0 成功：status(4) reasonLen(4) reason(n) headersLen(4) headers(m) body(…)
 * kind(4)  = 1 失败：code(4) detailLen(4) detail(n)
 * ```
 */
@Concurrent
export async function performLaneRequest(url: string, method: string, headersJson: string,
  bodyBase64: string, connectTimeoutMs: number, readTimeoutMs: number): Promise<ArrayBuffer> {
  const task = http.createHttp();
  try {
    const options: http.HttpRequestOptions = {
      method: laneMethodOf(method),
      // 与 LaneHttpClient 一致按字节取：转发的是 RPC 体等二进制内容，按字符串取会弄坏。
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: connectTimeoutMs,
      readTimeout: readTimeoutMs,
      usingCache: false,
      header: JSON.parse(headersJson.length === 0 ? '{}' : headersJson) as Object,
    };
    if (bodyBase64.length > 0) {
      options.extraData = Bytes.fromBase64(bodyBase64).buffer;
    }
    const response = await task.request(url, options);
    const reason = laneReasonOf(response.responseCode);
    const headersText = JSON.stringify(response.header) as string;
    const body = new Uint8Array(response.result as ArrayBuffer);
    const reasonBytes = Bytes.encode(reason);
    const headersBytes = Bytes.encode(headersText);
    const total = 20 + reasonBytes.length + headersBytes.length + body.length;
    const out = new Uint8Array(total);
    lanePutU32(out, 0, 0);
    lanePutU32(out, 4, response.responseCode);
    lanePutU32(out, 8, reasonBytes.length);
    out.set(reasonBytes, 12);
    lanePutU32(out, 12 + reasonBytes.length, headersBytes.length);
    out.set(headersBytes, 16 + reasonBytes.length);
    out.set(body, 20 + reasonBytes.length + headersBytes.length);
    return out.buffer;
  } catch (error) {
    // 失败必须带出错误码与消息：不然真机上「请求失败」无法区分是断网、超时还是栈资源耗尽。
    let code = -1;
    let detail = '';
    if (error instanceof Error) {
      detail = error.message;
    } else {
      detail = `${error}`;
    }
    const maybeCode = (error as Record<string, number>).code;
    if (typeof maybeCode === 'number') {
      code = maybeCode;
    }
    const detailBytes = Bytes.encode(detail);
    const out = new Uint8Array(12 + detailBytes.length);
    lanePutU32(out, 0, 1);
    lanePutU32(out, 4, code);
    lanePutU32(out, 8, detailBytes.length);
    out.set(detailBytes, 12);
    return out.buffer;
  } finally {
    task.destroy();
  }
}


/** 从字节串的指定偏移读一个大端 uint32。 */
export function getU32(source: Uint8Array, at: number): number {
  return ((source[at] << 24) | (source[at + 1] << 16) | (source[at + 2] << 8) | source[at + 3]) >>> 0;
}

/** 解出成功响应：状态、原因短语、头 JSON 文本、响应体（零拷贝引用入参的切片）。 */
export function decodeLaneSuccess(source: Uint8Array): [number, string, string, Uint8Array] {
  const status = getU32(source, 4);
  const reasonLen = getU32(source, 8);
  const reason = Bytes.decode(source.subarray(12, 12 + reasonLen));
  const headersLen = getU32(source, 12 + reasonLen);
  const headersAt = 16 + reasonLen;
  const headers = Bytes.decode(source.subarray(headersAt, headersAt + headersLen));
  const body = source.subarray(headersAt + headersLen);
  return [status, reason, headers, body];
}

/** 解出失败响应：错误码与消息。 */
export function decodeLaneFailure(source: Uint8Array): [number, string] {
  const code = getU32(source, 4);
  const detailLen = getU32(source, 8);
  const detail = Bytes.decode(source.subarray(12, 12 + detailLen));
  return [code, detail];
}
