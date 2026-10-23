/**
 * apply 侧的 locale 接线：向官方 locale 服务注册本插件的双语词典，并绑定命名空间。
 *
 * 词典注册是 effect（dispose 时随插件卸载撤销）；翻译函数每个命名空间只绑一次、
 * 引用稳定，可直接下传给注册点与模板流程。
 */
import type { ClientContext } from '../bridge/ctx-types.ts'
import { en, zh } from './dictionary.ts'
import { PLUS_NAMESPACE, type PlusT } from './namespace.ts'

/**
 * 注册词典并绑定面板文案函数。
 * @param ctx - 已 inject `locale` 的 client context。
 * @returns 本插件命名空间下的翻译函数（locale 切换后仍按当前语言查表）。
 */
export function installPlusCopy(ctx: ClientContext): PlusT {
  ctx.effect(() => ctx.locale.register(PLUS_NAMESPACE, { zh, en }), 'dsh-desktop-plus: dictionaries')
  return ctx.locale.bind(PLUS_NAMESPACE)
}
