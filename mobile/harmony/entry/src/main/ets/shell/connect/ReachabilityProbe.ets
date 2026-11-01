/**
 * origin 拆出来的连接终点（主机名 + 端口）。
 */
export class Endpoint {
  host: string = '';
  port: number = 0;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }
}

/**
 * 无凭证可达性预检的端口（真实实现就是本文件的 ReachabilityProbe）。
 */
export interface ReachabilityProber {
  reachable(origin: string): Promise<boolean>;
}

/**
 * 一次 TCP 连接尝试：由平台实现（真机走 `@ohos.net.socket`，对拍里换成 node 的 net）。
 *
 * 只回答「连得上吗」：不读、不写、不带任何凭证。
 */
export type TcpConnector = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

/**
 * 无凭证可达性预检：**只做一次 TCP 连接**。
 *
 * ## 为什么在 accept 之前
 *
 * 配对链接里的地址可能根本不通（地址写错、换了网络、桌面没开机）。
 * 旧流程先发 accept（带一次性令牌）才发现连不上——凭证已经发给了不可达甚至错误的目标。
 * 契约要求「配对前探测，不把凭证发给不可达目标」，所以这里先探一次：
 * **只连 TCP，不发任何 HTTP 请求，更不带任何凭证**。
 *
 * 预检只回答「值不值得把凭证发过去」：连得上就算可达，其余（连不上、超时、
 * 地址解析不出）一律算不可达。
 *
 * 这一层是纯逻辑（不碰平台 API），因此能在 node 下单独验证（见 tools/parity-check.mjs）。
 */
export class ReachabilityProbe implements ReachabilityProber {
  private readonly connector: TcpConnector;

  constructor(connector: TcpConnector) {
    this.connector = connector;
  }

  /**
   * 目标是否可达（连得上就算可达）。
   *
   * @param origin 目标地址（`scheme://host:port` 或 `host:port`）。
   * @param timeoutMs 连接超时（毫秒）。
   */
  async reachable(origin: string, timeoutMs: number = ReachabilityProbe.DEFAULT_TIMEOUT_MS): Promise<boolean> {
    const endpoint = ReachabilityProbe.endpointOf(origin);
    if (endpoint === null) {
      return false;
    }
    try {
      return await this.connector(endpoint.host, endpoint.port, timeoutMs);
    } catch (error) {
      return false;
    }
  }

  /**
   * origin → 连接终点；解析不出返回 null。
   *
   * 支持 `scheme://host:port`、`host:port` 与 IPv6 字面量 `[::1]:port`；
   * 缺省端口按 scheme 补（`https`/`wss` → 443，其余 → 80）。
   */
  static endpointOf(origin: string): Endpoint | null {
    let text = origin.trim();
    if (text.length === 0) {
      return null;
    }
    let secure = false;
    const schemeAt = text.indexOf('://');
    if (schemeAt >= 0) {
      const scheme = text.substring(0, schemeAt).toLowerCase();
      secure = scheme === 'https' || scheme === 'wss';
      text = text.substring(schemeAt + 3);
    }
    // 去掉路径 / 查询串 / 片段：预检只关心「连到哪里」。
    text = text.split('/')[0].split('?')[0].split('#')[0];
    if (text.length === 0) {
      return null;
    }
    const defaultPort = secure ? 443 : 80;
    if (text.startsWith('[')) {
      const close = text.indexOf(']');
      if (close < 0) {
        return null;
      }
      const host = text.substring(1, close);
      if (host.length === 0) {
        return null;
      }
      const tail = text.substring(close + 1);
      if (!tail.startsWith(':')) {
        return new Endpoint(host, defaultPort);
      }
      const port = ReachabilityProbe.portOf(tail.substring(1));
      return port === null ? null : new Endpoint(host, port);
    }
    const colon = text.lastIndexOf(':');
    if (colon < 0) {
      return new Endpoint(text, defaultPort);
    }
    const host = text.substring(0, colon);
    const port = ReachabilityProbe.portOf(text.substring(colon + 1));
    if (host.length === 0 || port === null) {
      return null;
    }
    return new Endpoint(host, port);
  }

  /** 端口文本 → 数字；不是合法端口返回 null。 */
  private static portOf(text: string): number | null {
    if (text.length === 0) {
      return null;
    }
    for (let index = 0; index < text.length; index++) {
      const ch = text.charAt(index);
      if (ch < '0' || ch > '9') {
        return null;
      }
    }
    const port = Number(text);
    if (port <= 0 || port > 65535) {
      return null;
    }
    return port;
  }

  /** 预检超时（毫秒）：预检要快——不通就立刻停，不让用户干等。 */
  static readonly DEFAULT_TIMEOUT_MS: number = 2000;
}
