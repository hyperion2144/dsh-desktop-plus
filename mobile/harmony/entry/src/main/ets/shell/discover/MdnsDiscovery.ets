import { mdns } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { ShellLog } from '../ShellLog';

/**
 * 局域网发现（mDNS）。
 *
 * 桌面端的 lane 广播 `_dsh-lane._tcp` 服务记录（广播内容**不含任何授权令牌**，
 * 只回答「桌面在哪儿、端口多少」——见 packages/plus/desktop-remote-access/lib/mdns.mjs）。
 * 壳用系统 mDNS 发现这些记录，列出可配对的桌面。
 *
 * **发现不等于授权**：列表里的条目仍然要靠桌面签发的一次性配对链接才能连上。
 */
export class DiscoveredHost {
  /** 广播里的实例名（如 `DSH Desktop Plus - mutsu-mbp`）。 */
  serviceName: string = '';
  /** 解析出的主机地址。 */
  address: string = '';
  /** 解析出的端口。 */
  port: number = 0;

  /** 展示名：实例名去掉前缀。 */
  displayName(): string {
    const marker = 'DSH Desktop Plus - ';
    if (this.serviceName.startsWith(marker)) {
      return this.serviceName.substring(marker.length);
    }
    return this.serviceName;
  }

  /** 候选地址（origin 形态）。 */
  origin(): string {
    return `http://${this.address}:${this.port}`;
  }
}

/**
 * mDNS 发现服务。
 *
 * 生命周期跟着配对屏走：进配对屏时开始发现，离开时停掉。
 */
export class MdnsDiscovery {
  private readonly context: common.Context;
  private discovery: mdns.DiscoveryService | null = null;

  constructor(context: common.Context) {
    this.context = context;
  }

  /**
   * 开始发现。
   *
   * @param onFound 发现到一台桌面时回调（同一台可能被发现多次，调用方自己去重）。
   */
  start(onFound: (host: DiscoveredHost) => void): void {
    this.stop();
    try {
      const discovery = mdns.createDiscoveryService(this.context, MdnsDiscovery.SERVICE_TYPE);
      discovery.on('serviceFound', (info: mdns.LocalServiceInfo) => {
        this.resolve(info, onFound);
      });
      this.discovery = discovery;
      ShellLog.info(`mDNS 发现已启动：${MdnsDiscovery.SERVICE_TYPE}`);
    } catch (error) {
      ShellLog.warn('mDNS 发现启动失败（设备可能不支持或未授权）');
    }
  }

  /** 停止发现。 */
  stop(): void {
    if (this.discovery !== null) {
      try {
        this.discovery.off('serviceFound');
      } catch (error) {
        // 停止失败不影响后续流程。
      }
      this.discovery = null;
    }
  }

  /** 解析一条广播记录（拿到真实地址与端口）。 */
  private resolve(info: mdns.LocalServiceInfo, onFound: (host: DiscoveredHost) => void): void {
    mdns.resolveLocalService(this.context, info).then((resolved: mdns.LocalServiceInfo) => {
      const host = new DiscoveredHost();
      host.serviceName = resolved.serviceName.length > 0 ? resolved.serviceName : info.serviceName;
      const address = resolved.host;
      if (address !== undefined && address !== null) {
        host.address = address.address;
        host.port = address.port ?? 0;
      }
      if (host.address.length === 0 || host.port === 0) {
        return;
      }
      ShellLog.info(`mDNS 发现桌面：${host.displayName()}（${host.origin()}）`);
      onFound(host);
    }).catch((error: Error) => {
      ShellLog.warn(`mDNS 解析失败：${error.message}`);
    });
  }

  /**
   * lane 广播的服务类型。
   *
   * 桌面端广播 `_dsh-lane._tcp.local`（见 mdns.mjs 的 LANE_MDNS_SERVICE），
   * 平台侧的服务类型不带 `.local` 后缀。
   */
  private static readonly SERVICE_TYPE: string = '_dsh-lane._tcp';
}
