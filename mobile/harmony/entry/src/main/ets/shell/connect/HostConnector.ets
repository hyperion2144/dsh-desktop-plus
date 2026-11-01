import { BootPayload } from '../boot/BootPayload';
import { BootPayloadError, BootPayloadProvider, HostGateError, HostUnreachableError } from '../boot/BootPayloadProvider';
import { HostEntry, HostStatus } from '../host/HostTypes';
import { HostRegistry } from '../host/HostRegistry';
import { LanePairingClient } from '../pair/LanePairingClient';
import { PairOutcome } from '../pair/PairOutcome';
import { ShellLog } from '../ShellLog';
import { ShellSettings } from '../ShellSettings';

/** 装载引导载荷的一次尝试结果。 */
class AttemptResult {
  /** loaded / gated / unreachable。 */
  kind: string = '';
  payload: BootPayload | null = null;
  detail: string = '';
}

/** 降级链的执行结果。 */
class RecoveryResult {
  /** recovered：静默续期成功；rejected：设备被移除 / 令牌确定失效；unreachable：网络问题，绝不是配对问题。 */
  kind: string = '';
  host: HostEntry | null = null;
  reason: string = '';
}

/** 连接结果的类别。 */
export type ConnectOutcomeKind = 'connected' | 'needs-repair' | 'offline';

/**
 * 连接结果。
 *
 * 用一个类 + 判别字段承载三种结果，连上时还带引导载荷。
 */
export class ConnectOutcome {
  kind: ConnectOutcomeKind = 'offline';
  host: HostEntry | null = null;
  payload: BootPayload | null = null;
  reason: string = '';
}

/**
 * 连接一台主机：候选地址重试 + **失效降级链**。
 *
 * ## 降级链（与桌面载体同款语义）
 *
 * 权威参照：`packages/plus/desktop-shell/src/profiles/electron.ts` 的配对恢复段。
 *
 * ```
 * 门禁 unpaired（HTTP 401 {"error":"unpaired"}）
 *   ├─ 有 deviceId → POST /api/pair/renew 静默续期（拿回新的会话 cookie）
 *   ├─ 仍拿不到且有链接内令牌 → POST /api/pair/accept（首次配对 / 令牌仍有效时自愈）
 *   └─ 全败 → 标记「需重新配对」+ 原因文案（区分「设备被移除」与「链接过期」）
 * ```
 *
 * 降级链**静默**：续期成功时用户什么都不用做，页面照常打开。
 */
export class HostConnector {
  private readonly registry: HostRegistry;
  private readonly payloadProvider: BootPayloadProvider;
  private readonly pairing: LanePairingClient;
  /** 页面 origin（回环服务的 origin）。 */
  private readonly pageOrigin: () => string;

  constructor(registry: HostRegistry, payloadProvider: BootPayloadProvider, pairing: LanePairingClient,
    pageOrigin: () => string) {
    this.registry = registry;
    this.payloadProvider = payloadProvider;
    this.pairing = pairing;
    this.pageOrigin = pageOrigin;
  }

