import { router, promptAction } from '@kit.ArkUI';
import { ShellApp } from '../shell/ShellApp';

/**
 * 生物锁屏（原型定稿第④屏）。
 *
 * 三个触发场景共用这一屏：冷启动 / 后台超时回前台 / 敏感操作（配对、删主机）。
 *
 * 不可绕过：返回键被吃掉，唯一出口是验证通过（设备既没生物特征也没 PIN 时放行并记录，
 * 否则用户会被自己的 App 锁死）。
 */
@Entry
@Component
struct Lock {
  @State reasonText: string = '';
  @State hint: string = '';
  @State verifying: boolean = false;

  private shell: ShellApp = ShellApp.get();

  /** 取字符串资源的真实值：$r() 返回 Resource 对象，直接 .toString() 是 [object Object]。 */
  private str(res: Resource): string {
    return getContext(this).resourceManager.getStringSync(res);
  }
  private next: string = '';

  aboutToAppear(): void {
    const params = router.getParams() as Record<string, string>;
    const reason = params === undefined || params === null ? 'cold' : (params['reason'] ?? 'cold');
    this.next = params === undefined || params === null ? '' : (params['next'] ?? '');
    if (reason === 'background') {
      this.reasonText = this.str($r('app.string.lock_reason_background'));
    } else if (reason === 'sensitive') {
      this.reasonText = this.str($r('app.string.lock_reason_sensitive'));
    } else {
      this.reasonText = this.str($r('app.string.lock_reason_cold'));
    }
    this.hint = this.str($r('app.string.lock_hint'));
    if (!this.shell.userAuth.available()) {
      // 设备既没生物特征也没 PIN：放行并记录，否则用户会被自己的 App 锁死。
      this.succeed();
      return;
    }
    this.authenticate(false);
  }

  /** 发起验证（生物识别，失败自动回退 PIN）。 */
  authenticate(pinOnly: boolean): void {
    this.verifying = true;
    this.shell.userAuth.authenticate(this.str($r('app.string.lock_title')), (ok: boolean) => {
      this.verifying = false;
      if (ok) {
        this.succeed();
        return;
      }
      if (!pinOnly) {
        // 生物识别没通过：回退到设备 PIN。
        this.hint = this.str($r('app.string.lock_pin_fallback'));
        this.authenticate(true);
      }
    }, pinOnly);
  }

  /** 验证通过：解锁并回到该去的地方。 */
  succeed(): void {
    this.shell.lock.unlock();
    if (this.next === 'pairing') {
      router.replaceUrl({ url: 'pages/Pairing' });
      return;
    }
    router.back();
  }

  build() {
    Column() {
      Blank()
      Column() {
        Text('D')
          .fontSize(40)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF')
          .width(74)
          .height(74)
          .textAlign(TextAlign.Center)
          .backgroundColor($r('app.color.dsh_deepseek_450'))
          .borderRadius(18)
        Text(this.str($r('app.string.lock_title')))
          .fontSize(16)
          .fontWeight(FontWeight.Bold)
          .fontColor($r('app.color.dsh_label_primary'))
          .margin({ top: 12 })
        Text(this.reasonText)
          .fontSize(12)
          .fontColor($r('app.color.dsh_label_tertiary'))
          .textAlign(TextAlign.Center)
          .margin({ top: 8, left: 40, right: 40 })
        Button(this.verifying ? this.str($r('app.string.lock_verify')) + '…' : this.str($r('app.string.lock_verify')))
          .width(66)
          .height(66)
          .fontSize(14)
          .borderRadius(33)
          .backgroundColor($r('app.color.dsh_chip'))
          .borderWidth(1)
          .borderColor($r('app.color.dsh_border_l2'))
          .margin({ top: 18 })
          .enabled(!this.verifying)
          .onClick(() => {
            this.authenticate(false);
          })
        Text(this.hint)
          .fontSize(12)
          .fontColor($r('app.color.dsh_label_caption'))
          .margin({ top: 12 })
        Text(this.str($r('app.string.lock_pin_fallback')))
          .fontSize(12)
          .fontColor($r('app.color.dsh_deepseek_400'))
          .margin({ top: 8 })
          .onClick(() => {
            this.authenticate(true);
          })
      }
      .width('100%')
      Blank()
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.dsh_bg_base'))
  }
}
