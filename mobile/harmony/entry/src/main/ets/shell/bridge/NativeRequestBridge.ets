import { taskpool } from '@kit.ArkTS';
import { HostEntry } from '../host/HostTypes';
import { LaneHttpClient } from '../net/LaneHttpClient';
import { performLaneRequest, decodeLaneSuccess, decodeLaneFailure, getU32 } from '../net/LaneRequestTask';
import { Json } from '../util/Json';
import { Bytes } from '../util/Bytes';
import { ShellLog } from '../ShellLog';
/**
 * 壳内原生请求桥：页面把「带请求体的请求」交给壳，壳带凭证发到 lane，再把响应交回页面。
 *
 * ## 为什么需要它
 *
 * ArkWeb 的请求拦截拿不到 POST 的 body（平台限制），而 dsh 客户端的一元 RPC 是
 * `POST` + JSON body（`upstream/packages/client/connection/src/client/rpc.ts`）。
 * 没有这条桥，RPC 的 body 会在转发时丢失。
 *
 * 页面侧通过 `__DSH_TRANSPORT__.fetch` 走这条桥（见 rawfile/shell/boot.js 的 `shellFetch`）。
 *
 * ## 边界
 *
 *  - 只接受**页面 origin** 下的 URL（页面不能借桥去访问任意第三方）；
 *  - 凭证由壳附加，页面拿不到；
 *  - 只用于小响应（RPC）；事件流（SSE）仍走转发通道以保持流式。
 *
 * ## 同步还是异步
 *
 * 这条桥注册成 ArkWeb JavaScriptProxy 的**异步**方法：页面侧拿到的是一个 Promise。
 * 原因是壳这一侧要发网络请求，同步方法会把 ArkWeb 的 JS 线程堵住——
 * 一次 RPC 的往返可能上百毫秒，堵住它等于让页面卡住。
 */
export class NativeRequestBridge {
  private readonly hostProvider: () => HostEntry | null;
  private readonly pageOrigin: () => string;
  private readonly client: LaneHttpClient;


  /** 同一 URL 失败后的冷却：后端不可用时拆掉页面的零退避重试，不再进 TaskPool。 */
  private readonly failedAt: Map<string, number> = new Map<string, number>();

  /** 冷却时长。 */
  private static readonly FAILURE_COOLDOWN_MS: number = 5000;

  constructor(hostProvider: () => HostEntry | null, pageOrigin: () => string, client: LaneHttpClient) {
    this.hostProvider = hostProvider;
    this.pageOrigin = pageOrigin;
    this.client = client;
  }

  /**
   * 执行一次请求。返回页面侧约定的 JSON 字符串：
   * `{"ok":true,"status":200,"statusText":"OK","headers":{…},"bodyBase64":"…}"`
   * 或 `{"ok":false,"error":"…}"`。
   *
   * worker 返回的是自描述 ArrayBuffer（见 LaneRequestTask 的布局说明），这里只做
   * 定长读与切片：bodyBase64 在页面侧解码，主线程不做任何大文本/大 base64 解析。
   */
  async request(method: string, url: string, headersJson: string, bodyBase64: string): Promise<string> {
    try {
      const failedAt = this.failedAt.get(url);
      if (failedAt !== undefined && Date.now() - failedAt < NativeRequestBridge.FAILURE_COOLDOWN_MS) {
        // 冷却期内快速失败：风暴时主线程只做一次 Map 查询，不再压桥与网络栈。
        return NativeRequestBridge.failure('请求失败');
      }
      const target = this.laneTarget(url);
      const host = this.hostProvider();
      if (host === null) {
        return NativeRequestBridge.failure('未配置主机');
      }
      const headers = this.parseHeaders(headersJson);
      if (host.sessionCookie !== null && host.sessionCookie.length > 0) {
        headers.set('Cookie', host.sessionCookie);
      }
      // ArkWeb 的 JavaScriptProxy 回调在主线程执行：平台发 HTTP 的首步会在主线程
      // 同步查询网络代理（netmanager 被冻结时该 binder 调用可无限挂起）。
      // 重活整体外移到 TaskPool 线程，主线程只做头拼装、定长读与切片。
      const packet = new Uint8Array(await taskpool.execute(performLaneRequest, target,
        method.length === 0 ? 'GET' : method.toUpperCase(), this.stringifyHeaders(headers),
        bodyBase64, this.client.connectTimeoutMs, this.client.readTimeoutMs) as ArrayBuffer);
      if (packet.length < 4) {
        return NativeRequestBridge.failure('请求结果异常');
      }
      if (getU32(packet, 0) === 1) {
        const failure = decodeLaneFailure(packet);
        this.failedAt.set(url, Date.now());
        ShellLog.warn(`原生请求桥失败：${url}（${failure[0]} ${failure[1]}）`);
        return NativeRequestBridge.failure(failure[1].length === 0 ? '请求失败' : failure[1]);
      }
      const success = decodeLaneSuccess(packet);
      const status = success[0];
      const reason = success[1];
      const headersOut = success[2];
      const body = success[3];
      const headersText = Json.parse(headersOut) === null ? '{}' : headersOut;
      this.failedAt.delete(url);
      return `{"ok":true,"status":${status},"statusText":${Json.quote(reason)},"headers":${headersText},` +
        `"bodyBase64":${Json.quote(Bytes.toBase64(body))}}`;
    } catch (error) {
      this.failedAt.set(url, Date.now());
      const detail = error instanceof Error ? error.message : `${error}`;
      ShellLog.warn(`原生请求桥失败：${url}（${detail}）`);
      return NativeRequestBridge.failure('请求失败');
    }
  }

  /** 把头字典序列化成 JSON 文本（TaskPool 的参数必须是可序列化的字符串）。 */
  private stringifyHeaders(headers: Map<string, string>): string {
    const parts: string[] = [];
    headers.forEach((value: string, name: string) => {
      if (value.length > 0) {
        parts.push(`${Json.quote(name)}:${Json.quote(value)}`);
      }
    });
    return `{${parts.join(',')}}`;
  }

  /** 把页面 origin 下的绝对 URL 映射到 lane origin 下的同一路径。 */
  private laneTarget(url: string): string {
    const prefix = this.pageOrigin();
    if (!url.startsWith(prefix)) {
      throw new Error('不支持的请求地址');
    }
    const rest = url.substring(prefix.length);
    const questionAt = rest.indexOf('?');
    const path = questionAt < 0 ? rest : rest.substring(0, questionAt);
    const query = questionAt < 0 ? '' : rest.substring(questionAt + 1);
    const host = this.hostProvider();
    if (host === null) {
      throw new Error('未配置主机');
    }
    return `${host.laneOrigin.replace(/\/+$/, '')}${path}` + (query.length === 0 ? '' : `?${query}`);
  }

  /** 解析页面传来的请求头 JSON（一个扁平的字符串字典）。 */
  private parseHeaders(headersJson: string): Map<string, string> {
    const headers: Map<string, string> = new Map<string, string>();
    if (headersJson.length === 0) {
      return headers;
    }
    const parsed = Json.parse(headersJson);
    if (parsed === null || !parsed.isObject()) {
      return headers;
    }
    const names = parsed.keys();
    for (const name of names) {
      const value = parsed.get(name);
      if (value !== null) {
        headers.set(name, value.asString());
      }
    }
    return headers;
  }

  /** 失败应答。 */
  private static failure(error: string): string {
    return `{"ok":false,"error":${Json.quote(error)}}`;
  }
}
