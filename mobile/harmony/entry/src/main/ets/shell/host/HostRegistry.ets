import { KeyValueStore } from '../store/KeyValueStore';
import { HostRecord, HostRecordCodec } from '../store/HostRecord';
import { HostEntry, HostFormCode, HostStatus, HostStatusCode } from './HostTypes';
import { ShellLog } from '../ShellLog';

/** 主机表在元数据存储里的键。 */
const KEY_HOSTS: string = 'hosts.entries';

/** 当前主机 id 在元数据存储里的键。 */
const KEY_CURRENT: string = 'hosts.current';

/**
 * 主机仓库：元数据与凭证分两处落盘。
 *
 * ## 为什么是这一层
 *
 * 主机条目里有**凭证**（会话 cookie、deviceId、配对令牌）。它们必须满足两条：
 *  1. **不落明文**：落在鸿蒙资产存储里（见 store/AssetStore）；
 *  2. **不到页面**：页面拿不到 cookie，只能通过壳桥拿到主机名与 origin（见 bridge/MobileBridge）。
 *
 * 展示与路由元数据（id / 名字 / 地址 / 形态 / 候选 / 状态）不敏感，落在 preferences 里，
 * 这样「哪些是秘密」在存储结构上就分得开。
 *
 * 整表用一个键存：一次写入 = 一次原子替换，不会出现「写了一半的列表」。
 */
export class HostRegistry {
  private readonly meta: KeyValueStore;
  private readonly secrets: KeyValueStore;
  private readonly hosts: Map<string, HostEntry> = new Map<string, HostEntry>();
  private readonly order: string[] = [];
  private currentId: string = '';

  constructor(meta: KeyValueStore, secrets: KeyValueStore) {
    this.meta = meta;
    this.secrets = secrets;
  }

  /** 从存储恢复（进程重启后主机列表与凭证仍在）。 */
  async load(): Promise<void> {
    const records = HostRecordCodec.decode(await this.meta.getString(KEY_HOSTS) ?? '');
    for (const record of records) {
      const entry = await this.toEntry(record);
      this.hosts.set(entry.id, entry);
      this.order.push(entry.id);
    }
    // 一次性令牌只在配对那一次有效：老版本曾把它持久化，恢复时统一清掉，
    // 避免降级链拿已消费的令牌去 accept 而被推回重新配对。
    for (const entry of this.hosts.values()) {
      if (entry.pairToken !== null) {
        entry.pairToken = null;
        await this.secrets.putString(this.secretAlias(entry.id, 'pairToken'), null);
      }
    }
    const stored = await this.meta.getString(KEY_CURRENT);
    this.currentId = stored !== null && this.hosts.has(stored) ? stored : (this.order.length > 0 ? this.order[0] : '');
    ShellLog.info(`主机仓库已恢复：${this.order.length} 台，当前 ${this.currentLabel()}`);
  }

  /** 全部已配置主机（按加入顺序）。 */
  list(): HostEntry[] {
    const result: HostEntry[] = [];
    for (const id of this.order) {
      const host = this.hosts.get(id);
      if (host !== undefined) {
        result.push(host);
      }
    }
    return result;
  }

  /** 当前主机；未显式指定时取列表第一台。 */
  current(): HostEntry | null {
    const host = this.hosts.get(this.currentId);
    return host !== undefined ? host : null;
  }

  /** 当前主机的展示名（没有主机时返回空串）。 */
  currentLabel(): string {
    const host = this.current();
    return host === null ? '' : host.displayName();
  }

  /** 按 id 取主机。 */
  find(id: string): HostEntry | null {
    const host = this.hosts.get(id);
    return host !== undefined ? host : null;
  }

  /** 设定当前主机。 */
  async setCurrent(id: string): Promise<void> {
    if (!this.hosts.has(id)) {
      return;
    }
    this.currentId = id;
    await this.meta.putString(KEY_CURRENT, id);
  }

  /** 加入或更新一台主机（同 id 覆盖）。 */
  async upsert(host: HostEntry): Promise<void> {
    if (!this.hosts.has(host.id)) {
      this.order.push(host.id);
    }
    this.hosts.set(host.id, host);
    if (this.currentId.length === 0) {
      this.currentId = host.id;
    }
    await this.persistHost(host);
    await this.persistTable();
  }

  /** 移除一台主机（凭证一并删除）。 */
  async remove(id: string): Promise<void> {
    this.hosts.delete(id);
    const at = this.order.indexOf(id);
    if (at >= 0) {
      this.order.splice(at, 1);
    }
    if (this.currentId === id) {
      this.currentId = this.order.length > 0 ? this.order[0] : '';
    }
    await this.secrets.putString(this.secretAlias(id, 'cookie'), null);
    await this.secrets.putString(this.secretAlias(id, 'deviceId'), null);
    await this.secrets.putString(this.secretAlias(id, 'pairToken'), null);
    await this.meta.putString(KEY_CURRENT, this.currentId);
    await this.persistTable();
  }

