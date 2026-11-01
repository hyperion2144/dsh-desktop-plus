import { router, promptAction } from '@kit.ArkUI';
import { common, abilityAccessCtrl } from '@kit.AbilityKit';
import { scanBarcode, scanCore } from '@kit.ScanKit';
import { ShellApp } from '../shell/ShellApp';
import { PairLink } from '../shell/pair/PairLink';
import { PairFailureCode } from '../shell/pair/PairFailure';
import { DiscoveredHost, MdnsDiscovery } from '../shell/discover/MdnsDiscovery';
import { ShellLog } from '../shell/ShellLog';

/** 发现到的一台桌面（配对页的展示模型）。 */
class DiscoveredRow {
  name: string = '';
  origin: string = '';
}

/**
 * 权限申请的结果（壳只关心每个权限的授权码：0 = 已授权）。
 *
 * 这里自己声明而不是引用平台的 `PermissionRequestResult`：平台那个类型不在
 * `abilityAccessCtrl` 命名空间的导出面上，按它声明反而拿不到类型。
 */
interface PermissionResult {
  authResults: number[];
}

/**
 * 配对屏（四态：入口 / 验证中 / 成功 / 失败）。
 *
 * 两个入口：**扫描二维码** 与 **粘贴配对链接**。两者拿到的是同一条链接——
 * 桌面端「远程访问」面板签发的一次性链接（10 分钟有效、一次性）。
 * **没有任何令牌手输入口**（spec #55「配对」）。
 *
 * 失败文案区分两类：**链接过期** 与 **设备被移除**（两者的补救动作不同）。
 *
 * 降级链：扫码能力不可用（设备没相机 / 没授权 / 扫码服务没装）时，提示改用「粘贴配对链接」。
 */
@Entry
@Component
struct Pairing {
  @State step: number = 1;
  @State pane: string = 'enter';
  @State linkInput: string = '';
  @State okTitle: string = '';
  @State okDetail: string = '';
  @State failTitle: string = '';
  @State failDetail: string = '';
  @State discovered: DiscoveredRow[] = [];
  /** 选中的发现项（点了就引导去拿这台桌面的配对链接）。 */
  @State selectedName: string = '';
  @State selectedOrigin: string = '';

  private shell: ShellApp = ShellApp.get();

  /** 取字符串资源的真实值：$r() 返回 Resource 对象，直接 .toString() 是 [object Object]。 */
  private str(res: Resource): string {
    return getContext(this).resourceManager.getStringSync(res);
  }
  private discovery: MdnsDiscovery | null = null;

  aboutToAppear(): void {
    this.startDiscovery();
  }

  onPageHide(): void {
    this.stopDiscovery();
  }

  /** 开始 mDNS 发现。 */
  startDiscovery(): void {
    const context = getContext(this) as common.UIAbilityContext;
    this.discovery = new MdnsDiscovery(context);
    this.discovery.start((host: DiscoveredHost) => {
      const rows = this.discovered;
      for (const row of rows) {
        if (row.origin === host.origin()) {
          return;
        }
      }
      const row = new DiscoveredRow();
      row.name = host.displayName();
      row.origin = host.origin();
      rows.push(row);
      this.discovered = rows.slice();
    });
  }

  /** 停止 mDNS 发现。 */
  stopDiscovery(): void {
    if (this.discovery !== null) {
      this.discovery.stop();
      this.discovery = null;
    }
  }

  // ── 扫码 ────────────────────────────────────────────────────────────────

  /** 扫码入口：先要相机权限，再拉起扫码。 */
  startScan(): void {
    const context = getContext(this) as common.UIAbilityContext;
    const manager = abilityAccessCtrl.createAtManager();
    manager.requestPermissionsFromUser(context, ['ohos.permission.CAMERA'])
      .then((result: PermissionResult) => {
      if (result.authResults.length > 0 && result.authResults[0] === 0) {
        this.launchScanner(context);
        return;
      }
      promptAction.showToast({ message: this.str($r('app.string.pair_no_camera')) });
    }).catch(() => {
      promptAction.showToast({ message: this.str($r('app.string.pair_no_camera')) });
    });
  }

  /** 拉起扫码（ScanKit）。 */
  launchScanner(context: common.UIAbilityContext): void {
    scanBarcode.startScanForResult(context, {
      scanTypes: [scanCore.ScanType.QR_CODE],
    }).then((result: scanBarcode.ScanResult) => {
      const value = result.originalValue;
      if (value.length === 0) {
        promptAction.showToast({ message: this.str($r('app.string.pair_fail_malformed_title')) });
        return;
      }
      this.onLink(value);
    }).catch(() => {
      // 扫码能力不可用（设备没相机 / 没装扫码服务）：降级到粘贴。
      promptAction.showToast({ message: this.str($r('app.string.pair_scan_unavailable')) });
    });
  }

  // ── 四态 ────────────────────────────────────────────────────────────────

