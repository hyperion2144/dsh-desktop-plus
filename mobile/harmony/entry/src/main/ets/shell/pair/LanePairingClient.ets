import { LaneHttpClient, LaneRequest, LaneResponse } from '../net/LaneHttpClient';
import { PairFailureCode } from './PairFailure';
import { Json } from '../util/Json';
import { ShellSettings } from '../ShellSettings';
import { PairOutcome } from './PairOutcome';
import { PairAcceptor } from './PairFlow';
import { WsTokenOutcome } from './WsTokenOutcome';

/**
 * lane 控制面的客户端：配对、续期、隧道地址可达性探测。
 *
 * ## 契约（权威来源：packages/plus/desktop-remote-access/lib/index.mjs 的 routePairing）
 *
 * | 端点 | 方法 | 请求 | 成功 | 失败 |
 * |---|---|---|---|---|
 * | `/__dsh-mobile/api/pair/accept` | POST | `{token, name}` | 200 + `Set-Cookie: dsh_mobile_session=…` + `{deviceId}` | 403 `invalid-token` |
 * | `/__dsh-mobile/api/pair/renew` | POST | `{deviceId}` | 200 + `Set-Cookie` | 403 `unknown-device` |
 * | `/__dsh-mobile/api/pair/probe` | GET | `?url=…` | 200 `{ok, status, reason}` | 401 未配对 |
 * | `/__dsh-mobile/api/pair/ws-token` | POST | — | 200 `{token}` | 401 未配对 |
 *
 * 会话 cookie 由服务端用 `Set-Cookie` 下发（HttpOnly）；壳把它收进资产存储，
 * **不下发给页面**（spec #55「凭证与安全」）。
 */
export class LanePairingClient implements PairAcceptor {
  private readonly client: LaneHttpClient;

  constructor(client: LaneHttpClient) {
    this.client = client;
  }

  /** 接受配对：把链接里的一次性令牌换成设备 ID + 会话 cookie。 */
  async accept(origin: string, token: string, deviceName: string): Promise<PairOutcome> {
    const body = LaneHttpClient.encode(JSON.stringify({ token: token, name: deviceName }));
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Content-Type', 'application/json');
    const outcome = new PairOutcome();
    let response: LaneResponse;
    try {
      response = await this.client.send(new LaneRequest(
        LanePairingClient.endpoint(origin, '/api/pair/accept'), 'POST', null, headers, body));
    } catch (error) {
      outcome.kind = 'unreachable';
      outcome.detail = '主机不可达';
      return outcome;
    }
    if (response.status === 200) {
      const cookie = LanePairingClient.sessionCookieOf(response.headers);
      const deviceId = LanePairingClient.deviceIdOf(response.text());
      if (cookie.length === 0 || deviceId.length === 0) {
        outcome.kind = 'rejected';
        outcome.failure = 'no-session';
        return outcome;
      }
      outcome.kind = 'accepted';
      outcome.deviceId = deviceId;
      outcome.cookie = cookie;
      return outcome;
    }
    outcome.kind = 'rejected';
    outcome.failure = response.status === 403 ? 'invalid-token' : 'unexpected';
    return outcome;
  }

  /** 续期：凭 deviceId 取回会话 cookie（cookie 丢失 / 被桌面端轮换时的恢复通道）。 */
  async renew(origin: string, deviceId: string): Promise<PairOutcome> {
    const body = LaneHttpClient.encode(JSON.stringify({ deviceId: deviceId }));
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Content-Type', 'application/json');
    const outcome = new PairOutcome();
    let response: LaneResponse;
    try {
      response = await this.client.send(new LaneRequest(
        LanePairingClient.endpoint(origin, '/api/pair/renew'), 'POST', null, headers, body));
    } catch (error) {
      outcome.kind = 'unreachable';
      outcome.detail = '主机不可达';
      return outcome;
    }
    if (response.status === 200) {
      const cookie = LanePairingClient.sessionCookieOf(response.headers);
      if (cookie.length === 0) {
        outcome.kind = 'rejected';
        outcome.failure = 'no-session';
        return outcome;
      }
      outcome.kind = 'renewed';
      outcome.cookie = cookie;
      outcome.deviceId = deviceId;
      return outcome;
    }
    outcome.kind = 'rejected';
    outcome.failure = response.status === 403 ? 'device-removed' : 'unexpected';
    return outcome;
  }

