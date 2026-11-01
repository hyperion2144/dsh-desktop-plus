import { HostEntry, HostForm, HostStatus } from '../host/HostTypes';
import { HostRegistry } from '../host/HostRegistry';
import { LanePairingClient } from './LanePairingClient';
import { PairOutcome } from './PairOutcome';
import { PairLink } from './PairLink';
import { PairFlowResult, runPairing } from './PairFlow';
import { ReachabilityProbe } from '../connect/ReachabilityProbe';
import { connectTcp } from '../connect/TcpConnector';
import { ShellLog } from '../ShellLog';
import { ShellSettings } from '../ShellSettings';

/**
 * 配对流程的编排：链接 → 换设备 ID + 会话 cookie → 落资产存储 → 探测隧道候选。
 *
 * ## 边界
 *
 * - 配对**只认桌面端签发的一次性链接**（扫码 = 用相机读同一个链接），没有任何令牌手输入口；
 * - 凭证（deviceId / cookie）落进资产存储，页面永远拿不到；
 * - 隧道形态的地址条目要过 lane 既有可达性探测（`/api/pair/probe`），结论写进主机条目；
 * - **accept 之前先做无凭证可达性预检**（只连 TCP）：不通的目标不收凭证。
 *
 * 流程本身在 `pair/PairFlow`（纯逻辑，可单独验证）；这一层只负责把结果落进主机仓库。
 */
export class PairingService {
  private readonly registry: HostRegistry;
  private readonly pairing: LanePairingClient;
  private readonly prober: ReachabilityProbe;

  constructor(
    registry: HostRegistry,
    pairing: LanePairingClient,
    prober: ReachabilityProbe = new ReachabilityProbe(connectTcp),
  ) {
    this.registry = registry;
    this.pairing = pairing;
    this.prober = prober;
  }

  /**
   * 用一条配对链接完成配对。
   *
   * 候选地址按顺序尝试：某个地址不可达就换下一个；令牌无效（过期 / 已用过）则不再重试
   * ——同一台桌面的多个地址共用同一个令牌，令牌无效对所有候选都无效。
   *
   * @returns 成功时返回主机条目，失败时返回失败分类。
   */
  async pair(link: PairLink): Promise<PairOutcome> {
    const candidates: string[] = [];
    for (const candidate of link.candidates) {
      const trimmed = candidate.replace(/\/+$/, '');
      if (trimmed.length > 0 && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
    const outcome = new PairOutcome();
    if (candidates.length === 0) {
      outcome.kind = 'rejected';
      outcome.failure = 'malformed';
      return outcome;
    }
    const flow = await runPairing(candidates, link.token, this.pairing, this.prober, ShellSettings.DEVICE_NAME);
    for (const skipped of flow.unreachable) {
      ShellLog.warn(`配对候选预检未通过（不发 accept）：${skipped}`);
    }
    if (!flow.paired) {
      outcome.kind = 'rejected';
      outcome.failure = flow.failure;
      return outcome;
    }
    const host = this.buildHost(link, flow.origin, candidates, flow);
    await this.registry.upsert(host);
    await this.registry.setCurrent(host.id);
    await this.probeTunnels(host, candidates);
    ShellLog.info(`配对成功：${host.displayName()}（${host.laneOrigin}）`);
    outcome.kind = 'accepted';
    outcome.deviceId = flow.deviceId;
    outcome.cookie = flow.cookie;
    return outcome;
  }

  /**
   * 隧道地址的可达性探测（lane 既有 `/api/pair/probe`）。
   *
   * 探测要问一台**已经配对**的 lane（探测端点要求属主或已配对设备），所以用刚配对上的
   * 那台桌面做探测者，探测目标是隧道形态的地址：
   *  - 这台主机本身就是隧道地址 → 探它自己（公网入口通不通）；
   *  - 链接里还有别的隧道候选 → 一并探。
   */
  private async probeTunnels(host: HostEntry, candidates: string[]): Promise<void> {
    const tunnels: string[] = [];
    for (const candidate of candidates) {
      if (HostForm.of(candidate) === HostForm.TUNNEL) {
        tunnels.push(candidate);
      }
    }
    if (tunnels.length === 0) {
      return;
    }
    let reachable: boolean | null = null;
    for (const tunnel of tunnels) {
      const outcome = await this.pairing.probe(host.laneOrigin, tunnel, host.sessionCookie);
      if (outcome.kind === 'verdict') {
        reachable = outcome.reachable;
        ShellLog.info(`隧道地址探测：${tunnel} → ${outcome.reachable ? '可达' : '不可达'}（${outcome.detail}）`);
        break;
      }
    }
    if (reachable !== null) {
      const updated = host.clone();
      updated.tunnelReachable = reachable;
      await this.registry.upsert(updated);
    }
  }

  /** 由配对结果造出主机条目。 */
  private buildHost(link: PairLink, origin: string, candidates: string[], flow: PairFlowResult): HostEntry {
    const form = HostForm.of(origin);
    const label = link.displayName.length > 0 ? link.displayName : PairingService.defaultLabel(origin);
    return new HostEntry({
      id: origin,
      label: label,
      laneOrigin: origin,
      sessionCookie: flow.cookie,
      form: form,
      candidates: candidates.slice(),
      deviceId: flow.deviceId,
      // 一次性令牌在配对成功时已被消费，不再持久化——
      // 留在条目里会诱使降级链拿已用过的令牌去 accept，必然 403，把用户推回重新配对。
      pairToken: null,
      status: HostStatus.CONNECTED,
      statusReason: null,
      tunnelReachable: null,
      latencyMs: null,
      pairedAt: Date.now(),
    });
  }

  /** 默认显示名：地址里的主机名（`mutsu-mbp.local` / `192.168.3.90`）。 */
  private static defaultLabel(origin: string): string {
    const after = origin.substring(origin.indexOf('://') + 3);
    const slashAt = after.indexOf('/');
    const authority = slashAt < 0 ? after : after.substring(0, slashAt);
    const colonAt = authority.lastIndexOf(':');
    return colonAt > 0 ? authority.substring(0, colonAt) : authority;
  }
}
