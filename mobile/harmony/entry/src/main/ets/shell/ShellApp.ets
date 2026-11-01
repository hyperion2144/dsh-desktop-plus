import { common } from '@kit.AbilityKit';
import { AssetStore } from './store/AssetStore';
import { PrefsStore } from './store/PrefsStore';
import { KeyValueStore } from './store/KeyValueStore';
import { HostRegistry } from './host/HostRegistry';
import { ShellPreferences } from './store/ShellPreferences';
import { BootPayloadProvider } from './boot/BootPayloadProvider';
import { BootPayloadStore } from './boot/BootPayloadStore';
import { HostConnector } from './connect/HostConnector';
import { HostProbe } from './connect/HostProbe';
import { LaneHttpClient } from './net/LaneHttpClient';
import { LanePairingClient } from './pair/LanePairingClient';
import { LockController } from './lock/LockController';
import { PairingService } from './pair/PairingService';
import { PageServer } from './page/PageServer';
import { UpdateNotice, UpdateNoticeService } from './update/UpdateNoticeService';
import { ThemeController } from './theme/ThemeController';
import { UserAuthGate } from './lock/UserAuthGate';
import { ShellLog } from './ShellLog';
import { ShellSettings } from './ShellSettings';

/**
 * 壳的装配点：进程级单例都在这里建。
 *
 * 依赖方向是单向的：
 * `store`（资产存储 / 偏好） → `host`（主机仓库） → `pair` / `connect`（配对与连接） → `page` / `bridge` → `ui`。
 * `theme`（外观）挂在 `store` 上：偏好存选择，应用上下文落色彩模式。
 * 界面之间不直接互相调用：管理页改「当前主机」，主界面回前台时自己发现并切代理目标。
 */
export class ShellApp {
  private static instance: ShellApp | null = null;

  /** 主机仓库（元数据在偏好，凭证在资产存储）。 */
  readonly registry: HostRegistry;

  /** 非凭证偏好（生物锁开关、更新提醒开关）。 */
  readonly preferences: ShellPreferences;

  /** 配对服务（链接 → 凭证 → 主机条目）。 */
  readonly pairing: PairingService;

  /** 生物锁状态机。 */
  readonly lock: LockController;

  /** 生物识别的门（userAuth）。 */
  readonly userAuth: UserAuthGate;

  /** 主机探测（往返延迟）。 */
  readonly probe: HostProbe;

  /** 当前生效的引导载荷。 */
  readonly payloadStore: BootPayloadStore;

  /** 壳内的回环页面服务（页面 origin = 它）。 */
  readonly pageServer: PageServer;

  /** 连接器（候选地址重试 + 失效降级链）。 */
  readonly connector: HostConnector;

  /** 更新提醒（仅跳转形态）。 */
  readonly update: UpdateNoticeService;
  /** 外观（跟随系统 / 浅色 / 深色）。 */
  readonly theme: ThemeController;

  /** 等待过生物锁后执行的移除意图（管理页设置，验证回来后消费）。 */
  pendingHostRemoval: string | null = null;
  /** 壳侧的 HTTP 客户端（页面原生请求桥与转发共用）。 */
  readonly client: LaneHttpClient;

  private constructor(meta: KeyValueStore, secrets: KeyValueStore, context: common.Context) {
    this.registry = new HostRegistry(meta, secrets);
    this.preferences = new ShellPreferences(meta);
    this.client = new LaneHttpClient();
    this.payloadStore = new BootPayloadStore();
    const payloadProvider = new BootPayloadProvider(this.client);
    const pairingClient = new LanePairingClient(this.client);
    this.pageServer = new PageServer(context.resourceManager, this.payloadStore,
      () => this.registry.current(), this.client);
    this.pairing = new PairingService(this.registry, pairingClient);
    this.connector = new HostConnector(this.registry, payloadProvider, pairingClient,
      () => this.pageServer.origin());
    this.lock = new LockController(this.preferences);
    this.probe = new HostProbe(this.client);
    this.userAuth = new UserAuthGate(context);
    this.update = new UpdateNoticeService(this.client, this.preferences);
    this.theme = new ThemeController(this.preferences, context);
  }

  /**
   * 初始化进程级单例（幂等）。
   *
   * @param context Ability 上下文（preferences 与资源管理器需要它）。
   */
  static async initialize(context: common.Context): Promise<ShellApp> {
    const existing = ShellApp.instance;
    if (existing !== null) {
      return existing;
    }
    const meta = await PrefsStore.open(context);
    const secrets = await AssetStore.open();
    const app = new ShellApp(meta, secrets, context);
    // 外观先落地再装载页面：冷启动不闪一下错主题。
    await app.theme.apply();
    await app.registry.load();
    await app.lock.load();
    try {
      await app.pageServer.start();
    } catch (error) {
      ShellLog.error('壳内页面服务启动失败：页面将无法加载');
    }
    ShellApp.instance = app;
    ShellLog.info(`壳已启动：主机 ${app.registry.list().length} 台，当前 ${app.registry.currentLabel()}`);
    // 更新检查：静默降级，不阻塞启动（拉不到更新源时只记一条日志）。
    app.checkUpdate().catch(() => {
      ShellLog.warn('启动时检查更新失败');
    });
    return app;
  }

  /**
   * 检查更新（仅跳转形态）。
   *
   * 静默降级：拉不到更新源、版本号不合法时返回 null，不打扰用户。
   */
  async checkUpdate(): Promise<UpdateNotice | null> {
    try {
      return await this.update.check(ShellSettings.CURRENT_VERSION);
    } catch (error) {
      ShellLog.warn('检查更新失败');
      return null;
    }
  }


  /** 取当前实例；未初始化时抛错（调用方都在 initialize 之后）。 */
  static get(): ShellApp {
    const instance = ShellApp.instance;
    if (instance === null) {
      throw new Error('壳尚未初始化');
    }
    return instance;
  }

  /** 进程退出时的清理。 */
  static shutdown(): void {
    const instance = ShellApp.instance;
    if (instance !== null) {
      instance.pageServer.stop().catch(() => {
        // 已停止。
      });
    }
    ShellApp.instance = null;
  }
}
