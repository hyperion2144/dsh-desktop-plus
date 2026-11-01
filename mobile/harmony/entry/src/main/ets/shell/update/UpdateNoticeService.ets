import { LaneHttpClient, LaneRequest } from '../net/LaneHttpClient';
import { parseChannelVersion } from './ChannelFeed';
import { isNewer } from './MobileVersion';
import { ShellPreferences } from '../store/ShellPreferences';
import { ShellLog } from '../ShellLog';

/** 一次更新检查的结论。 */
export class UpdateNotice {
  /** 远端版本号（如 `0.2.2-alpha.2.plus.2`）。 */
  version: string = '';
  /** 下载页地址。 */
  url: string = '';
}

/**
 * 更新提醒（**仅跳转形态**）。
 *
 * 鸿蒙平台不支持应用内安装（没有系统安装器可拉起），所以这一屏只做两件事：
 *  1. 查一次更新源（GitHub Release 上的 `nightly-android.yml`），比出版本号；
 *  2. 给一个「前往下载页」的动作——**跳转到应用市场测试渠道或 Releases 页**。
 *
 * ## 更新源为什么是 android 的元数据
 *
 * 鸿蒙壳不随发版（没有自有的产物元数据），但它与 android 壳**同一条版本线**：
 * 因此借用同一条线上的 `nightly-android.yml` 当版本信号——文件里只有 `version:` 一行关键信息，
 * 解析是轻量的（固定键结构，见 `ChannelFeed.ets`）。
 *
 * 检查走 Release 资产直链（**不走 api.github.com**——后者有 60 次/小时的额度池，
 * 启动检查不能消耗它，与桌面同一策略）。
 *
 * ## 提醒语义
 *
 * 开关 / 拉黑版本 / 已提醒最高版本从偏好读出（语义复用桌面 update-notice 契约
 * `packages/plus/desktop-plugin/contracts/updates.ts` 的 `UpdateNoticeState`）。
 */
export class UpdateNoticeService {
  private readonly client: LaneHttpClient;
  private readonly preferences: ShellPreferences;

  constructor(client: LaneHttpClient, preferences: ShellPreferences) {
    this.client = client;
    this.preferences = preferences;
  }

  /**
   * 检查有没有新版本。
   *
   * 判定顺序与桌面 update-notice 契约同款：
   *  1. 开关关 → 不提醒；
   *  2. 该版本被拉黑 → 不提醒；
   *  3. 不比本机已装版本新 → 不提醒；
   *  4. 不比「已提醒最高版本」新 → 不重复提醒；
   *  5. 其余 → 提醒（「已提醒」由界面在把提醒显示出来时记下，见 `markNotified`）。
   *
   * 拉不到更新源时**静默降级**：更新提醒是锦上添花，不该因为查不到就把用户挡住。
   *
   * @param currentVersion 壳当前的版本号。
   * @returns 有新版本时返回提醒；没有或查不到时返回 null。
   */
  async check(currentVersion: string): Promise<UpdateNotice | null> {
    if (!await this.preferences.updateReminderEnabled()) {
      return null;
    }
    const latest: string = await this.fetchVersion();
    if (latest.length === 0) {
      return null;
    }
    if ((await this.preferences.ignoredUpdateVersions()).includes(latest)) {
      return null;
    }
    if (!UpdateNoticeService.newerThan(latest, currentVersion)) {
      return null;
    }
    const notified: string | null = await this.preferences.lastNotifiedUpdateVersion();
    if (notified !== null && notified.length > 0 && !UpdateNoticeService.newerThan(latest, notified)) {
      return null;
    }
    const notice: UpdateNotice = new UpdateNotice();
    notice.version = latest;
    notice.url = UpdateNoticeService.RELEASES_PAGE;
    ShellLog.info(`发现新版本：${latest}`);
    return notice;
  }

  /** 拉黑某个版本（「不再提示此版本」）。 */
  async ignore(version: string): Promise<void> {
    await this.preferences.addIgnoredUpdateVersion(version);
    ShellLog.info(`不再提示此版本：${version}`);
  }

  /**
   * 记下「已经提醒过这个版本」。
   *
   * 由**界面**在把提醒真正显示出来时调用：检查本身不记（后台那次检查不该把提醒吃掉）。
   */
  async markNotified(version: string): Promise<void> {
    await this.preferences.setLastNotifiedUpdateVersion(version);
  }

  /**
   * 拉一次更新源，取出版本号。
   *
   * 失败（没网 / 非 200 / 文本不成形）一律返回空串——调用方据此当作「没有更新」。
   */
  private async fetchVersion(): Promise<string> {
    const headers: Map<string, string> = new Map<string, string>();
    headers.set('Accept', 'text/yaml, text/plain, */*');
    let text: string = '';
    try {
      const response = await this.client.send(
        new LaneRequest(UpdateNoticeService.FEED, 'GET', null, headers, null));
      if (response.status !== 200) {
        return '';
      }
      text = response.text();
    } catch (error) {
      ShellLog.warn('检查更新失败：无法访问更新源');
      return '';
    }
    return parseChannelVersion(text);
  }

  /**
   * 版本号比较：SemVer 优先级（与 Android 壳同一套规则，见 `MobileVersion.ets`）。
   *
   * 版本串不合法时**当作没有更新**（返回 false）：更新提醒错了不会有人报错，
   * 只会一直不提示——宁可漏提醒，不可错提醒。
   */
  private static newerThan(candidate: string, current: string): boolean {
    try {
      return isNewer(candidate, current);
    } catch (error) {
      ShellLog.warn(`更新版本号无法比较：${candidate} / ${current}`);
      return false;
    }
  }

  /**
   * 更新源：GitHub Release 上的移动端 channel 元数据（资产直链，不走 api.github.com）。
   *
   * 鸿蒙不随发版，借用同一条版本线的 android 元数据当版本信号。
   */
  static readonly FEED: string =
    'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest/download/nightly-android.yml';

  /** 跳转目标：Releases 页（鸿蒙走应用市场测试渠道，页面上有对应说明）。 */
  static readonly RELEASES_PAGE: string = 'https://github.com/hyperion2144/dsh-desktop-plus/releases/latest';
}