  /** 拿到一条配对链接（扫码或粘贴）。 */
  onLink(raw: string): void {
    const link = PairLink.parse(raw);
    if (link === null) {
      this.showFailure('malformed');
      return;
    }
    this.showVerifying();
    this.shell.pairing.pair(link).then((outcome) => {
      if (outcome.kind === 'accepted') {
        const host = this.shell.registry.current();
        const name = host === null ? '' : host.displayName();
        this.okTitle = name.length === 0 ? this.str($r('app.string.pair_ok_title')) :
          `${this.str($r('app.string.pair_ok_title'))} ${name}`;
        this.okDetail = name.length === 0 ? this.str($r('app.string.pair_ok_detail')) :
          this.str($r('app.string.pair_ok_detail_host')).replace('%1$s', name);
        this.showSuccess();
        return;
      }
      this.showFailure(outcome.failure);
    });
  }

  /** 状态一：入口。 */
  showEntry(): void {
    this.pane = 'enter';
    this.step = 1;
  }

  /** 状态二：验证中。 */
  showVerifying(): void {
    this.pane = 'verify';
    this.step = 2;
  }

  /** 状态三：成功。 */
  showSuccess(): void {
    this.pane = 'ok';
    this.step = 3;
    ShellLog.info('配对成功');
  }

  /** 状态四：失败（文案区分链接过期与设备被移除）。 */
  showFailure(failure: PairFailureCode): void {
    this.pane = 'fail';
    this.step = 3;
    if (failure === 'invalid-token') {
      this.failTitle = this.str($r('app.string.pair_fail_expired_title'));
      this.failDetail = this.str($r('app.string.pair_fail_expired_detail'));
      return;
    }
    if (failure === 'device-removed') {
      this.failTitle = this.str($r('app.string.pair_fail_removed_title'));
      this.failDetail = this.str($r('app.string.pair_fail_removed_detail'));
      return;
    }
    if (failure === 'unreachable') {
      this.failTitle = this.str($r('app.string.pair_fail_unreachable_title'));
      this.failDetail = this.str($r('app.string.pair_fail_unreachable_detail'));
      return;
    }
    this.failTitle = this.str($r('app.string.pair_fail_malformed_title'));
    this.failDetail = this.str($r('app.string.pair_fail_malformed_detail'));
  }

