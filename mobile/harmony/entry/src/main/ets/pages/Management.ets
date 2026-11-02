import { router, promptAction } from '@kit.ArkUI';
import { ShellApp } from '../shell/ShellApp';
import { HostEntry, HostForm, HostStatus } from '../shell/host/HostTypes';
import { HostVisuals } from '../shell/ui/HostVisuals';
import { AppearanceMode, AppearanceModeCode } from '../shell/theme/AppearanceMode';

/** 主机列表里的一行（管理页的展示模型）。 */
class HostRow {
  id: string = '';
  label: string = '';
  origin: string = '';
  form: string = '';
  formColor: ResourceColor = $r('app.color.dsh_state_success');
  statusColor: ResourceColor = $r('app.color.dsh_label_caption');
  detail: string = '';
  current: boolean = false;
  latency: string = '';
}

/**
 * 原生管理页（原型定稿变体 A）。
 *
 * 结构：当前主机大卡 → 主机卡片列表 → 偏好分组 → 右下 FAB 进配对。
 *
 * ## 与主界面的关系
 *
 * 管理页不直接操作 WebView：切主机 = 改「当前主机」，主界面回前台时发现当前主机变了，
 * 就切代理目标 + 重载页面。**会话在桌面侧，不丢。**
 *
 * 敏感操作（配对、移除主机）要先过生物锁。
 */

/** 重命名主机的输入对话框。 */
@CustomDialog
struct RenameDialog {
  controller?: CustomDialogController;
  @Link renameText: string;
  onConfirm: () => void = () => {};

  build() {
    Column() {
      Text('重命名主机')
        .fontSize(15)
        .fontWeight(FontWeight.Bold)
        .fontColor($r('app.color.dsh_label_primary'))
      TextInput({ text: this.renameText })
        .onChange((value: string) => {
          this.renameText = value;
        })
        .fontSize(14)
        .height(44)
        .width('100%')
        .margin({ top: 14 })
      Row() {
        Button('取消')
          .fontSize(14)
          .fontColor($r('app.color.dsh_label_secondary'))
          .backgroundColor($r('app.color.dsh_chip'))
          .height(40)
          .layoutWeight(1)
          .onClick(() => {
            this.controller?.close();
          })
        Button('保存')
          .fontSize(14)
          .fontColor('#FFFFFF')
          .backgroundColor($r('app.color.dsh_deepseek_450'))
          .height(40)
          .layoutWeight(1)
          .margin({ left: 12 })
          .onClick(() => {
            this.onConfirm();
            this.controller?.close();
          })
      }
      .margin({ top: 18 })
    }
    .padding(20)
    .borderRadius(16)
    .backgroundColor($r('app.color.dsh_bg_layer_2'))
  }
}
@Entry
@Component
struct Management {
  @State hostRows: HostRow[] = [];
  @State currentLabel: string = '';
  @State currentDetail: string = '';
  @State currentForm: string = '';
  @State currentFormColor: ResourceColor = $r('app.color.dsh_state_success');
  @State currentStatusColor: ResourceColor = $r('app.color.dsh_label_caption');
  @State hasCurrent: boolean = false;
  @State updateEnabled: boolean = false;
  @State lockEnabled: boolean = true;
  @State appearanceMode: AppearanceModeCode = AppearanceMode.SYSTEM;
  @State renameTargetId: string = '';
  @State renameText: string = '';
  renameDialog: CustomDialogController = new CustomDialogController({
    builder: RenameDialog({
      renameText: $renameText,
      onConfirm: (): void => {
        this.applyRename();
      }
    }),
    autoCancel: true,
    alignment: DialogAlignment.Center
  });

  private shell: ShellApp = ShellApp.get();

  /** 取字符串资源的真实值：$r() 返回 Resource 对象，直接 .toString() 是 [object Object]。 */
  private str(res: Resource): string {
    return getContext(this).resourceManager.getStringSync(res);
  }

  aboutToAppear(): void {
    this.render();
    this.shell.preferences.updateReminderEnabled().then((value) => {
      this.updateEnabled = value;
    });
    this.shell.lock.load().then(() => {
      this.lockEnabled = this.shell.lock.enabled();
    });
    this.shell.theme.current().then((mode) => {
      this.appearanceMode = mode;
    });
  }

  onPageShow(): void {
    // 过生物锁回来的移除意图在这里消费：锁页只验证身份，不带业务参数。
    this.consumePendingRemoval();
    this.render();
  }