  /**
   * 连接一台主机。
   *
   * 候选地址按「当前地址 → 地址候选列表」的顺序尝试；某个地址不可达就换下一个。
   */
  async connect(host: HostEntry): Promise<ConnectOutcome> {
    const candidates: string[] = [];
    const ordered = [host.laneOrigin].concat(host.candidates);
    for (const candidate of ordered) {
      const trimmed = candidate.trim().replace(/\/+$/, '');
      if (trimmed.length > 0 && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    }
    const outcome = new ConnectOutcome();
    if (candidates.length === 0) {
      const marked = host.clone();
      marked.status = HostStatus.OFFLINE;
      marked.statusReason = '没有可用地址';
      await this.registry.upsert(marked);
      outcome.kind = 'offline';
      outcome.host = marked;
      outcome.reason = '没有可用地址';
      return outcome;
    }

    let lastDetail = '无法连接主机';
    for (const origin of candidates) {
      const attempt = await this.attempt(host, origin);
      if (attempt.kind === 'loaded') {
        return this.connected(host, origin, attempt.payload);
      }
      if (attempt.kind === 'gated') {
        const recovery = await this.recover(host, origin);
        if (recovery.kind === 'recovered' && recovery.host !== null) {
          const retry = await this.attempt(recovery.host, origin);
          if (retry.kind === 'loaded') {
            return this.connected(recovery.host, origin, retry.payload);
          }
          lastDetail = retry.kind === 'gated' ? '主机仍要求重新配对' : retry.detail;
        } else if (recovery.kind === 'unreachable') {
          // 网络不通不是配对失效：换下一个候选地址，全败后按离线报告，
          // 绝不能把用户推回重新配对（参考桌面远程 profile 模式：凭证持久化 + 静默恢复）。
          lastDetail = recovery.reason;
        } else {
          // 服务端明确拒绝（设备被移除 / 令牌失效）：这才是「需重新配对」。
          const marked = host.clone();
          marked.status = HostStatus.NEEDS_REPAIR;
          marked.statusReason = recovery.reason;
          await this.registry.upsert(marked);
          ShellLog.warn(`主机 ${host.displayName()} 需重新配对：${recovery.reason}`);
          outcome.kind = 'needs-repair';
          outcome.host = marked;
          outcome.reason = recovery.reason;
          return outcome;
        }
        continue;
      }
      lastDetail = attempt.detail;
    }
    const marked = host.clone();
    marked.status = HostStatus.OFFLINE;
    marked.statusReason = lastDetail;
    await this.registry.upsert(marked);
    outcome.kind = 'offline';
    outcome.host = marked;
    outcome.reason = lastDetail;
    return outcome;
  }

  /** 装载引导载荷的三种结果。 */
  private async attempt(host: HostEntry, origin: string): Promise<AttemptResult> {
    ShellLog.info(`连接尝试：origin=${origin} 凭证=${host.sessionCookie ? '有' : '无'} 设备=${host.deviceId ?? '无'}`);
    const candidate = host.clone();
    candidate.laneOrigin = origin;
    const result = new AttemptResult();
    try {
      const socketBase = await this.socketBaseOf(candidate, origin);
      const payload = await this.payloadProvider.load(candidate, socketBase, this.pageOrigin());
      result.kind = 'loaded';
      result.payload = payload;
      return result;
    } catch (error) {
      if (error instanceof HostGateError) {
        result.kind = 'gated';
        return result;
      }
      result.kind = 'unreachable';
      if (error instanceof HostUnreachableError || error instanceof BootPayloadError) {
        result.detail = error.message;
        return result;
      }
      result.detail = '主机返回异常';
      return result;
    }
  }

  /**
   * 页面直连 lane 的 WS base：`ws(s)://<lane>/__dsh_ws/<令牌>/`。
   *
   * 末尾斜杠是硬要求：页面用 `new URL('api/remote.mux', base)` 相对解析，
   * 少了它 `__dsh_ws` 整段会被当成文件名吃掉（令牌也一同丢失）。
   *
   * 令牌签发结果必须分开处理：`gated`（会话失效）交给既有降级链（renew → accept →
   * 需重新配对）；只有地址/网络失败才是「换候选地址」。两者合并会把「会话过期」
   * 变成「主机离线」，用户被迫重新扫码。
   */
  private async socketBaseOf(host: HostEntry, origin: string): Promise<string> {
    const outcome = await this.pairing.wsToken(origin, host.sessionCookie);
    if (outcome.kind === 'gated') {
      throw new HostGateError('直连令牌被拒（会话失效）');
    }
    if (outcome.kind !== 'token') {
      throw new HostUnreachableError('主机未签发直连令牌');
    }
    const scheme = origin.replace(/^http/, 'ws').replace(/\/+$/, '');
    return `${scheme}${ShellSettings.LANE_WS_PREFIX}${outcome.token}/`;
  }

  /** 连上：更新主机条目并返回载荷。 */
  private async connected(host: HostEntry, origin: string, payload: BootPayload | null): Promise<ConnectOutcome> {
    const updated = host.clone();
    updated.laneOrigin = origin;
    updated.status = HostStatus.CONNECTED;
    updated.statusReason = null;
    await this.registry.upsert(updated);
    const outcome = new ConnectOutcome();
    outcome.kind = 'connected';
    outcome.host = updated;
    outcome.payload = payload;
    return outcome;
  }

  /**
   * 门禁拒绝后的降级链。
   *
   * 顺序与桌面载体一致：先静默续期（凭 deviceId），续期不成再试链接内令牌；
   * 两步都拿不到会话，才标记「需重新配对」，并区分原因。
   */
  private async recover(host: HostEntry, origin: string): Promise<RecoveryResult> {
    let deviceId = host.deviceId;
    let cookie: string | null = null;
    let removed = false;
    let expired = false;
    const result = new RecoveryResult();

    if (deviceId !== null && deviceId.length > 0) {
      const renewed = await this.pairing.renew(origin, deviceId);
      if (renewed.kind === 'renewed') {
        cookie = renewed.cookie;
        ShellLog.info(`降级链·静默续期成功：origin=${origin} 设备=${deviceId}`);
      } else if (renewed.kind === 'rejected') {
        removed = renewed.failure === 'device-removed';
        ShellLog.warn(`降级链·续期被拒：origin=${origin} 设备=${deviceId} 原因=${renewed.failure}`);
      } else {
        // 连不上 / 服务端异常：这是网络问题，不是配对问题。
        result.kind = 'unreachable';
        result.reason = '无法连接主机';
        return result;
      }
    }

    if (cookie === null && host.pairToken !== null && host.pairToken.length > 0) {
      const accepted = await this.pairing.accept(origin, host.pairToken, ShellSettings.DEVICE_NAME);
      if (accepted.kind === 'accepted') {
        cookie = accepted.cookie;
        deviceId = accepted.deviceId;
      } else if (accepted.kind === 'rejected') {
        expired = accepted.failure === 'invalid-token';
      } else {
        result.kind = 'unreachable';
        result.reason = '无法连接主机';
        return result;
      }
    }

    if (cookie !== null) {
      const renewed = host.clone();
      renewed.sessionCookie = cookie;
      renewed.deviceId = deviceId;
      renewed.status = HostStatus.CONNECTED;
      renewed.statusReason = null;
      await this.registry.upsert(renewed);
      ShellLog.info(`静默恢复会话成功：${host.displayName()}`);
      result.kind = 'recovered';
      result.host = renewed;
      return result;
    }

    // 走到这里说明服务端明确答了「不认识这台设备 / 这个令牌」：这才是需要用户重新配对的情形。
    result.kind = 'rejected';
    result.reason = '配对已失效，请重新配对';
    if (removed) {
      result.reason = '此设备已被桌面端移除，请重新配对';
    } else if (expired) {
      result.reason = '配对链接已过期，请重新扫码或复制桌面端的新链接';
    }
    return result;
  }
}
