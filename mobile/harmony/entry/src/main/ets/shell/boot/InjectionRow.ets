/**
 * 一条注入行。
 *
 * 与 upstream 的 `IndexInjection`（`upstream/packages/host/webserver/src/injections.ts`）同构的
 * 最小子集——本票只需要「脚本 / 外部脚本 / 预载提示」三类承载：
 *
 *  - `script`         内联脚本：模块加载 facade（`__ModuleLoader__`）、`__DSH_BOOT__` 全局赋值等
 *  - `script-src`     外部脚本：bootstrap 阶段的插件 combo（文档相对，形如 `plugins/??…&rev=…`）
 *  - `script-preload` 提示性预载：application 阶段的 combo 预载
 *
 * 上游还有 `style` / `html` 两类，本票的页面渲染不需要，故不建模。
 *
 * 三类用同一个类承载（`kind` 区分），而不是三个类 + 联合类型：
 * ArkTS 的对象联合类型只对类成立，用一个类 + 一个判别字段更省事也更好序列化。
 */
export class InjectionRow {
  /** 行类别：script / script-src / script-preload。 */
  kind: string = '';
  /** 内联脚本正文（kind=script 时有意义）。 */
  text: string = '';
  /** 外部脚本地址（kind=script-src / script-preload 时有意义）。 */
  src: string = '';

  /** 内联脚本行。 */
  static script(text: string): InjectionRow {
    const row = new InjectionRow();
    row.kind = 'script';
    row.text = text;
    return row;
  }

  /** 外部脚本行。 */
  static scriptSrc(src: string): InjectionRow {
    const row = new InjectionRow();
    row.kind = 'script-src';
    row.src = src;
    return row;
  }

  /** 提示性预载行。 */
  static scriptPreload(src: string): InjectionRow {
    const row = new InjectionRow();
    row.kind = 'script-preload';
    row.src = src;
    return row;
  }
}
