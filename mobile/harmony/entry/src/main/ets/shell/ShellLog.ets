import { hilog } from '@kit.PerformanceAnalysisKit';

/**
 * 壳内统一日志出口。
 *
 * tag 固定为 `DshMobile`，便于在真机上 `hdc shell hilog -T DshMobile` 观察数据面；
 * 与 Android 壳的 `ShellLog`（tag `DshMobile`）保持同名，两端排查方式一致。
 */
export class ShellLog {
  /** hilog 的 domain：应用自定义域，取 0xD00（非 0 即为应用域）。 */
  private static readonly DOMAIN: number = 0xD00;

  /** hilog 的 tag。 */
  private static readonly TAG: string = 'DshMobile';

  static info(message: string): void {
    hilog.info(ShellLog.DOMAIN, ShellLog.TAG, '%{public}s', message);
  }

  static warn(message: string): void {
    hilog.warn(ShellLog.DOMAIN, ShellLog.TAG, '%{public}s', message);
  }

  static error(message: string): void {
    hilog.error(ShellLog.DOMAIN, ShellLog.TAG, '%{public}s', message);
  }
}
