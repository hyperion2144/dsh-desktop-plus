import { ShellPreferences } from '../store/ShellPreferences';
import { ShellLog } from '../ShellLog';

/** 触发验证的原因（锁屏文案据此区分）。 */
export type LockReason = 'cold' | 'background';

/**
 * App 级生物锁的状态机。
 *
 * ## 三个触发场景（spec #55「生物锁」）
 *
 * 1. **冷启动**：进程刚起来时 `unlocked = false`，第一次回前台必然要求验证；
 * 2. **后台超 1 分钟回前台**：`onBackground` 记下离开时刻，回前台超过
 *    [ShellSettings.BACKGROUND_TIMEOUT_MS] 就重新上锁；
 * 3. **敏感操作**（配对 / 删主机）：调用 [lock] 主动上锁，验证通过才继续。
 *
 * **切主机不触发**：切换主机在同一个 Ability 内完成，不经过后台/冷启动路径。
 *
 * 开关默认开（`ShellPreferences.biometricLockEnabled`），可关。
 */
export class LockController {
  private readonly preferences: ShellPreferences;
  /** 开关的内存副本（偏好是异步的，界面需要同步读）。 */
  private enabledFlag: boolean = true;
  /** 当前是否已验证（进程内状态，不落盘）。 */
  private unlocked: boolean = false;
  /** 离开前台的时刻（0 = 没离开过）。 */
  private backgroundedAt: number = 0;

  constructor(preferences: ShellPreferences) {
    this.preferences = preferences;
  }

  /** 从偏好恢复开关状态（进程启动时调一次）。 */
  async load(): Promise<void> {
    this.enabledFlag = await this.preferences.biometricLockEnabled();
    if (!this.enabledFlag) {
      this.unlocked = true;
    }
  }

  /** 开关：默认开，可关。关掉时锁整体失效。 */
  enabled(): boolean {
    return this.enabledFlag;
  }

  async setEnabled(value: boolean): Promise<void> {
    this.enabledFlag = value;
    await this.preferences.setBiometricLockEnabled(value);
    if (!value) {
      this.unlocked = true;
    }
  }

  /** 记下离开前台的时刻。 */
  onBackground(): void {
    this.backgroundedAt = Date.now();
    ShellLog.info('离开前台：记下时刻');
  }

  /**
   * 回前台：判断这次要不要验证，并给出触发原因。
   *
   * 副作用：清掉离开时刻（同一个前台周期只判一次）。
   *
   * @returns null = 不需要验证；否则是触发原因（锁屏据此写文案）。
   */
  needsUnlock(): LockReason | null {
    if (!this.enabledFlag) {
      this.unlocked = true;
      return null;
    }
    const elapsed = this.backgroundedAt > 0 ? Date.now() - this.backgroundedAt : 0;
    this.backgroundedAt = 0;
    if (elapsed > LOCK_BACKGROUND_TIMEOUT_MS) {
      this.unlocked = false;
      ShellLog.info(`回前台：离开 ${elapsed}ms → 需验证（后台超时）`);
      return 'background';
    }
    if (this.unlocked) {
      ShellLog.info(`回前台：离开 ${elapsed}ms → 无需验证`);
      return null;
    }
    ShellLog.info(`回前台：离开 ${elapsed}ms → 需验证（冷启动）`);
    return 'cold';
  }

  /** 验证通过。 */
  unlock(): void {
    this.unlocked = true;
  }

  /** 主动上锁（敏感操作前）。 */
  lock(): void {
    this.unlocked = false;
  }
}

/** 后台超时阈值：1 分钟（原型定稿：「离开超过 1 分钟」）。 */
const LOCK_BACKGROUND_TIMEOUT_MS: number = 60000;