  /**
   * 取直连令牌：把会话 cookie 换成一个可以放进 URL 的签名令牌。
   *
   * WS 无法自定义请求头，而页面 origin（壳回环）与 lane 是**跳站**：`SameSite=Lax`
   * 的会话 cookie 在跳站握手时根本不会带（改 None 又必须 Secure，lane 是明文）。
   * 令牌只用于建立数据面连接：lane 验签后还原会话值，沿用既有设备判定；
   * 不具备 RPC 权限，随会话轮换失效。
   *
   * 结果必须是三分的（见 `WsTokenOutcome`）：401/403 是「会话失效」，要进降级链；
   * 只有网络/地址失败才是「换候选地址」。
   */
  async wsToken(origin: string, cookie: string | null): Promise<WsTokenOutcome> {
    const outcome = new WsTokenOutcome();
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Content-Type', 'application/json');
    let response: LaneResponse;
    try {
      response = await this.client.send(new LaneRequest(
        LanePairingClient.endpoint(origin, '/api/pair/ws-token'), 'POST', cookie, headers,
        LaneHttpClient.encode('{}')));
    } catch (error) {
      outcome.kind = 'unreachable';
      return outcome;
    }
    if (response.status === 401 || response.status === 403) {
      // 门禁拒绝：会话失效 / 设备被移除。交给降级链，绝不能当成「主机离线」。
      outcome.kind = 'gated';
      return outcome;
    }
    if (response.status !== 200) {
      outcome.kind = 'unreachable';
      return outcome;
    }
    const parsed = Json.parse(response.text());
    const token = parsed === null ? '' : parsed.stringField('token');
    if (token.length === 0) {
      outcome.kind = 'unreachable';
      return outcome;
    }
    outcome.kind = 'token';
    outcome.token = token;
    return outcome;
  }

  /**
   * 隧道地址可达性探测：问 lane「这个隧道地址的配对入口通不通」。
   *
   * 探测请求要带会话 cookie（lane 的作用域两级：属主或已配对设备才能探测）。
   */
  async probe(origin: string, tunnelUrl: string, cookie: string | null): Promise<PairOutcome> {
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Accept', 'application/json');
    const url = `${LanePairingClient.endpoint(origin, '/api/pair/probe')}?url=${LanePairingClient.encodeQuery(tunnelUrl)}`;
    const outcome = new PairOutcome();
    let response: LaneResponse;
    try {
      response = await this.client.send(new LaneRequest(url, 'GET', cookie, headers, null));
    } catch (error) {
      outcome.kind = 'unreachable';
      outcome.detail = '主机不可达';
      return outcome;
    }
    if (response.status !== 200) {
      outcome.kind = 'rejected';
      outcome.failure = 'unexpected';
      return outcome;
    }
    const parsed = Json.parse(response.text());
    outcome.kind = 'verdict';
    outcome.reachable = parsed !== null && parsed.booleanField('ok');
    outcome.detail = parsed === null ? '' : parsed.stringField('reason');
    return outcome;
  }

  /**
   * 从响应头里取出会话 cookie。
   *
   * 取的是**整对** `dsh_mobile_session=<值>`：出站时壳直接把它当 `Cookie` 头附加，
   * 而 lane 的门禁按 `name=value` 解析（见 proxy.mjs 的 parseCookies）。
   */
  static sessionCookieOf(headers: Map<string, string>): string {
    const line = headers.get('set-cookie');
    if (line === undefined || line === null) {
      return '';
    }
    const marker = 'dsh_mobile_session=';
    const at = line.indexOf(marker);
    if (at < 0) {
      return '';
    }
    const rest = line.substring(at + marker.length);
    let end = rest.length;
    for (let index = 0; index < rest.length; index++) {
      const ch = rest.charAt(index);
      if (ch === ';' || ch === ',' || ch === ' ' || ch === '\t') {
        end = index;
        break;
      }
    }
    return `${marker}${rest.substring(0, end)}`;
  }

  /** 从应答里取设备 ID。 */
  private static deviceIdOf(text: string): string {
    const parsed = Json.parse(text);
    return parsed === null ? '' : parsed.stringField('deviceId');
  }

  /** lane 控制面的端点。 */
  private static endpoint(origin: string, path: string): string {
    return `${origin.replace(/\/+$/, '')}${ShellSettings.LANE_PREFIX}${path}`;
  }

  /** 查询串转义。 */
  private static encodeQuery(value: string): string {
    let result = '';
    for (let index = 0; index < value.length; index++) {
      const ch = value.charAt(index);
      if (ch === ':' || ch === '/' || ch === '?' || ch === '#' || ch === '&' || ch === '=' || ch === '+' || ch === ' ') {
        result += `%${value.charCodeAt(index).toString(16).padStart(2, '0').toUpperCase()}`;
      } else {
        result += ch;
      }
    }
    return result;
  }
}
