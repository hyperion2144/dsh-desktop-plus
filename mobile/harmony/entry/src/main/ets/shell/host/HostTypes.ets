/**
 * 主机模型：形态、状态与条目。
 *
 * 字段与 spec #55「多主机凭证模型」对齐：
 *  - `laneOrigin`：当前生效的地址（origin）；
 *  - `form`：地址形态（lan / mdns / tunnel / direct），决定徽标与候选排序；
 *  - `candidates`：地址候选列表（配对链接里的 base 列表），换网络时按序重试；
 *  - `deviceId`：设备 ID，降级链用它静默续期；
 *  - `sessionCookie`：lane 的会话 cookie（HttpOnly）——**只存在壳内**，由壳在转发请求时附加，
 *    永不下发给页面（spec #55「凭证与安全」第 17 条）；
 *  - `pairToken`：配对链接里的一次性令牌，只在首次配对与降级链兜底时用。
 */

/** 地址形态代码。 */
export type HostFormCode = 'lan' | 'mdns' | 'tunnel' | 'direct';

/** 主机状态代码。 */
export type HostStatusCode = 'unknown' | 'connected' | 'offline' | 'needs-repair';

/** 形态的判定与展示。 */
export class HostForm {
  static readonly LAN: HostFormCode = 'lan';
  static readonly MDNS: HostFormCode = 'mdns';
  static readonly TUNNEL: HostFormCode = 'tunnel';
  static readonly DIRECT: HostFormCode = 'direct';

  /** 由存储里的代码还原；不认识的一律按 LAN 处理。 */
  static fromCode(code: string): HostFormCode {
    if (code === HostForm.MDNS || code === HostForm.TUNNEL || code === HostForm.DIRECT) {
      return code;
    }
    return HostForm.LAN;
  }

  /** 形态的中文名（管理页的形态徽标用代码，副标题用中文）。 */
  static label(code: HostFormCode): string {
    if (code === HostForm.MDNS) {
      return 'mDNS';
    }
    if (code === HostForm.TUNNEL) {
      return '隧道';
    }
    if (code === HostForm.DIRECT) {
      return '直连';
    }
    return '局域网';
  }

  /**
   * 按地址猜形态：
   *  - `.local` 结尾 → mDNS；
   *  - 公网 https → 隧道；
   *  - `direct://` → 直连；
   *  - 其余 → 局域网。
   */
  static of(origin: string): HostFormCode {
    const text = origin.trim().toLowerCase();
    const host = HostForm.hostOf(text);
    if (host.endsWith('.local')) {
      return HostForm.MDNS;
    }
    if (text.startsWith('direct://')) {
      return HostForm.DIRECT;
    }
    if (text.startsWith('https://') && !HostForm.isPrivateHost(host)) {
      return HostForm.TUNNEL;
    }
    return HostForm.LAN;
  }

  /** 从 origin 里取出主机名部分。 */
  static hostOf(origin: string): string {
    let rest = origin;
    const schemeAt = rest.indexOf('://');
    if (schemeAt >= 0) {
      rest = rest.substring(schemeAt + 3);
    }
    const slashAt = rest.indexOf('/');
    if (slashAt >= 0) {
      rest = rest.substring(0, slashAt);
    }
    const bracketAt = rest.indexOf(']');
    if (bracketAt >= 0) {
      rest = rest.substring(0, bracketAt + 1);
    }
    const colonAt = rest.lastIndexOf(':');
    if (colonAt > 0) {
      rest = rest.substring(0, colonAt);
    }
    return rest;
  }

  /** RFC1918 / 回环：这些地址不可能是公网隧道。 */
  static isPrivateHost(host: string): boolean {
    if (host === 'localhost' || host === '::1') {
      return true;
    }
    const parts = host.split('.');
    if (parts.length !== 4) {
      return false;
    }
    const numbers: number[] = [];
    for (let index = 0; index < parts.length; index++) {
      const value = Number(parts[index]);
      if (isNaN(value)) {
        return false;
      }
      numbers.push(value);
    }
    if (numbers[0] === 10) {
      return true;
    }
    if (numbers[0] === 192 && numbers[1] === 168) {
      return true;
    }
    return numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31;
  }
}

/** 状态文案（管理页的状态点与原因文案）。 */
export class HostStatus {
  static readonly UNKNOWN: HostStatusCode = 'unknown';
  static readonly CONNECTED: HostStatusCode = 'connected';
  static readonly OFFLINE: HostStatusCode = 'offline';
  static readonly NEEDS_REPAIR: HostStatusCode = 'needs-repair';

  /** 由存储里的代码还原；不认识的一律按 UNKNOWN 处理。 */
  static fromCode(code: string): HostStatusCode {
    if (code === HostStatus.CONNECTED || code === HostStatus.OFFLINE || code === HostStatus.NEEDS_REPAIR) {
      return code;
    }
    return HostStatus.UNKNOWN;
  }
}

/** 主机条目的构造参数。 */
export interface HostEntryInit {
  id: string;
  label: string;
  laneOrigin: string;
  sessionCookie: string | null;
  form: HostFormCode;
  candidates: string[];
  deviceId: string | null;
  pairToken: string | null;
  status: HostStatusCode;
  statusReason: string | null;
  tunnelReachable: boolean | null;
  latencyMs: number | null;
  pairedAt: number;
}

/** 一台桌面主机。 */
export class HostEntry {
  id: string;
  label: string;
  laneOrigin: string;
  sessionCookie: string | null;
  form: HostFormCode;
  candidates: string[];
  deviceId: string | null;
  pairToken: string | null;
  status: HostStatusCode;
  statusReason: string | null;
  tunnelReachable: boolean | null;
  latencyMs: number | null;
  pairedAt: number;

  constructor(init: HostEntryInit) {
    this.id = init.id;
    this.label = init.label;
    this.laneOrigin = init.laneOrigin;
    this.sessionCookie = init.sessionCookie;
    this.form = init.form;
    this.candidates = init.candidates;
    this.deviceId = init.deviceId;
    this.pairToken = init.pairToken;
    this.status = init.status;
    this.statusReason = init.statusReason;
    this.tunnelReachable = init.tunnelReachable;
    this.latencyMs = init.latencyMs;
    this.pairedAt = init.pairedAt;
  }

  /** 供页面与日志使用的展示名（无标签时退回 origin）。 */
  displayName(): string {
    return this.label.length === 0 ? this.laneOrigin : this.label;
  }

  /** 展示用地址（去掉协议头，与原型一致）。 */
  displayOrigin(): string {
    let text = this.laneOrigin;
    if (text.startsWith('http://')) {
      text = text.substring(7);
    } else if (text.startsWith('https://')) {
      text = text.substring(8);
    }
    return text.endsWith('/') ? text.substring(0, text.length - 1) : text;
  }

  /** 复制一份（ArkTS 没有数据类，变更走显式克隆）。 */
  clone(): HostEntry {
    return new HostEntry({
      id: this.id,
      label: this.label,
      laneOrigin: this.laneOrigin,
      sessionCookie: this.sessionCookie,
      form: this.form,
      candidates: this.candidates.slice(),
      deviceId: this.deviceId,
      pairToken: this.pairToken,
      status: this.status,
      statusReason: this.statusReason,
      tunnelReachable: this.tunnelReachable,
      latencyMs: this.latencyMs,
      pairedAt: this.pairedAt,
    });
  }
}
