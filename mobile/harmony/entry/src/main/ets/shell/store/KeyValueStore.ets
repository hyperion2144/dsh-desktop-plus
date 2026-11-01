/**
 * 键值存储的最小抽象。
 *
 * 上层（主机仓库、偏好）只认「键值」，不认鸿蒙的资产存储或 preferences，
 * 于是「加密存储」与「内存回退」是同一个实现细节的两种落法。
 *
 * 与 Android 壳的差别：鸿蒙的资产存储接口全是异步的（asset.add / query / update），
 * 因此这一层的读写都是 Promise。
 */
export interface KeyValueStore {
  /** 读一个字符串；不存在时返回 null。 */
  getString(key: string): Promise<string | null>;

  /** 写一个字符串；value 为 null 时删除该键。 */
  putString(key: string, value: string | null): Promise<void>;

  /** 读一个布尔值；不存在时返回 fallback。 */
  getBoolean(key: string, fallback: boolean): Promise<boolean>;

  /** 写一个布尔值。 */
  putBoolean(key: string, value: boolean): Promise<void>;
}

/**
 * 内存实现：平台加密存储不可用时的回退。
 *
 * 语义与 Android 的 MemoryKeyValueStore 一致：App 被杀即失，壳照常可用，只是不持久。
 */
export class MemoryKeyValueStore implements KeyValueStore {
  private readonly values: Map<string, string> = new Map();

  async getString(key: string): Promise<string | null> {
    const value = this.values.get(key);
    return value === undefined ? null : value;
  }

  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = this.values.get(key);
    return value === undefined ? fallback : value === 'true';
  }

  async putBoolean(key: string, value: boolean): Promise<void> {
    this.values.set(key, value ? 'true' : 'false');
  }
}
