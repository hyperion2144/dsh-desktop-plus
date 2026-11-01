import { PairFailureCode } from './PairFailure';
import { PairOutcome } from './PairOutcome';
import { ReachabilityProber } from '../connect/ReachabilityProbe';

/**
 * 接受配对的端口（真实实现是 LanePairingClient；对拍里换成假实现）。
 */
export interface PairAcceptor {
  accept(origin: string, token: string, deviceName: string): Promise<PairOutcome>;
}

/**
 * 配对流程的结果。
 */
export class PairFlowResult {
  /** 是否配对成功。 */
  paired: boolean = false;
  /** 成功时生效的地址。 */
  origin: string = '';
  /** 成功时的设备 ID。 */
  deviceId: string = '';
  /** 成功时的会话 cookie。 */
  cookie: string = '';
  /** 失败时的分类。 */
  failure: PairFailureCode = 'unexpected';
  /** 预检没通过的候选（壳据此写日志：这些地址一个字节都没收到）。 */
  unreachable: string[] = [];
}

/**
 * 配对流程（纯编排，不碰平台 API）。
 *
 * ## 顺序
 *
 * 1. **先探测**：对每个候选地址做一次**无凭证**的可达性预检（只连 TCP）。
 *    通不过的候选直接剔除——**一次性令牌绝不发给连不上的目标**
 *    （契约：配对前探测，不把凭证发给不可达目标）。
 * 2. **再 accept**：对剩下的候选依次换设备 ID + 会话 cookie；
 *    令牌无效（过期 / 已用过）就不再重试——同一台桌面的多个地址共用同一个令牌。
 *
 * 这一层是纯逻辑，因此能在 node 下单独验证（见 tools/parity-check.mjs）。
 */
export async function runPairing(
  candidates: string[],
  token: string,
  acceptor: PairAcceptor,
  prober: ReachabilityProber,
  deviceName: string,
): Promise<PairFlowResult> {
  const result = new PairFlowResult();
  const reachable: string[] = [];
  for (const candidate of candidates) {
    if (await prober.reachable(candidate)) {
      reachable.push(candidate);
    } else {
      result.unreachable.push(candidate);
    }
  }
  if (reachable.length === 0) {
    result.failure = 'unreachable';
    return result;
  }
  for (const origin of reachable) {
    const outcome = await acceptor.accept(origin, token, deviceName);
    if (outcome.kind === 'accepted') {
      result.paired = true;
      result.origin = origin;
      result.deviceId = outcome.deviceId;
      result.cookie = outcome.cookie;
      return result;
    }
    if (outcome.kind === 'rejected') {
      result.failure = outcome.failure;
      if (outcome.failure === 'invalid-token') {
        return result;
      }
    } else {
      result.failure = 'unreachable';
    }
  }
  return result;
}
