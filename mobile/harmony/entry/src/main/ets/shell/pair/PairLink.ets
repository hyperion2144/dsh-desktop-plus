/**
 * 桌面端签发的一次性配对链接。
 *
 * ## 支持的两种形态
 *
 * 1. `http://主机地址:端口/pair?token=…` —— 桌面端「远程访问」面板的二维码就是这个形态
 *    （`packages/plus/desktop-remote-access/client/client.source.jsx` 的 `pairLink()`：
 *    `scheme + "://" + base + "/pair?token=" + token`）。
 * 2. `dsh-mobile://pair?token=…&base=候选1,候选2` —— 移动端专用形态
 *    （同包 `lib/links.mjs` 的 `buildPairLink`），`base` 是**地址候选列表**。
 *
 * 两种形态都带一次性令牌；**没有任何手输令牌的入口**（spec #55「配对」）。
 *
 * 解析是纯函数（不碰平台 API），因此可单独验证。
 */
export class PairLink {
  /** 一次性令牌。 */
  token: string = '';
  /** 地址候选列表（按优先级）。 */
  candidates: string[] = [];
  /** 链接里带的显示名（桌面端当前不带，留给将来的扩展）。 */
  displayName: string = '';

  /** 首选地址。 */
  origin(): string {
    return this.candidates.length > 0 ? this.candidates[0] : '';
  }

  /** 移动端专用 scheme。 */
  static readonly MOBILE_SCHEME: string = 'dsh-mobile';

  /**
   * 解析配对链接；无法识别时返回 null。
   */
  static parse(raw: string): PairLink | null {
    const text = raw.trim();
    if (text.length === 0) {
      return null;
    }
    const schemeAt = text.indexOf('://');
    if (schemeAt <= 0) {
      return null;
    }
    const scheme = text.substring(0, schemeAt).toLowerCase();
    const rest = text.substring(schemeAt + 3);
    const queryAt = rest.indexOf('?');
    const path = queryAt < 0 ? rest : rest.substring(0, queryAt);
    const query = queryAt < 0 ? '' : rest.substring(queryAt + 1);
    const params = PairLink.parseQuery(query);
    const token = (params.get('token') ?? '').trim();
    if (token.length === 0) {
      return null;
    }
    const link = new PairLink();
    link.token = token;
    link.displayName = params.get('name') ?? '';
    if (scheme === PairLink.MOBILE_SCHEME) {
      link.candidates = PairLink.splitCandidates(params.get('base') ?? params.get('origin') ?? '');
      return link.candidates.length > 0 ? link : null;
    }
    if (scheme === 'http' || scheme === 'https') {
      if (!PairLink.isPairingPath(path)) {
        return null;
      }
      const origin = PairLink.originOf(scheme, path);
      if (origin.length === 0) {
        return null;
      }
      // 链接自带的 base 参数是权威的候选列表（.local + 多网卡 IP，桌面端用
      // buildHttpPairLink 下发）；链接自身的 origin 也并进来（老链接没有 base）。
      const candidates: string[] = PairLink.splitCandidates(params.get('base') ?? '');
      if (!candidates.includes(origin)) {
        candidates.unshift(origin);
      }
      link.candidates = candidates;
      return link;
    }
    return null;
  }

  /** 配对入口路径：裸 `/pair`（桌面端形态）或保留命名空间下的 `/pair`。 */
  private static isPairingPath(path: string): boolean {
    const clean = path.replace(/\/+$/, '');
    if (clean.length === 0) {
      return true;
    }
    return clean.endsWith('/pair');
  }

  /** 由 scheme 与 path 取出 origin（scheme://host[:port]）。 */
  private static originOf(scheme: string, path: string): string {
    const slashAt = path.indexOf('/');
    const authority = slashAt < 0 ? path : path.substring(0, slashAt);
    if (authority.length === 0) {
      return '';
    }
    let host = authority;
    let port = '';
    const colonAt = authority.lastIndexOf(':');
    if (colonAt > 0) {
      host = authority.substring(0, colonAt);
      port = authority.substring(colonAt);
    }
    if (host.length === 0) {
      return '';
    }
    return `${scheme}://${host}${port}`;
  }

  /** 拆候选列表并逐个归一化。 */
  private static splitCandidates(raw: string): string[] {
    const result: string[] = [];
    const parts = raw.split(',');
    for (const part of parts) {
      const origin = PairLink.normalizeOrigin(part);
      if (origin.length > 0 && !result.includes(origin)) {
        result.push(origin);
      }
    }
    return result;
  }

  /**
   * 归一化一个地址：补协议头、去尾斜杠。
   *
   * 桌面端给的 base 形态是 `主机:端口`（无协议），故缺协议时按 http 补齐。
   */
  static normalizeOrigin(raw: string): string {
    const text = raw.trim().replace(/\/+$/, '');
    if (text.length === 0) {
      return '';
    }
    const withScheme = text.includes('://') ? text : `http://${text}`;
    const schemeAt = withScheme.indexOf('://');
    const scheme = withScheme.substring(0, schemeAt).toLowerCase();
    const rest = withScheme.substring(schemeAt + 3);
    const slashAt = rest.indexOf('/');
    const authority = slashAt < 0 ? rest : rest.substring(0, slashAt);
    if (authority.length === 0) {
      return '';
    }
    let host = authority;
    let port = '';
    const colonAt = authority.lastIndexOf(':');
    if (colonAt > 0) {
      host = authority.substring(0, colonAt);
      port = authority.substring(colonAt);
    }
    if (host.length === 0) {
      return '';
    }
    return `${scheme}://${host}${port}`;
  }

  /** 解析查询串（不做 + → 空格 的替换：令牌与地址里没有空格）。 */
  private static parseQuery(raw: string): Map<string, string> {
    const result: Map<string, string> = new Map<string, string>();
    if (raw.length === 0) {
      return result;
    }
    const pairs = raw.split('&');
    for (const pair of pairs) {
      if (pair.length === 0) {
        continue;
      }
      const equalsAt = pair.indexOf('=');
      if (equalsAt <= 0) {
        continue;
      }
      const name = PairLink.decode(pair.substring(0, equalsAt));
      const value = PairLink.decode(pair.substring(equalsAt + 1));
      if (name.length > 0) {
        result.set(name, value);
      }
    }
    return result;
  }

  /** URL 解码。 */
  private static decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }
}
