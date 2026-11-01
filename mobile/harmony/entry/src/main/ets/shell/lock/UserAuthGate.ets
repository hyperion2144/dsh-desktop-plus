import { userAuth } from '@kit.UserAuthenticationKit';
import { common } from '@kit.AbilityKit';
import { ShellLog } from '../ShellLog';

/**
 * 生物识别验证的门（鸿蒙 userAuth）。
 *
 * ## 为什么把 PIN 一起放进 authType
 *
 * 鸿蒙的 userAuth 在 `authType` 里同时列出面容、指纹与 PIN 时，系统会**自己**按可用性降级：
 * 生物识别不可用（没录入、硬件缺失、识别失败多次）就落到设备 PIN。
 * 这与 Android 壳的 `BIOMETRIC_STRONG or DEVICE_CREDENTIAL` 同款语义，
 * 用户不会在「没有指纹的机器」上被挡死。
 *
 * 一次验证实例只能用一次（`UserAuthInstance` 的约定），所以每次验证都新建实例。
 */
export class UserAuthGate {
  private readonly context: common.Context;

  constructor(context: common.Context) {
    this.context = context;
  }

  /**
   * 设备上是否还有可用的验证方式（面容 / 指纹 / PIN 任一可用即可）。
   *
   * `getAvailableStatus` 以抛异常表示「不可用」（未录入、硬件缺失等），
   * 因此「不抛错」就等于可用。
   */
  available(): boolean {
    const types: userAuth.UserAuthType[] = [
      userAuth.UserAuthType.FACE,
      userAuth.UserAuthType.FINGERPRINT,
      userAuth.UserAuthType.PIN,
    ];
    for (const type of types) {
      try {
        userAuth.getAvailableStatus(type, userAuth.AuthTrustLevel.ATL2);
        return true;
      } catch (error) {
        // 这类验证方式不可用：换下一种。
      }
    }
    return false;
  }

  /**
   * 发起验证；结果回调到 `onResult`。
   *
   * @param title 验证界面的标题。
   * @param onResult true = 通过；false = 失败或用户取消。
   */
  authenticate(title: string, onResult: (ok: boolean) => void, pinOnly: boolean = false): void {
    const challenge: Uint8Array = new Uint8Array(32);
    for (let index = 0; index < challenge.length; index++) {
      challenge[index] = index & 0xFF;
    }
    const authParam: userAuth.AuthParam = {
      challenge: challenge,
      authType: pinOnly ? [userAuth.UserAuthType.PIN] :
        [userAuth.UserAuthType.FACE, userAuth.UserAuthType.FINGERPRINT, userAuth.UserAuthType.PIN],
      authTrustLevel: userAuth.AuthTrustLevel.ATL2,
    };
    const widgetParam: userAuth.WidgetParam = {
      title: title,
      uiContext: this.context,
    };
    let instance: userAuth.UserAuthInstance;
    try {
      instance = userAuth.getUserAuthInstance(authParam, widgetParam);
    } catch (error) {
      ShellLog.warn('无法创建验证实例');
      onResult(false);
      return;
    }
    const callback: userAuth.IAuthCallback = {
      onResult: (result: userAuth.UserAuthResult) => {
        instance.off('result', callback);
        const ok = result.result === userAuth.UserAuthResultCode.SUCCESS;
        ShellLog.info(ok ? '生物锁验证通过' : `生物锁验证未通过（code=${result.result}）`);
        onResult(ok);
      }
    };
    instance.on('result', callback);
    try {
      instance.start();
    } catch (error) {
      instance.off('result', callback);
      ShellLog.warn('生物锁验证启动失败');
      onResult(false);
    }
  }
}
