/**
 * 移动端更新源（channel yml）的轻量解析。
 *
 * ## 更新源是什么
 *
 * 鸿蒙壳不随发版（没有自有产物元数据），因此**借用同一条版本线的 android 元数据**
 * 当版本信号：`nightly-android.yml`（GitHub Release 资产直链，不走 api.github.com 的额度池）。
 * 它与桌面 channel yml 逐字同形（由 `scripts/plus/mobile-metadata.mjs` 的
 * `renderChannelMetadata` 生成）：
 *
 * ```
 * version: <plus 版本>
 * files:
 *   - url: <产物文件名>
 *     sha512: <产物 sha512（base64）>
 *     size: <产物流字节数>
 * path: <产物文件名>
 * sha512: <产物 sha512（base64）>
 * releaseDate: '<ISO 时间>'
 * ```
 *
 * ## 为什么自己解析而不上 yaml 库
 *
 * 键结构是**固定的**（见上），文件只有几百字节，为它引入一个 YAML 依赖不划算：
 * 壳的依赖面越小，HAP 越小、攻击面越小。解析器只认上面那几个键，
 * 其余行（注释、空行、未知键）一律忽略。
 *
 * 纯函数（不碰平台 API），因此可以在 node 下单独对拍（`mobile/harmony/tools/parity-check.mjs`）。
 */

/** 解析出的 channel 元数据。 */
export class ChannelMetadata {
  /** plus 版本号（`version:` 键）。 */
  version: string = '';
  /** 产物文件名（`files[].url`）。 */
  fileName: string = '';
}

/**
 * 解析 channel yml 文本。
 *
 * @param text yml 全文
 * @returns 解析结果；文本不成形（没有 `version:` 键）时返回 null
 */
export function parseChannelMetadata(text: string): ChannelMetadata | null {
  const metadata: ChannelMetadata = new ChannelMetadata();
  let inFiles: boolean = false;
  const lines: string[] = text.split('\n');
  for (const rawLine of lines) {
    const line: string = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    // 缩进决定层级：顶格是顶层键（`files` 列表到此结束），缩进的是列表项或列表项的属性。
    const indented: boolean = rawLine.length > 0 && rawLine.startsWith(' ');
    if (!indented) {
      inFiles = false;
      if (line.startsWith('version:')) {
        metadata.version = unquote(line.substring('version:'.length).trim());
      } else if (line.startsWith('files:')) {
        inFiles = true;
      }
      continue;
    }
    if (!inFiles) {
      continue;
    }
    if (line.startsWith('- url:')) {
      metadata.fileName = unquote(line.substring('- url:'.length).trim());
    }
  }
  if (metadata.version.length === 0) {
    return null;
  }
  return metadata;
}

/**
 * 只取版本号的便捷入口（更新检查只需要版本信号）。
 *
 * @param text yml 全文
 * @returns plus 版本号；取不到时返回空串
 */
export function parseChannelVersion(text: string): string {
  const metadata: ChannelMetadata | null = parseChannelMetadata(text);
  return metadata === null ? '' : metadata.version;
}

/** 剥掉值两侧的引号（releaseDate 一定是带引号的 ISO 串）。 */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first: string = value.charAt(0);
    const last: string = value.charAt(value.length - 1);
    if ((first === '\'' && last === '\'') || (first === '"' && last === '"')) {
      return value.substring(1, value.length - 1);
    }
  }
  return value;
}