  /** 重建当前主机大卡与主机列表。 */
  render(): void {
    const rows: HostRow[] = [];
    const current = this.shell.registry.current();
    for (const host of this.shell.registry.list()) {
      const row = new HostRow();
      row.id = host.id;
      row.label = host.displayName();
      row.origin = host.displayOrigin();
      row.form = host.form;
      row.formColor = HostVisuals.formColor(host.form);
      row.statusColor = HostVisuals.statusColor(host.status);
      row.detail = Management.detailLine(host);
      row.current = current !== null && host.id === current.id;
      row.latency = host.latencyMs === null ? '' : `${host.latencyMs} ms`;
      rows.push(row);
    }
    this.hostRows = rows;
    this.hasCurrent = current !== null;
    if (current !== null) {
      this.currentLabel = current.displayName();
      this.currentDetail = Management.detailLine(current);
      this.currentForm = current.form;
      this.currentFormColor = HostVisuals.formColor(current.form);
      this.currentStatusColor = HostVisuals.statusColor(current.status);
    }
    this.measureLatency();
  }

  /** 探测当前主机的往返延迟。 */
  measureLatency(): void {
    const host = this.shell.registry.current();
    if (host === null) {
      return;
    }
    this.shell.probe.latency(host.laneOrigin).then((latency) => {
      if (latency === null) {
        return;
      }
      this.shell.registry.markLatency(host.id, latency);
      const rows = this.hostRows;
      for (const row of rows) {
        if (row.id === host.id) {
          row.latency = `${latency} ms`;
        }
      }
      this.hostRows = rows.slice();
    });
  }

  /** 外观当前值的文案（行尾显示）。 */
  private appearanceLabel(): string {
    if (this.appearanceMode === AppearanceMode.LIGHT) {
      return this.str($r('app.string.appearance_light'));
    }
    if (this.appearanceMode === AppearanceMode.DARK) {
      return this.str($r('app.string.appearance_dark'));
    }
    return this.str($r('app.string.appearance_system'));
  }

  /** 三选一：跟随系统 / 浅色 / 深色。 */
  chooseAppearance(): void {
    const options: AlertDialogParamWithOptions = {
      title: this.str($r('app.string.pref_appearance_title')),
      message: this.str($r('app.string.pref_appearance_current')).replace('%1$s', this.appearanceLabel()),
      buttons: [
        {
          value: this.str($r('app.string.appearance_system')),
          action: () => {
            this.applyAppearance(AppearanceMode.SYSTEM);
          }
        },
        {
          value: this.str($r('app.string.appearance_light')),
          action: () => {
            this.applyAppearance(AppearanceMode.LIGHT);
          }
        },
        {
          value: this.str($r('app.string.appearance_dark')),
          action: () => {
            this.applyAppearance(AppearanceMode.DARK);
          }
        }
      ]
    };
    this.getUIContext().showAlertDialog(options);
  }

  /** 落盘 + 立即生效（失败只提示，不改行文案）。 */
  applyAppearance(mode: AppearanceModeCode): void {
    this.shell.theme.set(mode).then(() => {
      this.appearanceMode = mode;
    }).catch(() => {
      promptAction.showToast({ message: this.str($r('app.string.toast_appearance_failed')) });
    });
  }

