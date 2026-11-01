import { asset } from '@kit.AssetStoreKit';
import { Bytes } from '../util/Bytes';
import { KeyValueStore, MemoryKeyValueStore } from './KeyValueStore';
import { ShellLog } from '../ShellLog';

/**
 * 鸿蒙资产存储（Asset Store）：**凭证**的唯一落点。
 *
 * ## 边界（spec #55「凭证与安全」）
 *
 * 主机会话 cookie、设备 ID、配对令牌只存在这里：
 *  - 密钥材料由系统 HUKS 保管，不出设备；
 *  - 落盘的是密文，页面永远拿不到（页面只能通过壳桥拿到主机名与 origin）。
 *
 * 与 Android 壳的差别：Android 把整张主机表（含 cookie）塞进一份加密偏好；
 * 鸿蒙的资产存储是**按条目**（alias → secret）的，所以这里拆成两处：
 *  - 资产存储：凭证（cookie / deviceId / pairToken）；
 *  - preferences：主机的展示与路由元数据（见 PrefsStore、HostRecord）。
 *
 * 资产存储不可用时（定制系统 / 迁移损坏）创建与读写都会抛错——调用方据此回退到内存存储，
 * 而不是让 App 起不来。
 */
export class AssetStore implements KeyValueStore {
  // 编解码走 shell/util/Bytes（平台 util 在 ArkTS 的类型系统里是 any）。

  /** 可用性探针的别名（存在与否不重要，重要的是资产服务答不答应）。 */
  private static readonly PROBE_ALIAS: string = 'dsh.probe';


  /** 探测超时：超过这个时间资产服务还没应答就视为不可用。 */
  private static readonly PROBE_TIMEOUT_MS: number = 3000;
  /**
   * 打开资产存储；不可用时回退到内存存储（凭证不持久，但壳照常可用）。
   */
  static async open(): Promise<KeyValueStore> {
    const store = new AssetStore();
    try {
      // 用「写探针」探测可用性：读一个不存在的别名在部分系统上会报错而非返回空，
      // 不能当「服务不可用」的依据。写探针成功（首次）或报「已存在」（说明服务活着）都算可用。
      const probe: asset.AssetMap = new Map<asset.Tag, asset.Value>();
      probe.set(asset.Tag.ALIAS, Bytes.encode(AssetStore.PROBE_ALIAS));
      probe.set(asset.Tag.SECRET, Bytes.encode('1'));
      probe.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
      // 探测必须带超时：资产服务在某些系统上会把请求挂住（不报错也不返回），
      // 凭证存储绝不能成为启动卡死的理由——超时就回退内存存储，壳照常启动。
      const work: Promise<void> = asset.add(probe)
        .then((): void => undefined)
        .catch((): Promise<void> => store.getString(AssetStore.PROBE_ALIAS)
          .then((): void => undefined));
      const timeout = new Promise<void>((_resolve: (value: void | PromiseLike<void>) => void,
        reject: (reason?: Error) => void) => {
        setTimeout(() => {
          reject(new Error(`探测超过 ${AssetStore.PROBE_TIMEOUT_MS}ms 未返回`));
        }, AssetStore.PROBE_TIMEOUT_MS);
      });
      await Promise.race([work, timeout]);
      return store;
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      ShellLog.error(`资产存储不可用（${message}），回退到内存存储（凭证不持久）`);
      return new MemoryKeyValueStore();
    }
  }

  async getString(key: string): Promise<string | null> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, Bytes.encode(key));
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    let results: Array<asset.AssetMap>;
    try {
      results = await asset.query(query);
    } catch (error) {
      // 这套系统对「条目不存在」抛错而不是返回空数组：读不到就当没有，
      // 否则恢复主机时查一个不存在的凭证会把整个启动炸掉（真机踩过）。
      const message = error instanceof Error ? error.message : `${error}`;
      if (message.toLowerCase().includes('not found')) {
        return null;
      }
        throw new Error(message);
    }
    if (results.length === 0) {
      return null;
    }
    const secret = results[0].get(asset.Tag.SECRET);
    if (secret === undefined) {
      return null;
    }
    const bytes = secret as Uint8Array;
    return Bytes.decode(bytes);
  }

  async putString(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.removeAlias(key);
      return;
    }
    const bytes = Bytes.encode(value);
    const attributes: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    attributes.set(asset.Tag.ALIAS, Bytes.encode(key));
    attributes.set(asset.Tag.SECRET, bytes);
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
    try {
      await asset.add(attributes);
      return;
    } catch (error) {
      // 已存在：改为覆盖（先 update，失败再 remove + add）。
    }
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, Bytes.encode(key));
    const update: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    update.set(asset.Tag.SECRET, bytes);
    try {
      await asset.update(query, update);
    } catch (error) {
      await asset.remove(query);
      await asset.add(attributes);
    }
  }

  async getBoolean(key: string, fallback: boolean): Promise<boolean> {
    const value = await this.getString(key);
    if (value === null) {
      return fallback;
    }
    return value === 'true';
  }

  async putBoolean(key: string, value: boolean): Promise<void> {
    await this.putString(key, value ? 'true' : 'false');
  }

  private async removeAlias(alias: string): Promise<void> {
    const query: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    query.set(asset.Tag.ALIAS, Bytes.encode(alias));
    try {
      await asset.remove(query);
    } catch (error) {
      // 条目本来就不存在：删除是幂等目标，失败不影响调用方语义。
    }
  }
}