  build() {
    Column() {
      // 顶栏
      Row() {
        Text('‹')
          .fontSize(22)
          .fontColor($r('app.color.dsh_label_primary'))
          .width(40)
          .height(40)
          .textAlign(TextAlign.Center)
          .backgroundColor($r('app.color.dsh_chip'))
          .borderRadius(10)
          .onClick(() => {
            router.back();
          })
        Text($r('app.string.pair_title'))
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.dsh_label_primary'))
          .margin({ left: 12 })
        Blank()
      }
      .width('100%')
      .padding({ left: 32, right: 32, top: 12, bottom: 12 })

      // 步骤条
      Row() {
        Text(this.str($r('app.string.pair_step_source')))
          .fontSize(11)
          .fontColor(this.step >= 1 ? $r('app.color.dsh_deepseek_400') : $r('app.color.dsh_label_tertiary'))
          .layoutWeight(1)
        Text(this.str($r('app.string.pair_step_verify')))
          .fontSize(11)
          .fontColor(this.step >= 2 ? $r('app.color.dsh_deepseek_400') : $r('app.color.dsh_label_tertiary'))
          .layoutWeight(1)
        Text(this.str($r('app.string.pair_step_done')))
          .fontSize(11)
          .fontColor(this.step >= 3 ? $r('app.color.dsh_deepseek_400') : $r('app.color.dsh_label_tertiary'))
          .layoutWeight(1)
      }
      .width('100%')
      .padding({ left: 32, right: 32, top: 6, bottom: 10 })

      if (this.pane === 'enter') {
        Scroll() {
          Column() {
            // 扫码
            Column() {
              Text(this.str($r('app.string.pair_scan_title')))
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.dsh_label_primary'))
              Text(this.str($r('app.string.pair_scan_desc')))
                .fontSize(11)
                .fontColor($r('app.color.dsh_label_tertiary'))
                .margin({ top: 6 })
            }
            .width('100%')
            .margin({ bottom: 12 })
            .padding(14)
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))
            .onClick(() => {
              this.startScan();
            })

            // 粘贴
            Column() {
              Text(this.str($r('app.string.pair_paste_title')))
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor($r('app.color.dsh_label_primary'))
              Text(this.str($r('app.string.pair_paste_desc')))
                .fontSize(11)
                .fontColor($r('app.color.dsh_label_tertiary'))
                .margin({ top: 6 })
              TextInput({ placeholder: this.str($r('app.string.pair_paste_hint')), text: this.linkInput })
                .margin({ top: 10 })
                .height(40)
                .fontSize(12)
                .backgroundColor($r('app.color.dsh_bg_layer_3'))
                .borderRadius(8)
                .borderWidth(1)
                .borderColor($r('app.color.dsh_border_l2'))
                .onChange((value) => {
                  this.linkInput = value;
                })
              Button(this.str($r('app.string.pair_use_link')))
                .width('100%')
                .height(38)
                .fontSize(13)
                .backgroundColor($r('app.color.dsh_deepseek_450'))
                .borderRadius(10)
                .margin({ top: 10 })
                .onClick(() => {
                  this.onLink(this.linkInput);
                })
            }
            .width('100%')
            .margin({ bottom: 12 })
            .padding(14)
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))

            // 局域网发现
            Text(this.str($r('app.string.pair_discover_group')))
              .fontSize(12)
              .fontColor($r('app.color.dsh_label_tertiary'))
              .width('100%')
              .padding({ top: 6, bottom: 6 })
            if (this.discovered.length === 0) {
              Text(this.str($r('app.string.pair_discover_empty')))
                .fontSize(12)
                .fontColor($r('app.color.dsh_label_caption'))
                .width('100%')
                .padding({ bottom: 6 })
            }
            ForEach(this.discovered, (row: DiscoveredRow) => {
              Row() {
                Circle({ width: 8, height: 8 })
                  .fill($r('app.color.dsh_state_success'))
                Column() {
                  Text(row.name)
                    .fontSize(13)
                    .fontColor($r('app.color.dsh_label_primary'))
                  Text(row.origin)
                    .fontSize(11)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                }
                .alignItems(HorizontalAlign.Start)
                .margin({ left: 10 })
                .layoutWeight(1)
              }
              .width('100%')
              .padding({ top: 12, bottom: 12 })
              .onClick(() => {
                // 发现只回答「桌面在哪儿」：选中后引导用户去拿这台桌面的配对链接。
                this.selectedName = row.name;
                this.selectedOrigin = row.origin;
              })
            }, (row: DiscoveredRow) => row.origin)
            if (this.selectedOrigin.length > 0) {
              Column() {
                Text(this.str($r('app.string.pair_discover_selected'))
                  .replace('%1$s', this.selectedName)
                  .replace('%2$s', this.selectedOrigin))
                  .fontSize(12)
                  .fontColor($r('app.color.dsh_label_secondary'))
              }
              .width('100%')
              .margin({ top: 8 })
              .padding(12)
              .backgroundColor($r('app.color.dsh_bg_layer_2'))
              .borderRadius(12)
              .borderWidth(1)
              .borderColor($r('app.color.dsh_border_l2'))
            }

            Text(this.str($r('app.string.pair_notice')))
              .fontSize(11)
              .fontColor($r('app.color.dsh_label_caption'))
              .width('100%')
            .padding({ top: 10, bottom: 16 })
          }
          .width('100%')
          .padding({ left: 32, right: 32 })
          .constraintSize({ minHeight: '100%' })
        }
        .layoutWeight(1)
        .align(Alignment.TopStart)
      } else if (this.pane === 'verify') {
        Column() {
          Blank()
          LoadingProgress()
            .width(34)
            .height(34)
            .color($r('app.color.dsh_deepseek_400'))
          Text(this.str($r('app.string.pair_verify_hint')))
            .fontSize(12)
            .fontColor($r('app.color.dsh_label_tertiary'))
            .margin({ top: 12 })
          Blank()
        }
        .width('100%')
        .layoutWeight(1)
      } else if (this.pane === 'ok') {
        Column() {
          Blank()
          Column() {
            Circle({ width: 56, height: 56 })
              .stroke($r('app.color.dsh_state_success'))
              .strokeWidth(3)
              .fill(Color.Transparent)
            Text(this.okTitle)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.dsh_label_primary'))
              .margin({ top: 12 })
            Text(this.okDetail)
              .fontSize(12)
              .fontColor($r('app.color.dsh_label_tertiary'))
              .textAlign(TextAlign.Center)
              .margin({ top: 6 })
          }
          .width('100%')
          Button(this.str($r('app.string.pair_enter')))
            .width('100%')
            .height(46)
            .fontSize(15)
            .backgroundColor($r('app.color.dsh_deepseek_450'))
            .borderRadius(12)
            .margin({ top: 14, bottom: 16 })
            .onClick(() => {
              // 配对成功后直接回到工作台：页面栈是 Index→Management→Pairing，
              // 无参 back 会落在主机管理页，用户还得再手动返回一次。
              router.back({ url: 'pages/Index' });
            })
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 32, right: 32 })
      } else {
        Column() {
          Blank()
          Column() {
            Text('!')
              .fontSize(26)
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.dsh_state_error'))
              .width(56)
              .height(56)
              .textAlign(TextAlign.Center)
              .borderWidth(3)
              .borderColor($r('app.color.dsh_state_error'))
              .borderRadius(28)
            Text(this.failTitle)
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor($r('app.color.dsh_state_error'))
              .margin({ top: 12 })
            Text(this.failDetail)
              .fontSize(12)
              .fontColor($r('app.color.dsh_label_tertiary'))
              .textAlign(TextAlign.Center)
              .margin({ top: 6 })
          }
          .width('100%')
          Button(this.str($r('app.string.pair_retry')))
            .width('100%')
            .height(46)
            .fontSize(15)
            .backgroundColor($r('app.color.dsh_deepseek_450'))
            .borderRadius(12)
            .margin({ top: 14, bottom: 16 })
            .onClick(() => {
              this.showEntry();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 32, right: 32 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.dsh_bg_base'))
  }
}
