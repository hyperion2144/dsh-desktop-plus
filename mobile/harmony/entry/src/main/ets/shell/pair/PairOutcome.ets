import { PairFailureCode } from './PairFailure';

/** 配对类请求的结果类别。 */
export type PairOutcomeKind = 'accepted' | 'renewed' | 'rejected' | 'unreachable' | 'verdict';

/**
 * 配对类请求的结果。
 *
 * 用一个类 + 判别字段承载四种结果（成功 / 被拒 / 不可达 / 探测结论），
 * 免去联合类型在 ArkTS 里的限制。
 *
 * 这一层是纯数据（不碰平台 API），因此能在 node 下单独验证（见 tools/parity-check.mjs）。
 */
export class PairOutcome {
  kind: PairOutcomeKind = 'rejected';
  /** 成功时的设备 ID。 */
  deviceId: string = '';
  /** 成功时的会话 cookie（整对 `名字=值`）。 */
  cookie: string = '';
  /** 被拒时的原因分类。 */
  failure: PairFailureCode = 'unexpected';
  /** 不可达时的细节文案。 */
  detail: string = '';
  /** 探测结论：可达与否。 */
  reachable: boolean = false;
}