  /** 更新状态与原因文案（已连接 / 离线 / 需重新配对）。 */
  async markStatus(id: string, status: HostStatusCode, reason: string | null): Promise<void> {
    const host = this.hosts.get(id);
    if (host === undefined) {
      return;
    }
    const updated = host.clone();
    updated.status = status;
    updated.statusReason = reason;
    this.hosts.set(id, updated);
    await this.persistHost(updated);
    await this.persistTable();
  }

  /** 记录最近一次探测到的往返延迟（毫秒）。 */
  async markLatency(id: string, latencyMs: number | null): Promise<void> {
    const host = this.hosts.get(id);
    if (host === undefined) {
      return;
    }
    const updated = host.clone();
    updated.latencyMs = latencyMs;
    this.hosts.set(id, updated);
    // 延迟是纯运行时信息，不落盘。
  }

  /** 把一条主机记录写进两处存储（元数据 + 凭证）。 */
  private async persistHost(host: HostEntry): Promise<void> {
    const record = new HostRecord();
    record.id = host.id;
    record.label = host.label;
    record.origin = host.laneOrigin;
    record.form = host.form;
    record.candidates = host.candidates.slice();
    record.status = host.status;
    record.statusReason = host.statusReason ?? '';
    record.tunnelReachable = host.tunnelReachable === null ? '' : (host.tunnelReachable ? 'true' : 'false');
    record.pairedAt = host.pairedAt;
    await this.meta.putString(this.recordKey(host.id), JSON.stringify(record));
    await this.secrets.putString(this.secretAlias(host.id, 'cookie'), host.sessionCookie);
    await this.secrets.putString(this.secretAlias(host.id, 'deviceId'), host.deviceId);
    await this.secrets.putString(this.secretAlias(host.id, 'pairToken'), host.pairToken);
  }

  /** 把整张表写进元数据存储（一次原子替换）。 */
  private async persistTable(): Promise<void> {
    const records: HostRecord[] = [];
    for (const id of this.order) {
      const host = this.hosts.get(id);
      if (host === undefined) {
        continue;
      }
      const record = new HostRecord();
      record.id = host.id;
      record.label = host.label;
      record.origin = host.laneOrigin;
      record.form = host.form;
      record.candidates = host.candidates.slice();
      record.status = host.status;
      record.statusReason = host.statusReason ?? '';
      record.tunnelReachable = host.tunnelReachable === null ? '' : (host.tunnelReachable ? 'true' : 'false');
      record.pairedAt = host.pairedAt;
      records.push(record);
    }
    await this.meta.putString(KEY_HOSTS, HostRecordCodec.encode(records));
    await this.meta.putString(KEY_CURRENT, this.currentId);
  }

  /** 由元数据记录 + 资产存储里的凭证还原一条主机条目。 */
  private async toEntry(record: HostRecord): Promise<HostEntry> {
    const cookie = await this.secrets.getString(this.secretAlias(record.id, 'cookie'));
    const deviceId = await this.secrets.getString(this.secretAlias(record.id, 'deviceId'));
    const pairToken = await this.secrets.getString(this.secretAlias(record.id, 'pairToken'));
    let reachable: boolean | null = null;
    if (record.tunnelReachable.length > 0) {
      reachable = record.tunnelReachable === 'true';
    }
    return new HostEntry({
      id: record.id,
      label: record.label,
      laneOrigin: record.origin,
      sessionCookie: cookie,
      form: record.form,
      candidates: record.candidates.slice(),
      deviceId: deviceId,
      pairToken: pairToken,
      status: record.status,
      statusReason: record.statusReason.length === 0 ? null : record.statusReason,
      tunnelReachable: reachable,
      latencyMs: null,
      pairedAt: record.pairedAt,
    });
  }

  /** 资产存储里的条目别名。 */
  private secretAlias(id: string, field: string): string {
    return `dsh.host.${HostRegistry.sanitize(id)}.${field}`;
  }

  /** 元数据存储里的单条主机键。 */
  private recordKey(id: string): string {
    return `dsh.host.${HostRegistry.sanitize(id)}.record`;
  }

  /** 把主机 id 里的非字母数字字符换成下划线（资产存储别名要稳定可读）。 */
  static sanitize(id: string): string {
    let result = '';
    for (let index = 0; index < id.length; index++) {
      const code = id.charCodeAt(index);
      const isDigit = code >= 48 && code <= 57;
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;
      result += (isDigit || isUpper || isLower) ? id.charAt(index) : '_';
    }
    return result;
  }

}
