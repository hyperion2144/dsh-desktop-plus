// #116 通知投递层：触发源报边沿，这里决定要不要弹、怎么弹、弹什么。
// 活跃门语义（dsh-notify-me 同款区分）：
//   - 当前会话的等待：页面看得见（审批卡就在眼前）就不弹；
//   - 后台会话的等待：哪怕页面活跃也弹——它的卡你看不见；
//   - 回复完成：页面活跃（visible 且聚焦）就不弹，通知是给离开的人。
import type { ClientContext } from '../bridge/ctx-types.ts'
import { jumpToSession } from './jump.ts'
import { listStoreOf, sessionTitleOf } from './services.ts'

/** 通知标题兜底与正文语料。 */
const NOTIFY_TITLES: Record<string, string> = {
  'task-complete': '任务已完成',
  'dsh-approval': '等待你的操作',
}
/** 待交互标题按交互域 kind 细分（dsh-notify-me 同款）。 */
const ATTENTION_KIND_TITLES: Record<string, string> = {
  approval: '等待你的审批确认',
  'plan-review': '方案待确认',
  question: '等待你的回答',
}

const KIND_TEXT: Record<string, string> = {
  error: '回合异常结束',
  blocked: '回合被阻塞',
  'max-tokens': '回合达到 token 上限',
  interrupted: '回合被打断',
  done: '回复已完成',
}
const MAX_SUMMARY_CHARS = 200
/** 通道故障告警节流：避免 fetch 失败时每条通知刷两行 warn。 */
const CHANNEL_WARN_INTERVAL_MS = 60_000
/** 活动门：页面可见且聚焦 = 用户正看着，完成通知不打扰。 */

const isPageActive = (): boolean => document.visibilityState === 'visible' && document.hasFocus()

/**
 * 创建投递器。所有对外方法异步、内部吞错（通知失败不反噬页面）。
 * @param ctx - browser cordis context（取会话标题用）。
 */
let channelWarnedAt = 0
const warnChannel = (where: string, error: string): void => {
  const now = Date.now()
  if (now - channelWarnedAt < CHANNEL_WARN_INTERVAL_MS) return
  channelWarnedAt = now
  console.warn(`[dsh-desktop-plus] 通知通道异常（${where}）：${error}`)
}

const notifyFetch = async (path: string, init?: RequestInit): Promise<unknown> => {
  try {
    const response = await fetch(path, init)
    return await response.json() as unknown
  } catch (error) {
    warnChannel(path, String(error))
    return null
  }
}

/**
 * 试听（#117 实测口径）：直接触发一次真实通知——同 payload、同一投递链路、同音效档，
 * 试到的横幅形态 / 声音 / 免打扰表现就是实际行为，不再单独实现预览音逻辑。
 * @param sound - 当前选中音效档（default / none / 自定义名）。
 * @returns 失败文案；成功为 null。
 */
export async function previewNotification(sound: string): Promise<string | null> {
  const title = 'DSH 通知试听'
  const body = '这就是通知实际的样子：横幅形态、声音与免打扰表现与正式通知一致'
  const cfg = await notifyFetch('/__dsh-plus/notify-config?scenario=preview') as { native?: boolean } | null
  if (cfg?.native === true) {
    const result = await notifyFetch('/__dsh-plus/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-plus-notify': '1' },
      body: JSON.stringify({ type: 'preview', title, body, sound }),
    }) as { ok?: boolean; reason?: string } | null
    if (result?.ok !== true) return `toast 投递失败：${JSON.stringify(result)}`
    return null
  }
  try {
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return '通知权限不可用'
    const notification = new Notification(title, { body, silent: sound !== 'default' })
    notification.onclick = () => { notification.close() }
    if (sound !== 'default' && sound !== 'none') {
      await notifyFetch('/__dsh-plus/play-sound', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sound }) })
    }
    return null
  } catch (error) {
    return `通知创建失败：${String(error)}`
  }
}

