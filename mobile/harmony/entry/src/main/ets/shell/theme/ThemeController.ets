import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { ShellPreferences } from '../store/ShellPreferences';
import { ShellLog } from '../ShellLog';
import { AppearanceMode, AppearanceModeCode } from './AppearanceMode';

/**
 * 外观控制器：把「用户选了什么」落到**应用级色彩模式**上。
 *
 * 两步：
 *  1. 选择记在偏好里（`pref.appearance`），跨启动保留；
 *  2. 选择落到应用上下文：浅色 / 深色 / 交回系统（跟随系统）。
 *
 * 色彩模式只能在主线程设置：
 *  - 启动时由壳初始化（`ShellApp.initialize`）调用，早于页面装载，不会闪一下错主题；
 *  - 运行期由管理页的「外观」行调用，改完立刻生效。
 */
export class ThemeController {
  private readonly preferences: ShellPreferences;
  private readonly context: common.Context;

  constructor(preferences: ShellPreferences, context: common.Context) {
    this.preferences = preferences;
    this.context = context;
  }

  /** 当前生效的外观模式（没设过就是跟随系统）。 */
  async current(): Promise<AppearanceModeCode> {
    const raw = await this.preferences.appearance();
    return AppearanceMode.fromCode(raw);
  }

  /** 启动时应用：把用户选的模式落到应用上下文。 */
  async apply(): Promise<void> {
    const mode = await this.current();
    this.applyTo(mode);
  }

  /** 切换外观：落盘 + 立即生效。 */
  async set(mode: AppearanceModeCode): Promise<void> {
    await this.preferences.setAppearance(mode);
    this.applyTo(mode);
  }

  /**
   * 把模式写到应用上下文。
   *
   * `COLOR_MODE_NOT_SET` = 交回系统（跟随系统深浅色）。
   * 设不了不致命：壳继续用系统当前的深浅色。
   */
  private applyTo(mode: AppearanceModeCode): void {
    const appContext = this.context.getApplicationContext();
    try {
      if (mode === AppearanceMode.DARK) {
        appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
        return;
      }
      if (mode === AppearanceMode.LIGHT) {
        appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
        return;
      }
      appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (error) {
      ShellLog.warn('设置应用色彩模式失败：沿用系统当前的深浅色');
    }
  }
}
