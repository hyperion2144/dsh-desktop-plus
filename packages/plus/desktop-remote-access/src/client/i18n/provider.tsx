/**
 * 面板文案的 React 分发：注册根挂 provider，页面内组件用 useRemoteAccessT() 取。
 *
 * 绑定只做一次（apply 里的 `ctx.locale.bind(namespace)`），函数引用稳定，
 * locale 切换由官方 LocaleFace revision 广播、组件重渲染即可拿到新语言。
 */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { RemoteAccessT } from './namespace.ts'

const CopyContext = createContext<RemoteAccessT | null>(null)

/** 把 apply 里绑定的翻译函数放进面板子树。 */
export function RemoteAccessI18nProvider({ t, children }: { t: RemoteAccessT; children: ReactNode }) {
  return <CopyContext.Provider value={t}>{children}</CopyContext.Provider>
}

/**
 * 当前面板子树的翻译函数。
 * @returns 注册根注入的 t。
 * @throws 在 provider 之外调用（组件树装配错误，不该静默退化成原文）。
 */
export function useRemoteAccessT(): RemoteAccessT {
  const t = useContext(CopyContext)
  if (t === null) throw new Error('[dsh-remote-access] useRemoteAccessT 必须在 RemoteAccessI18nProvider 内调用')
  return t
}