  /** 副标题：地址 · 状态 · （已配对）· （需重配原因）。 */
  private static detailLine(host: HostEntry): string {
    const parts: string[] = [host.displayOrigin(), Management.stateLabel(host.status)];
    if (host.deviceId !== null) {
      parts.push('设备已配对');
    }
    if (host.statusReason !== null) {
      parts.push(host.statusReason);
    }
    if (host.form === HostForm.TUNNEL && host.tunnelReachable !== null) {
      parts.push(host.tunnelReachable ? '隧道可达' : '隧道不可达');
    }
    return parts.join(' · ');
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

  /** 主机行的「⋯」菜单：重命名 / 移除 / 取消。 */
  hostMenu(row: HostRow): void {
    const options: AlertDialogParamWithOptions = {
      title: row.label,
      message: row.origin,
      buttons: [
        {
          value: '重命名',
          action: () => {
            this.startRename(row.id);
          }
        },
        {
          value: '移除',
          action: () => {
            const host = this.shell.registry.find(row.id);
            if (host !== null) {
              this.removeHost(host);
            }
          }
        },
        {
          value: '取消',
          action: () => {
            // 关闭即可。
          }
        }
      ]
    };
    this.getUIContext().showAlertDialog(options);
  }

  /** 进入重命名：填当前显示名后弹输入框。 */
  startRename(id: string): void {
    const host = this.shell.registry.find(id);
    if (host === null) {
      return;
    }
    this.renameTargetId = id;
    this.renameText = host.label;
    this.renameDialog.open();
  }

  /** 落盘新名字（空名视为放弃）。 */
  applyRename(): void {
    const name = this.renameText.trim();
    const id = this.renameTargetId;
    this.renameTargetId = '';
    if (name.length === 0 || id.length === 0) {
      return;
    }
    const host = this.shell.registry.find(id);
    if (host === null) {
      return;
    }
    const updated = host.clone();
    updated.label = name;
    this.shell.registry.upsert(updated).then(() => {
      promptAction.showToast({ message: '已重命名' });
      this.render();
    });
  }

  /** 移除主机：先二次确认，再过生物锁（若开启）。 */
  removeHost(host: HostEntry): void {
    const options: AlertDialogParamWithOptions = {
      title: '移除主机',
      message: `移除「${host.displayName()}」后需要重新扫码配对才能再连接它。`,
      buttons: [
        {
          value: '取消',
          action: () => {
            // 关闭即可。
          }
        },
        {
          value: '移除',
          action: () => {
            this.requestRemoveWithLock(host.id);
          }
        }
      ]
    };
    this.getUIContext().showAlertDialog(options);
  }

  /** 过生物锁（未开启则直接删）：意图先挂起，验证回来由 onPageShow 消费。 */
  requestRemoveWithLock(id: string): void {
    if (!this.shell.lock.enabled()) {
      this.confirmRemove(id);
      return;
    }
    this.shell.pendingHostRemoval = id;
    this.shell.lock.lock();
    router.pushUrl({ url: 'pages/Lock', params: { reason: 'sensitive', next: 'management' } });
  }

  /** 消费过锁回来的移除意图。 */
  private consumePendingRemoval(): void {
    const id = this.shell.pendingHostRemoval;
    if (id === null) {
      return;
    }
    this.shell.pendingHostRemoval = null;
    this.confirmRemove(id);
  }

  /** 真正移除（已过确认与生物锁）。 */
  confirmRemove(id: string): void {
    const host = this.shell.registry.find(id);
    const name = host === null ? id : host.displayName();
    this.shell.registry.remove(id).then(() => {
      promptAction.showToast({ message: this.str($r('app.string.toast_host_removed')).replace('%1$s', name) });
      this.render();
    });
  }

  build() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Column() {
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
          Text($r('app.string.management_title'))
            .fontSize(17)
            .fontWeight(FontWeight.Bold)
            .fontColor($r('app.color.dsh_label_primary'))
            .margin({ left: 12 })
          Blank()
        }
        .width('100%')
        .padding({ left: 32, right: 32, top: 12, bottom: 12 })

        Scroll() {
          Column() {
            // 当前主机大卡
            Column() {
              Row() {
                Circle({ width: 8, height: 8 })
                  .fill(this.currentStatusColor)
                Text(this.hasCurrent ? this.currentLabel : this.str($r('app.string.management_no_host')))
                  .fontSize(15)
                  .fontWeight(FontWeight.Bold)
                  .fontColor($r('app.color.dsh_label_primary'))
                  .margin({ left: 8 })
                  .layoutWeight(1)
                if (this.hasCurrent) {
                  Text(this.currentForm)
                    .fontSize(10)
                    .fontColor(this.currentFormColor)
                    .borderWidth(1)
                    .borderColor(this.currentFormColor)
                    .borderRadius(999)
                    .padding({ left: 8, right: 8, top: 2, bottom: 2 })
                }
              }
              .width('100%')
              if (this.hasCurrent) {
                Text(this.currentDetail)
                  .fontSize(12)
                  .fontColor($r('app.color.dsh_label_tertiary'))
                  .margin({ top: 4 })
              }
            }
            .width('100%')
            .padding(14)
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))

            // 主机分组
            Text(this.str($r('app.string.management_group_hosts')) + `（${this.hostRows.length}）`)
              .fontSize(12)
              .fontColor($r('app.color.dsh_label_tertiary'))
              .width('100%')
              .padding({ top: 14, bottom: 6 })

            Column() {
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
                  if (row.current) {
                    Text(this.str($r('app.string.host_current_marker')))
                      .fontSize(11)
                      .fontColor($r('app.color.dsh_deepseek_400'))
                      .margin({ left: 10 })
                  }
                  Text('⋯')
                    .fontSize(16)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                    .margin({ left: 10 })
                    .padding({ left: 8, right: 8 })
                    .onClick(() => {
                      this.hostMenu(row);
                    })
                }
                .width('100%')
                .padding({ left: 14, right: 14, top: 12, bottom: 12 })
                .onClick(() => {
                  if (row.current) {
                    promptAction.showToast({ message: this.str($r('app.string.toast_already_current')) });
                    return;
                  }
                  this.shell.registry.setCurrent(row.id).then(() => {
                    promptAction.showToast({ message: this.str($r('app.string.toast_switching_host')).replace('%1$s', row.label) });
                    router.back();
                  });
                })
                .gesture(LongPressGesture().onAction(() => {
                  // 长按 = 同一套菜单（之前直接进删除，生物锁开启时过锁回来意图丢失，用户看到的就是「闪一下」）。
                  this.hostMenu(row);
                }))
              }, (row: HostRow) => row.id)
            }
            .width('100%')
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))

            Text(this.str($r('app.string.management_hint_remove')))
              .fontSize(11)
              .fontColor($r('app.color.dsh_label_caption'))
              .width('100%')
              .padding({ top: 6, bottom: 6 })

            // 偏好分组
            Text(this.str($r('app.string.management_group_prefs')))
              .fontSize(12)
              .fontColor($r('app.color.dsh_label_tertiary'))
              .width('100%')
              .padding({ top: 14, bottom: 6 })

            Column() {
              Row() {
                Column() {
                  Text(this.str($r('app.string.pref_update_title')))
                    .fontSize(13)
                    .fontColor($r('app.color.dsh_label_primary'))
                  Text(this.str($r('app.string.pref_update_desc')))
                    .fontSize(11)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Toggle({ type: ToggleType.Switch, isOn: this.updateEnabled })
                  .selectedColor($r('app.color.dsh_deepseek_450'))
                  .onChange((value) => {
                    this.updateEnabled = value;
                    this.shell.preferences.setUpdateReminderEnabled(value);
                  })
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 12, bottom: 12 })

              Row() {
                Column() {
                  Text(this.str($r('app.string.pref_lock_title')))
                    .fontSize(13)
                    .fontColor($r('app.color.dsh_label_primary'))
                  Text(this.str($r('app.string.pref_lock_desc')))
                    .fontSize(11)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Toggle({ type: ToggleType.Switch, isOn: this.lockEnabled })
                  .selectedColor($r('app.color.dsh_deepseek_450'))
                  .onChange((value) => {
                    this.lockEnabled = value;
                    this.shell.lock.setEnabled(value);
                  })
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 12, bottom: 12 })

              Row() {
                Column() {
                  Text(this.str($r('app.string.pref_appearance_title')))
                    .fontSize(13)
                    .fontColor($r('app.color.dsh_label_primary'))
                  Text(this.str($r('app.string.pref_appearance_desc')))
                    .fontSize(11)
                    .fontColor($r('app.color.dsh_label_tertiary'))
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                Text(this.appearanceLabel())
                  .fontSize(13)
                  .fontColor($r('app.color.dsh_deepseek_400'))
              }
              .width('100%')
              .padding({ left: 14, right: 14, top: 12, bottom: 12 })
              .onClick(() => {
                this.chooseAppearance();
              })
            }
            .width('100%')
            .backgroundColor($r('app.color.dsh_bg_layer_2'))
            .borderRadius(12)
            .borderWidth(1)
            .borderColor($r('app.color.dsh_border_l2'))
          }
          .width('100%')
          .constraintSize({ minHeight: '100%' })
          .padding({ left: 32, right: 32 })
        }
        .layoutWeight(1)
        .align(Alignment.TopStart)
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.dsh_bg_base'))

      // 右下 FAB：进配对（敏感操作，先过生物锁）
      Text('＋')
        .fontSize(26)
        .fontColor('#FFFFFF')
        .width(52)
        .height(52)
        .textAlign(TextAlign.Center)
        .backgroundColor($r('app.color.dsh_deepseek_450'))
        .borderRadius(16)
        .margin({ right: 24, bottom: 28 })
        .onClick(() => {
          if (!this.shell.lock.enabled()) {
            router.pushUrl({ url: 'pages/Pairing' });
            return;
          }
          this.shell.lock.lock();
          router.pushUrl({ url: 'pages/Lock', params: { reason: 'sensitive', next: 'pairing' } });
        })
    }
    .width('100%')
    .height('100%')
  }
}
