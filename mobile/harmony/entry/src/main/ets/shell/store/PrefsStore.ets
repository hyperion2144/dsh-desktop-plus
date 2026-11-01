import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { KeyValueStore, MemoryKeyValueStore } from './KeyValueStore';
import { ShellLog } from '../ShellLog';

/**
 * 壳的非凭证存储（鸿蒙 preferences）。
 *
 * 放什么：主机的展示与路由元数据（id / 名字 / 地址 / 形态 / 候选 / 状态）、
 * 生物锁与更新提醒开关。
 * 不放什么：**凭证**——会话 cookie、设备 ID、配对令牌一律进资产存储（见 AssetStore）。
 *
 * 偏好本身不敏感，但与凭证分开存放让「哪些是秘密」在代码结构上一目了然。
 */
export class PrefsStore implements KeyValueStore {
  private readonly store: preferences.Preferences;

  constructor(store: preferences.Preferences) {
    this.store = store;
  }

  /**
   * 打开偏好存储；不可用时回退到内存存储（壳照常可用，只是不持久）。
   */
  static async open(context: common.Context): Promise<KeyValueStore> {
    try {
      const store = await preferences.getPreferences(context, { name: 'dsh_mobile' });
      return new PrefsStore(store);
    } catch (error) {
      ShellLog.error('偏好存储不可用，回退到内存存储');
      return new MemoryKeyValueStore();
    }
  }

  async getString(key: string): Promise<string | null> {
    const value = await this.store.get(key, '');
    if (typeof value === 'string') {
      return value.length === 0 ? null : value;
    }
    return null;
  }

  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.store.delete(key);
      await this.store.flush();
      return;
    }
    await this.store.put(key, value);
    // preferences 的 put 只进内存缓存，不 flush 就不落盘——进程退出即丢，
    // 主机表（含当前主机）全在这里，必须落盘。
    await this.store.flush();
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.store.get(key, fallback);
    if (typeof value === 'boolean') {
      return value;
    }
    return fallback;
  }

  async putBoolean(key: string, value: boolean): Promise<void> {
    await this.store.put(key, value);
    await this.store.flush();
  }
}
