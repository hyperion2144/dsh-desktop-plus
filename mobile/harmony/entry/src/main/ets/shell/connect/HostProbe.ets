import { LaneHttpClient, LaneRequest } from '../net/LaneHttpClient';
import { ShellSettings } from '../ShellSettings';

/**
 * 主机探测：往返延迟与可达性。
 *
 * 探测打的是 lane 控制面的状态端点（`/__dsh-mobile/pair`）：**不需要凭证**、响应极小，
 * 因此可以随时探，不打扰主机也不泄露任何东西。
 */
export class HostProbe {
  private readonly client: LaneHttpClient;

  constructor(client: LaneHttpClient) {
    this.client = client;
  }

  /**
   * 测一次往返延迟（毫秒）；不可达时返回 null。
   */
  async latency(origin: string): Promise<number | null> {
    const url = `${origin.replace(/\/+$/, '')}${ShellSettings.LANE_PREFIX}/pair`;
    const started = Date.now();
    try {
      const response = await this.client.send(new LaneRequest(url, 'GET', null, new Map<string, string>(), null));
      if (response.status < 200 || response.status >= 300) {
        return null;
      }
      return Date.now() - started;
    } catch (error) {
      return null;
    }
  }
}
