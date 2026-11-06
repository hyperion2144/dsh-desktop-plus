// #116 桌面通知装配（页面半区）。
// 触发（source：服务快照存储边沿）与投递（deliver：活跃门 + 设置门 + 横幅/声音）
// 分离，点击跳转（jump）共享。替换旧版对宿主事件 `session/event` 的页面订阅——
// 浏览器端不存在该事件，是上一版通知静默的根因。
// 点击跳转（#116 直通）：Windows toast 点击走协议激活 → 壳 second-instance 路由窗口 +
// executeJavaScript 调 __dshPlusFocusSession；页面侧不再有轮询与记录消费。
import type { ClientContext } from '../bridge/ctx-types.ts'
import { createNotifyDeliver } from './deliver.ts'
import { installFocusSessionGlobal } from './jump.ts'
import { installNotifySource } from './source.ts'

/**
 * 安装桌面通知（幂等性由插件装载周期保证：每次 apply 一次）。
 * @param ctx - browser cordis context。
 */
export function installDesktopNotify(ctx: ClientContext): void {
  installFocusSessionGlobal(ctx)
  const deliver = createNotifyDeliver(ctx)
  installNotifySource(ctx, {
    onAttention: (kind, sessionId, detail, isCurrent) => {
      void deliver.attention(kind, sessionId, detail, isCurrent)
    },
    onDone: (sessionId, isCurrent) => {
      void deliver.done(sessionId, isCurrent)
    },
  })
}
