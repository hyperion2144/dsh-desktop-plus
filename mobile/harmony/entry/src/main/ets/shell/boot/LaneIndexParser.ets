import { InjectionRow } from './InjectionRow';

/** 一段脚本正文与它在文档里的结束位置。 */
class ScriptBody {
  text: string = '';
  endIndex: number = 0;
}

/**
 * 从 lane 渲染好的 index.html 里解析出注入行。
 *
 * 为什么解析 HTML 而不是让页面直接加载 lane 的 index.html：
 *  - 页面文档必须是**壳内自带的 upstream dist**（spec #55：内置 UI 产物直接耦合 upstream web 构建）；
 *  - 但 boot graph（`__DSH_BOOT__`）与插件 bundle URL 是**主机侧运行时才有**的东西，
 *    只能从 lane 渲染结果里取（docs/agents/research/upstream-bundle-and-plugin-injection.md §2.4）。
 *
 * 解析规则（与上游渲染规则对齐，见 `upstream/packages/host/webserver/src/injections.ts`）：
 *  - `<script>` 无 src        → 内联行（facade / 全局赋值 / lane 补丁）
 *  - `<script src=…>` 无 type → 外部脚本行（上游 script-src 行不带 type；页面自己的入口模块带 `type=module`，被排除）
 *  - `<link rel=preload as=script>` → 预载提示行
 *  - 含 `__DSH_BOOT_READY__` 的行不取：就绪信号由壳自己掌管（见 rawfile/shell/boot.js 的 deferred）。
 */
export class LaneIndexParser {
  /** 解析入口。返回按文档顺序排列的注入行。 */
  parse(html: string): InjectionRow[] {
    const rows: InjectionRow[] = [];
    let cursor = 0;
    while (cursor < html.length) {
      const open = html.indexOf('<', cursor);
      if (open < 0) {
        break;
      }
      const tagEnd = html.indexOf('>', open);
      if (tagEnd < 0) {
        break;
      }
      const tag = html.substring(open, tagEnd + 1);
      if (LaneIndexParser.tagName(tag) === 'script') {
        const attributes = LaneIndexParser.attributesOf(tag);
        const body = LaneIndexParser.scriptBody(html, tagEnd + 1);
        cursor = body.endIndex;
        const src = attributes.get('src');
        if (src !== undefined && src.length > 0 && !attributes.has('type')) {
          rows.push(InjectionRow.scriptSrc(LaneIndexParser.decodeEntities(src)));
        } else if (body.text.trim().length > 0 && !body.text.includes(LaneIndexParser.READY_MARK)) {
          rows.push(InjectionRow.script(body.text));
        }
      } else if (LaneIndexParser.tagName(tag) === 'link') {
        const attributes = LaneIndexParser.attributesOf(tag);
        const rel = attributes.get('rel');
        const as = attributes.get('as');
        if (rel !== undefined && rel.toLowerCase() === 'preload' && as !== undefined && as.toLowerCase() === 'script') {
          const href = attributes.get('href');
          if (href !== undefined && href.length > 0) {
            rows.push(InjectionRow.scriptPreload(LaneIndexParser.decodeEntities(href)));
          }
        }
        cursor = tagEnd + 1;
      } else {
        cursor = tagEnd + 1;
      }
    }
    return rows;
  }

  /** 取出标签名。 */
  private static tagName(tag: string): string {
    let end = 1;
    while (end < tag.length) {
      const ch = tag.charAt(end);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '>' || ch === '/') {
        break;
      }
      end += 1;
    }
    return tag.substring(1, end).toLowerCase();
  }

  /** 取出标签属性（小写键名）。 */
  private static attributesOf(tag: string): Map<string, string> {
    const result: Map<string, string> = new Map<string, string>();
    let index = 0;
    while (index < tag.length) {
      // 属性名：从当前位置读到 '=' 或空白为止。
      const nameStart = index;
      while (index < tag.length && tag.charAt(index) !== '=' && !LaneIndexParser.isSpace(tag.charAt(index))) {
        index += 1;
      }
      if (index >= tag.length) {
        break;
      }
      if (tag.charAt(index) !== '=') {
        // 标签名之类的非属性 token：跳过它的分隔空白，继续找下一个属性。
        index += 1;
        continue;
      }
      const name = tag.substring(nameStart, index).trim().toLowerCase();
      index += 1;
      while (index < tag.length && LaneIndexParser.isSpace(tag.charAt(index))) {
        index += 1;
      }
      if (index >= tag.length) {
        break;
      }
      const quote = tag.charAt(index);
      if (quote !== '"' && quote !== '\'') {
        index += 1;
        continue;
      }
      index += 1;
      const valueStart = index;
      while (index < tag.length && tag.charAt(index) !== quote) {
        index += 1;
      }
      const value = tag.substring(valueStart, index);
      index += 1;
      if (name.length > 0) {
        result.set(name, LaneIndexParser.decodeEntities(value));
      }
    }
    return result;
  }

  /** 是否是空白字符。 */
  private static isSpace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  /** 取脚本正文与它在文档里的结束位置。 */
  /** 取脚本正文与它在文档里的结束位置。 */
  private static scriptBody(html: string, from: number): ScriptBody {
    const body = new ScriptBody();
    const close = html.indexOf('</script>', from);
    if (close < 0) {
      body.text = html.substring(from);
      body.endIndex = html.length;
      return body;
    }
    body.text = html.substring(from, close);
    body.endIndex = close + '</script>'.length;
    return body;
  }

  /** HTML 实体解码：上游渲染 script-src 时把 `&` 转义成 `&amp;`，取回时必须还原。 */
  private static decodeEntities(value: string): string {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'');
  }

  /** 上游就绪行：`(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()`。 */
  private static readonly READY_MARK: string = '__DSH_BOOT_READY__';
}
