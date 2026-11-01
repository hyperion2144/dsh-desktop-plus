/**
 * 外观模式：跟随系统 / 强制浅色 / 强制深色。
 *
 * 语义色本身由**资源限定符**决定（`base` = 浅色，`dark` = 深色），
 * 这里只回答两个问题：用户选了什么（代码），以及不认识的值怎么兜底。
 *
 * 颜色资源的深浅两套值在 `resources/base|dark/element/color.json`，
 * 手动切换由应用级色彩模式触发（见 `ThemeController`）。
 */

/** 外观模式的代码（写进偏好与 iOS 壳同键：`pref.appearance`）。 */
export type AppearanceModeCode = 'system' | 'light' | 'dark';

/** 外观模式的取值。 */
export class AppearanceMode {
  /** 跟随系统（不设应用级色彩模式）。 */
  static readonly SYSTEM: AppearanceModeCode = 'system';
  /** 强制浅色。 */
  static readonly LIGHT: AppearanceModeCode = 'light';
  /** 强制深色。 */
  static readonly DARK: AppearanceModeCode = 'dark';

  /** 由存储里的代码还原；不认识的一律按 SYSTEM（跟随系统）处理。 */
  static fromCode(code: string | null): AppearanceModeCode {
    if (code === AppearanceMode.LIGHT || code === AppearanceMode.DARK) {
      return code;
    }
    return AppearanceMode.SYSTEM;
  }
}