export function createNotifyDeliver(ctx: ClientContext): {
  attention: (kind: string, sessionId: string, detail: string, isCurrent: boolean) => Promise<void>
  done: (sessionId: string, isCurrent: boolean) => Promise<void>
} {

  /**
   * 投一条通知：设置门（宿主 decideNotify）→ Windows 原生 toast / Web Notification。
   * @param type - 场景类型（task-complete / dsh-approval）。
   */
  const postNotify = async (type: string, title: string, body: string, sessionId?: string): Promise<void> => {
    const cfg = await notifyFetch(`/__dsh-plus/notify-config?scenario=${encodeURIComponent(type)}`) as { allow?: boolean; sound?: string; native?: boolean } | null
    if (cfg === null) return
    if (cfg.allow !== true) {
      console.info(`[dsh-desktop-plus] 通知被设置拒绝：${type}`)
      return
    }
    const sound = cfg.sound ?? 'default'
    if (cfg.native === true) {
      // Windows：宿主 PowerShell 原生 toast（系统音 + 协议点击，系统免打扰管控声音）。
      const result = await notifyFetch('/__dsh-plus/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-plus-notify': '1' },
        body: JSON.stringify({ type, title, body, sessionId }),
      }) as { ok?: boolean; delivered?: boolean; reason?: string } | null
      if (result?.ok !== true) console.warn(`[dsh-desktop-plus] toast 投递失败：${JSON.stringify(result)}`)
      else console.info(`[dsh-desktop-plus] toast 已投递：${type} sound=${sound}`)
      return
    }
    // macOS/Linux/浏览器/Win10 回退：页面 Web Notification（系统横幅+系统音，
    // 系统免打扰管控），点击手势跳会话；自定义音效经宿主自播（macOS 受静音探针门）。
    try {
      if (typeof Notification === 'undefined' || Notification.permission === 'denied') {
        console.warn('[dsh-desktop-plus] 通知权限不可用，横幅被浏览器拒绝')
        return
      }
      const notification = new Notification(title, { body, tag: `dsh-plus-${type}`, silent: sound !== 'default' })
      notification.onclick = () => { notification.close(); jumpToSession(ctx, sessionId) }
      console.info(`[dsh-desktop-plus] 通知已创建：${type} sound=${sound}`)
      if (sound !== 'default' && sound !== 'none') {
        await notifyFetch('/__dsh-plus/play-sound', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sound }) })
      }
    } catch (error) {
      console.warn(`[dsh-desktop-plus] 通知创建失败：${String(error)}`)
    }
  }

  /** 待交互通知：kind → 标题，detail → 正文，会话名作前缀。 */
  const attention = async (kind: string, sessionId: string, detail: string, isCurrent: boolean): Promise<void> => {
    if (isCurrent && isPageActive()) return
    const list = listStoreOf(ctx)
    const title = ATTENTION_KIND_TITLES[kind] ?? NOTIFY_TITLES['dsh-approval'] ?? '等待你的操作'
    const sessionName = list !== null ? sessionTitleOf(list, sessionId) : ''
    const body = `${sessionName !== '' ? `${sessionName}：` : ''}${detail !== '' ? detail : '需要你确认或回答'}`
    await postNotify('dsh-approval', title, body, sessionId)
  }

  /** 回复完成通知：宿主摘要路由取正文（最后回复文本 / 回合终态）。 */
  const done = async (sessionId: string, isCurrent: boolean): Promise<void> => {
    if (isPageActive()) return
    const digest = await notifyFetch(`/__dsh-plus/notify-summary?session=${encodeURIComponent(sessionId)}`) as { summary?: string; kind?: string; error?: string } | null
    const kind = digest?.kind ?? 'done'
    const error = digest?.error ?? ''
    const summary = digest?.summary ?? ''
    const body = kind === 'error' && error !== ''
      ? `${KIND_TEXT[kind] ?? '回合异常结束'}：${error}`.slice(0, MAX_SUMMARY_CHARS)
      : (summary !== '' ? summary : KIND_TEXT[kind] ?? '回复已完成').slice(0, MAX_SUMMARY_CHARS)
    const list = listStoreOf(ctx)
    const sessionName = list !== null ? sessionTitleOf(list, sessionId) : ''
    const title = sessionName !== '' ? sessionName.slice(0, 30) : NOTIFY_TITLES['task-complete'] ?? '任务已完成'
    await postNotify('task-complete', title, body, sessionId)
  }


  return { attention, done }
}
