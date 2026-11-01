import { HostForm, HostFormCode, HostStatus, HostStatusCode } from '../host/HostTypes';

/**
 * 管理页的视觉词汇：状态点与形态徽标。
 *
 * 色值全部来自 dsh 视觉 token（`entry/src/main/resources/base/element/color.json`，
 * 值逐条取自 upstream 的 design-platform.css dark body），这里只做「语义 → token」的映射。
 */
export class HostVisuals {
  /** 状态点的颜色。 */
  static statusColor(status: HostStatusCode): ResourceColor {
    if (status === HostStatus.CONNECTED) {
      return $r('app.color.dsh_state_success');
    }
    if (status === HostStatus.NEEDS_REPAIR) {
      return $r('app.color.dsh_state_error');
    }
    if (status === HostStatus.OFFLINE) {
      return $r('app.color.dsh_label_tertiary');
    }
    return $r('app.color.dsh_label_caption');
  }

  /** 形态徽标的颜色（原型：lan 绿 / mdns 链接蓝 / tunnel 紫）。 */
  static formColor(form: HostFormCode): ResourceColor {
    if (form === HostForm.LAN) {
      return $r('app.color.dsh_state_success');
    }
    if (form === HostForm.MDNS) {
      return $r('app.color.dsh_deepseek_400');
    }
    if (form === HostForm.TUNNEL) {
      return $r('app.color.dsh_violet');
    }
    return $r('app.color.dsh_deepseek_400');
  }
}
