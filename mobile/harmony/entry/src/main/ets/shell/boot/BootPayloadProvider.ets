import { BootPayload } from './BootPayload';
import { LaneIndexParser } from './LaneIndexParser';
import { LaneHttpClient, LaneRequest, LaneResponse } from '../net/LaneHttpClient';
import { HostEntry } from '../host/HostTypes';
import { InjectionRow } from './InjectionRow';
import { ShellLog } from '../ShellLog';

/** 引导载荷装载失败（主机不可达 / 页面不像 dsh 页面）。 */
export class BootPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootPayloadError';
  }
}

/**
 * 主机不可达（网络层失败）。
 *
 * 与 HostGateError 分开：门禁拒绝要走降级链（renew / accept），网络不通只能换候选地址。
 */
export class HostUnreachableError extends BootPayloadError {
  constructor(message: string) {
    super(message);
    this.name = 'HostUnreachableError';
  }
}

/**
 * 配对门禁拒绝（HTTP 401 + `{"error":"unpaired"}`）。
 *
 * 这是降级链的入口：门禁说「这台设备没配对（或会话失效了）」，壳据此依次尝试
 * `/api/pair/renew` 静默续期 → 链接内令牌 `/api/pair/accept` → 全败则标记「需重新配对」。
 */
export class HostGateError extends BootPayloadError {
  constructor(message: string) {
    super(message);
    this.name = 'HostGateError';
  }
}

/**
 * 引导载荷的来源：向当前主机要一份渲染好的 index.html，解析出注入行。
 *
 * 「注入行从 lane 拉取/合成」的落地：facade、`__DSH_BOOT__` 全局、bootstrap 的插件 combo
 * 都是**主机运行时才有**的内容（依赖主机上装了哪些插件），壳自己造不出来，只能取。
 */
export class BootPayloadProvider {
  private readonly client: LaneHttpClient;
  private readonly parser: LaneIndexParser = new LaneIndexParser();

  constructor(client: LaneHttpClient) {
    this.client = client;
  }

  /**
   * 拉取并解析当前主机的引导载荷。
   *
   * @throws HostUnreachableError 主机不可达。
   * @throws HostGateError 门禁拒绝（这台设备没配对 / 会话失效）。
   * @throws BootPayloadError 主机返回异常页面。
   */
  async load(host: HostEntry, socketBaseUrl: string, pageOrigin: string): Promise<BootPayload> {
    const url = `${host.laneOrigin.replace(/\/+$/, '')}/index.html`;
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Accept', 'text/html');
    let response: LaneResponse;
    try {
      response = await this.client.send(new LaneRequest(url, 'GET', host.sessionCookie, headers, null));
    } catch (error) {
      throw new HostUnreachableError(`无法连接主机 ${host.displayName()}`);
    }
    if (response.status < 200 || response.status >= 300) {
      // 门禁拒绝：body 是 {"error":"unpaired"}（lane 的配对门禁，见 proxy.mjs）。
      if (response.status === 401 && response.text().includes(BootPayloadProvider.UNPAIRED_MARK)) {
        throw new HostGateError(`主机要求重新配对：${host.displayName()}`);
      }
      throw new BootPayloadError(`主机返回 HTTP ${response.status}`);
    }
    const html = response.text();
    const rows = this.parser.parse(html);
    if (!rows.some((row: InjectionRow) => row.text.includes(BootPayloadProvider.FACADE_MARK))) {
      throw new BootPayloadError('主机页面缺少模块加载 facade');
    }
    if (!rows.some((row: InjectionRow) => row.text.includes(BootPayloadProvider.BOOT_GRAPH_MARK))) {
      throw new BootPayloadError('主机页面缺少启动图');
    }
    ShellLog.info(`引导载荷就绪：主机=${host.displayName()} 注入行=${rows.length}`);
    const payload = new BootPayload();
    payload.hostId = host.id;
    payload.hostLabel = host.displayName();
    payload.laneOrigin = host.laneOrigin.replace(/\/+$/, '');
    payload.pageOrigin = pageOrigin;
    payload.socketBaseUrl = socketBaseUrl;
    payload.rows = rows;
    return payload;
  }

  /** facade 行标记：`window.__ModuleLoader__=` 队列。 */
  private static readonly FACADE_MARK: string = '__ModuleLoader__';

  /** 启动图行标记：`globalThis["__DSH_BOOT__"] = …`。 */
  private static readonly BOOT_GRAPH_MARK: string = '__DSH_BOOT__';

  /** 配对门禁的 body 标记。 */
  private static readonly UNPAIRED_MARK: string = 'unpaired';
}
