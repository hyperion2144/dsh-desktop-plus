import { webview } from '@kit.ArkWeb';
import { router, promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { ShellApp } from '../shell/ShellApp';
import { HostEntry, HostForm, HostStatus } from '../shell/host/HostTypes';
import { HostVisuals } from '../shell/ui/HostVisuals';
import { MobileBridge, MobileBridgeHost } from '../shell/bridge/MobileBridge';
import { NativeRequestBridge } from '../shell/bridge/NativeRequestBridge';
import { ShellSettings } from '../shell/ShellSettings';
import { Json } from '../shell/util/Json';
import { ShellLog } from '../shell/ShellLog';
import { UpdateNotice } from '../shell/update/UpdateNoticeService';

/** 主机列表里的一行（页面侧的展示模型）。 */
class HostRow {
  id: string = '';
  label: string = '';
  origin: string = '';
  form: string = '';
  formColor: ResourceColor = $r('app.color.dsh_state_success');
  statusColor: ResourceColor = $r('app.color.dsh_label_caption');
  status: string = '';
  detail: string = '';
  current: boolean = false;
}

/**
 * 主界面：顶栏（状态 + 主机入口）+ ArkWeb 页面 + 浮层切换器。
 *
 * ## 页面载体
 *
 * 页面从**壳内的回环服务**加载（`http://127.0.0.1:<临时端口>`），
 * 那是壳内自带的移动变体 dist；数据面（api / plugins / assets）由壳转发到当前主机 lane。
 * 凭证只存在壳内，页面 JS 永远拿不到。
 *
 * ## 浮层切换器（原型定稿变体 A）
 *
 * 入口在右下角（拇指区），点击弹底部抽屉；切换 = 壳改代理目标 + 页面重载。
 */
@Entry
@Component
struct Index {
  @State statusText: string = '';
  @State statusColor: ResourceColor = $r('app.color.dsh_label_caption');
  @State drawerOpen: boolean = false;
  @State hostRows: HostRow[] = [];
  @State pageUrl: string = '';
  @State pageLoaded: boolean = false;
  @State pageArmed: boolean = false;

  /** 更新提醒（仅跳转形态）。 */
  @State updateNotice: UpdateNotice | null = null;
  private controller: webview.WebviewController = new webview.WebviewController();
  private shell: ShellApp = ShellApp.get();

  /** 当前已装载页面所属的主机 id（回前台判断「主机未变」用）。 */
  private loadedHostId: string = '';
  private nativeBridge: NativeRequestBridge = new NativeRequestBridge(
    () => this.shell.registry.current(),
    () => this.shell.pageServer.origin(),
    ShellApp.get().client);
  private mobileBridge: MobileBridge = new MobileBridge(this as MobileBridgeHost);


  /** 取字符串资源的真实值：$r() 返回 Resource 对象，直接 .toString() 是 [object Object]。 */
  private str(res: Resource): string {
    return getContext(this).resourceManager.getStringSync(res);
  }
  aboutToAppear(): void {
    this.pageUrl = `${this.shell.pageServer.origin()}/index.html`;
    this.refreshHosts();
    this.syncCurrentHost();
    this.checkUpdate();
  }

  /** 页面重新可见：生物锁优先；页面已装载且主机未变时不做任何重连/重载。 */
  onPageShow(): void {
    const reason = this.shell.lock.needsUnlock();
    if (reason !== null) {
      router.pushUrl({ url: 'pages/Lock', params: { reason: reason } });
      return;
    }
    this.refreshHosts();
    this.checkUpdate();
    // 回前台由页面官方 generation 机制自愈；重新 connect + loadUrl 会把整个
    // DSH 界面刷掉（真机反馈），只有「还没装载」或「主机变了」才值得重来。
    const host = this.shell.registry.current();
    if (this.pageLoaded && host !== null && host.id === this.loadedHostId) {
      return;
    }
    this.syncCurrentHost();
  }

  onPageHide(): void {
    this.shell.lock.onBackground();
  }

  // ── 壳桥（window.dshMobile） ────────────────────────────────────────────

  hostsJson(): string {
    const rows: string[] = [];
    for (const host of this.shell.registry.list()) {
      rows.push(`{"id":${Json.quote(host.id)},"label":${Json.quote(host.displayName())},` +
        `"origin":${Json.quote(host.laneOrigin)},` +
        `"current":${host.id === this.shell.registry.current()?.id ? 'true' : 'false'}}`);
    }
    return `[${rows.join(',')}]`;
  }

  currentJson(): string {
    const host = this.shell.registry.current();
    if (host === null) {
      return '{}';
    }
    return `{"id":${Json.quote(host.id)},"label":${Json.quote(host.displayName())},` +
      `"origin":${Json.quote(host.laneOrigin)}}`;
  }

  switchHost(id: string): boolean {
    const host = this.shell.registry.find(id);
    if (host === null) {
      return false;
    }
    this.applyHost(host);
    return true;
  }

  // ── 主机与状态 ─────────────────────────────────────────────────────────

  /** 刷新主机列表（浮层切换器用）。 */
  refreshHosts(): void {
    const rows: HostRow[] = [];
    const currentId = this.shell.registry.current()?.id;
    for (const host of this.shell.registry.list()) {
      const row = new HostRow();
      row.id = host.id;
      row.label = host.displayName();
      row.origin = host.displayOrigin();
      row.form = host.form;
      row.formColor = HostVisuals.formColor(host.form);
      row.statusColor = HostVisuals.statusColor(host.status);
      row.status = Index.stateLabel(host.status);
      row.detail = Index.detailLine(host);
      row.current = host.id === currentId;
      rows.push(row);
    }
    this.hostRows = rows;
  }

  /** 连接当前主机并装载页面。 */
  syncCurrentHost(): void {
    const host = this.shell.registry.current();
    if (host === null) {
      this.statusText = this.str($r('app.string.status_no_host'));
      this.statusColor = $r('app.color.dsh_label_caption');
      return;
    }
    this.applyHost(host);
  }

  /** 应用一台主机：连接（含降级链）→ 取引导载荷 → 装载页面。 */
  applyHost(host: HostEntry): void {
    this.shell.registry.setCurrent(host.id);
    this.statusText = this.str($r('app.string.status_connecting')).replace('%1$s', host.displayName());
    this.statusColor = $r('app.color.dsh_label_caption');
    this.shell.connector.connect(host).then((outcome) => {
      if (outcome.kind === 'connected') {
        if (outcome.payload !== null) {
          this.shell.payloadStore.set(outcome.payload);
        }
        this.statusText = this.str($r('app.string.status_connected')).replace('%1$s', host.displayName());
        this.statusColor = $r('app.color.dsh_state_success');
        this.pageLoaded = false;
        this.pageArmed = true;
        this.controller.loadUrl(this.pageUrl);
        this.loadedHostId = host.id;
        this.refreshHosts();
        return;
      }
      if (outcome.kind === 'needs-repair') {
        this.statusText = this.str($r('app.string.status_needs_repair')).replace('%1$s', host.displayName());
        this.statusColor = $r('app.color.dsh_state_error');
        this.pageArmed = false;
        promptAction.showToast({ message: outcome.reason });
        this.refreshHosts();
        return;
      }
      this.statusText = this.str($r('app.string.status_failed')).replace('%1$s', host.displayName());
      this.statusColor = $r('app.color.dsh_label_tertiary');
        this.pageArmed = false;
      this.refreshHosts();
    });
  }

  // ── 更新提醒 ───────────────────────────────────────────────────────────

  /**
   * 检查更新（仅跳转形态）。
   *
   * 静默降级：拉不到更新源、版本号不合法时不提醒（更新检查不阻塞任何界面）。
   */
  checkUpdate(): void {
    this.shell.checkUpdate().then((notice: UpdateNotice | null) => {
      if (notice === null) {
        // 没有新版本：保留已经在显示的提醒（回前台时不该把卡片收掉）。
        return;
      }
      this.updateNotice = notice;
      // 提醒真的显示出来了，才记「已提醒」（后台那次检查不该把提醒吃掉）。
      this.shell.update.markNotified(notice.version);
    }).catch(() => {
      // 静默降级：拉不到更新源时什么都不做。
    });
  }

  /** 打开下载页（鸿蒙没有系统安装器：引导用户去应用市场测试渠道）。 */
  openUpdatePage(): void {
    const notice: UpdateNotice | null = this.updateNotice;
    if (notice === null) {
      return;
    }
    const context = getContext(this) as common.UIAbilityContext;
    context.startAbility({
      action: 'action.system.browsable',
      uri: notice.url,
    }).catch(() => {
      promptAction.showToast({ message: this.str($r('app.string.update_open_failed')) });
    });
  }

  /** 「不再提示此版本」：拉黑该版本并收起卡片。 */
  ignoreUpdateVersion(): void {
    const notice: UpdateNotice | null = this.updateNotice;
    if (notice === null) {
      return;
    }
    this.shell.update.ignore(notice.version).then(() => {
      this.updateNotice = null;
    }).catch(() => {
      this.updateNotice = null;
    });
  }

  /** 更新提醒正文（带版本号）。 */
  private updateBody(): string {
    const notice: UpdateNotice | null = this.updateNotice;
    if (notice === null) {
      return '';
    }
    return this.str($r('app.string.update_body')).replace('%1$s', notice.version);
  }

  /** 状态文案。 */
  private static stateLabel(status: string): string {
    if (status === HostStatus.CONNECTED) {
      return '已连接';
    }
    if (status === HostStatus.OFFLINE) {
      return '未连接';
    }
    if (status === HostStatus.NEEDS_REPAIR) {
      return '需重新配对';
    }
    return '状态未知';
  }

  /** 副标题：地址 · 状态 · （已配对）· （需重配原因）。 */
  private static detailLine(host: HostEntry): string {
    const parts: string[] = [host.displayOrigin(), Index.stateLabel(host.status)];
    if (host.deviceId !== null) {
      parts.push('设备已配对');
    }
    if (host.statusReason !== null) {
      parts.push(host.statusReason);
    }
    return parts.join(' · ');
  }

  /** 手动整页重载：对页面加载失败（如插件 boot 失败）做壳层恢复，与换主机同一 reload 原语。 */
  reloadPage(): void {
    if (!this.pageArmed) {
      return;
    }
    try {
      this.controller.loadUrl(this.pageUrl);
    } catch (error) {
      // 控制器尚未附着（arm 与附着之间的窗口）时无页面可重载，忽略。
    }
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Column() {
        // 顶栏：状态 + 主机入口
        Row() {
          Circle({ width: 8, height: 8 })
            .fill(this.statusColor)
          Text(this.statusText)
            .fontSize(13)
            .fontColor($r('app.color.dsh_label_secondary'))
            .margin({ left: 8 })
            .maxLines(1)
            .layoutWeight(1)
          Text('⟳')
            .fontSize(15)
            .fontColor($r('app.color.dsh_label_secondary'))
            .padding({ left: 12, right: 4, top: 10, bottom: 10 })
            .onClick(() => {
              this.reloadPage();
            })
          Text($r('app.string.management_entry'))
            .fontSize(13)
            .fontColor($r('app.color.dsh_deepseek_400'))
            .padding({ left: 12, right: 16, top: 10, bottom: 10 })
            .onClick(() => {
              router.pushUrl({ url: 'pages/Management' });
            })
        }
        .width('100%')
        .padding({ left: 32, right: 16, top: 10, bottom: 10 })
        .backgroundColor($r('app.color.dsh_bg_base'))
        // 更新提醒卡片（仅跳转形态：鸿蒙没有系统安装器）
        if (this.updateNotice !== null) {
          // 横向留白由外层容器承担：卡片自身不再叠 margin（margin + width('100%') 会溢出布局）
          Column() {
            Column() {
              Text(this.str($r('app.string.update_title')))
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.dsh_label_primary'))
              Text(this.updateBody())
                .fontSize(12)
                .fontColor($r('app.color.dsh_label_tertiary'))
                .margin({ top: 6 })
              Row() {
                Button(this.str($r('app.string.update_action')))
                  .fontSize(13)
                  .backgroundColor($r('app.color.dsh_deepseek_450'))
                  .onClick(() => {
                    this.openUpdatePage();
                  })
                Button(this.str($r('app.string.update_ignore')))
                  .fontSize(13)
                  .backgroundColor(Color.Transparent)
                  .fontColor($r('app.color.dsh_label_tertiary'))
                  .onClick(() => {
                    this.ignoreUpdateVersion();
                  })
              }
              .width('100%')
              .margin({ top: 10 })
            }
            .width('100%')
            .padding(14)
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))
          }
          .width('100%')
          .padding({ left: 32, right: 32, top: 8 })
        }
        // 页面载体
        // 页面载体：只有已连接主机才加载页面（引导载荷仅在连接后可用，
        // 空载加载只会拿到 503 白屏）；未连接时显示壳内占位屏。
        Stack() {
          Web({ src: this.pageArmed ? this.pageUrl : 'about:blank', controller: this.controller })
            .javaScriptAccess(true)
            .domStorageAccess(true)
            .databaseAccess(true)
            .fileAccess(true)
            // 壳的信任边界是「壳内资产 + 用户自配的那台主机」，页面可能引用主机的明文资源，
            // 故放开混合内容（与 Android 壳的 MIXED_CONTENT_ALWAYS_ALLOW 同款理由）。
            .mixedMode(MixedMode.All)
            .cacheMode(CacheMode.Default)
            .width('100%')
            .height('100%')
            .onControllerAttached(() => {
              this.controller.registerJavaScriptProxy(this.nativeBridge, ShellSettings.NATIVE_BRIDGE_NAME,
                [], ['request']);
              this.controller.registerJavaScriptProxy(this.mobileBridge, ShellSettings.MOBILE_BRIDGE_NAME,
                ['hosts', 'current', 'switchHost']);
            })
            .onPageEnd(() => {
              this.pageLoaded = true;
            })
          if (!this.pageArmed) {
            Column() {
              Text($r('app.string.page_placeholder_title'))
                .fontSize(16)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.dsh_label_primary'))
              Text($r('app.string.page_placeholder_hint'))
                .fontSize(12)
                .fontColor($r('app.color.dsh_label_tertiary'))
                .textAlign(TextAlign.Center)
                .margin({ top: 8, left: 32, right: 32 })
              Button($r('app.string.page_placeholder_action'))
                .fontSize(13)
                .backgroundColor($r('app.color.dsh_deepseek_450'))
                .borderRadius(10)
                .margin({ top: 16 })
                .onClick(() => {
                  router.pushUrl({ url: 'pages/Management' });
                })
            }
            .width('100%')
            .height('100%')
            .justifyContent(FlexAlign.Center)
            .backgroundColor($r('app.color.dsh_bg_base'))
          }
      // 浮层切换器（原型变体 A）：叠在页面之上的覆盖层，不再与页面分割高度
      Stack({ alignContent: Alignment.BottomEnd }) {
          if (this.drawerOpen) {
            Column() {
              Blank()
            }
            .width('100%')
            .height('100%')
            .backgroundColor('#66000000')
            .onClick(() => {
              this.drawerOpen = false;
            })
          }
          Column() {
            Row() {
              Text($r('app.string.switcher_title'))
                .fontSize(12)
                .fontColor($r('app.color.dsh_label_tertiary'))
                .layoutWeight(1)
            }
            .width('100%')
            .padding({ left: 16, right: 16, top: 14, bottom: 6 })

            ForEach(this.hostRows, (row: HostRow) => {
              Row() {
                Circle({ width: 8, height: 8 })
                  .fill(row.statusColor)
                Column() {
                  Text(row.label)
                    .fontSize(13)
                    .fontColor($r('app.color.dsh_label_primary'))
                  Text(row.detail)
                    .fontSize(11)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                }
                .alignItems(HorizontalAlign.Start)
                .margin({ left: 10 })
                .layoutWeight(1)
                Text(row.form)
                  .fontSize(10)
                  .fontColor(row.formColor)
                  .borderWidth(1)
                  .borderColor(row.formColor)
                  .borderRadius(999)
                  .padding({ left: 8, right: 8, top: 2, bottom: 2 })
              }
              .width('100%')
              .padding({ left: 16, right: 16, top: 12, bottom: 12 })
              .onClick(() => {
                this.drawerOpen = false;
                if (row.current) {
                  promptAction.showToast({ message: this.str($r('app.string.toast_already_current')) });
                  return;
                }
                const host = this.shell.registry.find(row.id);
                if (host !== null) {
                  this.applyHost(host);
                }
              })
            }, (row: HostRow) => row.id)

            Text($r('app.string.switcher_hint'))
              .fontSize(11)
              .fontColor($r('app.color.dsh_label_caption'))
              .padding({ left: 16, right: 16, top: 8, bottom: 18 })
          }
          .width('100%')
          .backgroundColor($r('app.color.dsh_bg_layer_2'))
          .borderRadius({ topLeft: 20, topRight: 20 })
          .translate({ y: this.drawerOpen ? 0 : 400 })
          .animation({ duration: 220, curve: Curve.EaseOut })

        }
        .width('100%')
        .height('100%')
        .hitTestBehavior(HitTestMode.None)
      }
      .width('100%')
      .layoutWeight(1)
    }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.dsh_bg_base'))
    }
    .width('100%')
    .height('100%')
  }
}
