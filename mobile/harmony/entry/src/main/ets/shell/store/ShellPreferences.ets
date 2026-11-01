import { KeyValueStore } from './KeyValueStore';

/** 生物锁开关的键。 */
const KEY_BIOMETRIC_LOCK: string = 'pref.biometric_lock';

/** 更新提醒开关的键。 */
const KEY_UPDATE_REMINDER: string = 'pref.update_reminder';

/** 被拉黑的版本（不再提醒这个版本）的键。 */
const KEY_IGNORED_VERSIONS: string = 'pref.update_ignored_versions';

/** 已提醒过的最高版本的键。 */
const KEY_LAST_NOTIFIED: string = 'pref.update_last_notified';

/** 外观模式（跟随系统 / 浅色 / 深色）的键（与 iOS 壳同键）。 */
const KEY_APPEARANCE: string = 'pref.appearance';

/**
 * 壳的非凭证偏好。
 *
 * 与凭证同库存放（同一个键值存储实现）：偏好本身不敏感，但同库意味着「壳只有一处持久化」，
 * 回退到内存存储时偏好与凭证一起失效，语义一致。
 */
export class ShellPreferences {
  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  /**
   * 生物锁开关：**默认开**（spec #55「安全」：App 级锁默认开，可关）。
   */
  async biometricLockEnabled(): Promise<boolean> {
    return this.store.getBoolean(KEY_BIOMETRIC_LOCK, true);
  }

  async setBiometricLockEnabled(value: boolean): Promise<void> {
    await this.store.putBoolean(KEY_BIOMETRIC_LOCK, value);
  }

  /**
   * 更新提醒总开关：**默认开**（桌面 update-notice 契约同款：总开关默认开；Android 壳同此）。
   *
   * 只改默认值——已经存过的用户值原样保留（存过 false 的仍然是 false）。
   * 检查逻辑在 update/UpdateNoticeService。
   */
  async updateReminderEnabled(): Promise<boolean> {
    return this.store.getBoolean(KEY_UPDATE_REMINDER, true);
  }

  async setUpdateReminderEnabled(value: boolean): Promise<void> {
    await this.store.putBoolean(KEY_UPDATE_REMINDER, value);
  }

  /**
   * 被拉黑的版本（不再提醒这个版本）。
   *
   * 拉黑的是**某一个具体版本**，不是整个渠道：更高的版本仍然会提醒。
   * 存成一个换行分隔的串（偏好层的字符串存储没有列表类型）。
   */
  async ignoredUpdateVersions(): Promise<string[]> {
    const raw: string | null = await this.store.getString(KEY_IGNORED_VERSIONS);
    if (raw === null || raw.length === 0) {
      return [];
    }
    const versions: string[] = raw.split('\n');
    const result: string[] = [];
    for (const version of versions) {
      if (version.length > 0 && !result.includes(version)) {
        result.push(version);
      }
    }
    return result;
  }

  /** 拉黑一个版本（「不再提示此版本」）。 */
  async addIgnoredUpdateVersion(version: string): Promise<void> {
    const versions: string[] = await this.ignoredUpdateVersions();
    if (!versions.includes(version)) {
      versions.push(version);
    }
    await this.store.putString(KEY_IGNORED_VERSIONS, versions.join('\n'));
  }

  /**
   * 已提醒过的最高版本（null = 还没提醒过）。
   *
   * 同一个版本不重复提醒；比它旧的版本也不再提醒。
   */
  async lastNotifiedUpdateVersion(): Promise<string | null> {
    return this.store.getString(KEY_LAST_NOTIFIED);
  }

  /** 记下「已经提醒过这个版本」。 */
  async setLastNotifiedUpdateVersion(version: string): Promise<void> {
    await this.store.putString(KEY_LAST_NOTIFIED, version);
  }

  /**
   * 外观模式（`'system'` | `'light'` | `'dark'`）。
   *
   * null = 还没设过（跟随系统）。这套词汇由 `theme/AppearanceMode` 解释，
   * 偏好层只负责存字符串，不认深浅色的语义。
   */
  async appearance(): Promise<string | null> {
    return this.store.getString(KEY_APPEARANCE);
  }

  /** 记下外观模式。 */
  async setAppearance(mode: string): Promise<void> {
    await this.store.putString(KEY_APPEARANCE, mode);
  }
}
