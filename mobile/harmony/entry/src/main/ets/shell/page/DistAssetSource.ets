import { resourceManager } from '@kit.LocalizationKit';
import { Bytes } from '../util/Bytes';
import { ShellLog } from '../ShellLog';

/**
 * 壳内自带的移动变体 dist（构建产物，由 tools/sync-web-dist.sh 同步进 rawfile）。
 *
 * 壳把它当作**本地资产**提供：页面从壳的回环 origin 加载它，不出壳。
 */
export class DistAssetSource {
  private readonly manager: resourceManager.ResourceManager;
  /** 引导脚本（rawfile/shell/boot.js），页面在 document-start 取注入行与传输配置。 */
  /** 已读入的资产缓存（页面对同一资产的请求会反复出现，读盘只在首次发生）。 */
  private readonly cache: Map<string, Uint8Array> = new Map();
  private bootScriptText: string = '';

  constructor(manager: resourceManager.ResourceManager) {
    this.manager = manager;
  }

  /** 预读引导脚本（页面装载前调一次）。 */
  async loadBootScript(): Promise<void> {
    const bytes = await this.readRawFile(DistAssetSource.BOOT_SCRIPT_PATH);
    if (bytes === null) {
      ShellLog.warn('引导脚本缺失：rawfile 里没有 shell/boot.js');
      this.bootScriptText = '';
      return;
    }
    this.bootScriptText = Bytes.decode(bytes);
  }

  /** 引导脚本文本。 */
  bootScript(): string {
    return this.bootScriptText;
  }

  /**
   * 读一个 dist 里的文件。
   *
   * @param relativePath 相对 dist 根的路径（不带前导 `/`）。
   * @returns 文件内容；不存在时返回 null。
   */
  async read(relativePath: string): Promise<Uint8Array | null> {
    if (relativePath.length === 0 || relativePath.includes('..')) {
      return null;
    }
    // 同一资产在页面加载期会被反复请求：首次读盘后进缓存，后续全内存命中。
    const key = `${DistAssetSource.DIST_DIR}/${relativePath}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const bytes = await this.readRawFile(key);
    if (bytes !== null) {
      this.cache.set(key, bytes);
    }
    return bytes;
  }
  /**
   * 页面文档：dist 的 index.html，并把引导脚本内联到 `<head>` 之后。
   *
   * 为什么要内联：ArkWeb 没有 Android 那种「document-start 注入」钩子，
   * 而上游客户端入口在 `run()` 里读 `window.__ModuleLoader__` 与 `globalThis.__DSH_BOOT__`
   *（`upstream/packages/client/web/src/boot.ts`）——引导脚本必须**早于任何页面脚本**跑。
   * 内联到 `<head>` 的第一处正好满足这个次序。
   */
  async document(): Promise<Uint8Array | null> {
    const html = await this.read(DistAssetSource.DOCUMENT_NAME);
    if (html === null) {
      return null;
    }
    const text = Bytes.decode(html);
    const injected = DistAssetSource.injectBootScript(text, this.bootScriptText);
    return Bytes.encode(injected);
  }

  /** 把引导脚本内联进 HTML。 */
  static injectBootScript(html: string, script: string): string {
    if (script.length === 0) {
      return html;
    }
    const at = DistAssetSource.headEnd(html);
    if (at < 0) {
      return html;
    }
    const inline = `<script>\n${script}\n</script>\n`;
    return `${html.substring(0, at)}${inline}${html.substring(at)}`;
  }

  /** 找 `<head…>` 的结束位置；没有 head 就找 `<html…>`，再没有就返回 -1。 */
  private static headEnd(html: string): number {
    const lower = html.toLowerCase();
    const headAt = lower.indexOf('<head');
    if (headAt >= 0) {
      const end = html.indexOf('>', headAt);
      return end < 0 ? -1 : end + 1;
    }
    const htmlAt = lower.indexOf('<html');
    if (htmlAt >= 0) {
      const end = html.indexOf('>', htmlAt);
      return end < 0 ? -1 : end + 1;
    }
    return -1;
  }

  /** 读一个 rawfile。 */
  private async readRawFile(path: string): Promise<Uint8Array | null> {
    try {
      // 异步读：同步版会在主线程卡住整颗 WebView 的加载（实机踩过 appfreeze）。
      return await this.manager.getRawFileContent(path);
    } catch (error) {
      return null;
    }
  }

  /** 按扩展名给 MIME 类型。 */
  static mimeTypeOf(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith('.html')) {
      return 'text/html; charset=utf-8';
    }
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
      return 'application/javascript; charset=utf-8';
    }
    if (lower.endsWith('.css')) {
      return 'text/css; charset=utf-8';
    }
    if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) {
      return 'application/json; charset=utf-8';
    }
    if (lower.endsWith('.map')) {
      return 'application/json; charset=utf-8';
    }
    if (lower.endsWith('.svg')) {
      return 'image/svg+xml';
    }
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.ico')) {
      return 'image/x-icon';
    }
    if (lower.endsWith('.woff2')) {
      return 'font/woff2';
    }
    if (lower.endsWith('.woff')) {
      return 'font/woff';
    }
    if (lower.endsWith('.ttf')) {
      return 'font/ttf';
    }
    return 'application/octet-stream';
  }

  /** 壳内 dist 在 rawfile 下的目录名。 */
  static readonly DIST_DIR: string = 'dist';

  /** 页面文档在 dist 里的文件名。 */
  static readonly DOCUMENT_NAME: string = 'index.html';

  /** 引导脚本在 rawfile 下的路径。 */
  private static readonly BOOT_SCRIPT_PATH: string = 'shell/boot.js';
}
