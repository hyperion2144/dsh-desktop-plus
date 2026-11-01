import { Json, JsonNode } from '../util/Json';
import { HostForm, HostFormCode, HostStatus, HostStatusCode } from '../host/HostTypes';

/**
 * 主机条目在**非凭证**存储里的形状。
 *
 * 与运行期的 HostEntry 分开，是为了让「哪些字段会落盘、哪些字段是凭证」在类型上就一目了然：
 * cookie / deviceId / pairToken 三项是凭证，它们在资产存储里（见 AssetStore）；
 * 其余是展示与路由信息，落在 preferences 里。
 */
export class HostRecord {
  id: string = '';
  /** 显示名。 */
  label: string = '';
  /** 当前生效的 origin。 */
  origin: string = '';
  /** 形态代码（lan / mdns / tunnel / direct）。 */
  form: HostFormCode = HostForm.LAN;
  /** 地址候选列表（配对链接里的 base 列表）。 */
  candidates: string[] = [];
  /** 状态代码（unknown / connected / offline / needs-repair）。 */
  status: HostStatusCode = HostStatus.UNKNOWN;
  /** 状态原因文案（需重配时写清为什么）。 */
  statusReason: string = '';
  /** 隧道地址的可达性探测结论（空串 = 未探测 / 不适用）。 */
  tunnelReachable: string = '';
  /** 配对时间戳。 */
  pairedAt: number = 0;
}

/** 主机记录表的打包体（JSON 对象的唯一顶层形态）。 */
export class HostRecordBundle {
  records: HostRecord[] = [];
}

/**
 * 主机记录表的 JSON 编解码。
 *
 * 整表存一个键：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
 */
export class HostRecordCodec {
  /** 编码成 JSON 文本。 */
  static encode(records: HostRecord[]): string {
    const bundle = new HostRecordBundle();
    bundle.records = records;
    return JSON.stringify(bundle);
  }

  /** 解码 JSON 文本；损坏时返回空列表（不抛给调用方）。 */
  static decode(text: string): HostRecord[] {
    const records: HostRecord[] = [];
    if (text.length === 0) {
      return records;
    }
    const parsed: JsonNode | null = Json.parse(text);
    if (parsed === null) {
      return records;
    }
    const list = parsed.get('records');
    if (list === null) {
      return records;
    }
    for (let index = 0; index < list.size(); index++) {
      const item = list.item(index);
      if (item === null) {
        continue;
      }
      const id = item.stringField('id').trim();
      if (id.length === 0) {
        continue;
      }
      const record = new HostRecord();
      record.id = id;
      record.label = item.stringField('label');
      record.origin = item.stringField('origin');
      record.form = HostForm.fromCode(item.stringField('form'));
      record.status = HostStatus.fromCode(item.stringField('status'));
      record.statusReason = item.stringField('statusReason');
      record.tunnelReachable = item.stringField('tunnelReachable');
      record.pairedAt = item.numberField('pairedAt');
      const candidates = item.get('candidates');
      if (candidates !== null) {
        for (let position = 0; position < candidates.size(); position++) {
          const value = candidates.item(position);
          if (value !== null) {
            const text2 = value.asString().trim();
            if (text2.length > 0) {
              record.candidates.push(text2);
            }
          }
        }
      }
      records.push(record);
    }
    return records;
  }
}
