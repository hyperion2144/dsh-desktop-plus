/**
 * 面板文案的 React 分发：注册根挂 provider，卡片与外壳件用 usePlusT() 取。
 *
 * 绑定只做一次（apply 里的 `ctx.locale.bind(namespace)`），函数引用稳定，
 * locale 切换由官方 LocaleFace revision 广播、组件重渲染即可拿到新语言。
 */
import { createContext, useContext } from 'react'
import type React from 'react'
import type { PlusT } from './namespace.ts'

const PlusCopyContext = createContext<PlusT | null>(null)

/** 把 apply 里绑定的翻译函数放进面板子树。 */
export function PlusI18nProvider({ t, children }: { t: PlusT; children: React.ReactNode }): React.ReactElement {
  return <PlusCopyContext.Provider value={t}>{children}</PlusCopyContext.Provider>
}

/**
 * 当前面板子树的翻译函数。
 * @returns 注册根注入的 t。
 * @throws 在 provider 之外调用（组件树装配错误，不该静默退化成原文）。
 */
export function usePlusT(): PlusT {
  const t = useContext(PlusCopyContext)
  if (t === null) throw new Error('[dsh-desktop-plus] usePlusT 必须在 PlusI18nProvider 内调用')
  return t
}
