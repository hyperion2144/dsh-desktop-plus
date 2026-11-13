/** Host-plugin notice bridge: wire validation, scenario mapping, and the decide()-gated delivery. */
//
// 宿主侧插件（desktop-plugin index.js）经宿主 IPC（plus-shell-notify）单向送来
// 通知载荷与忙心跳；本模块把宿主事件映射到通知设置 tab 的场景 id，经富决策引擎
// （sound/notify-policy 的 decide：总开关/场景开关/聚焦/免打扰时段/每场景音效）投递。
// busy-state 不是通知，由 busy-lease 消费。

import type { NotificationsConfig } from '@deepseek-ai/dsh-desktop-plus-plugin/contracts'
import { decide, localHm } from '../sound/notify-policy.ts'
import type { NoticeClickTarget, PlusNotifier } from './electron.ts'
import type { NoticeContext, NoticePolicy } from './policy.ts'

/** Wire shape of one host-plugin notice (validated at the IPC boundary). */
export interface PlusHostNotice {
	readonly type: string
	readonly body?: string
	readonly profile?: string
	readonly busy?: boolean
	/** 发起通知的会话（#116：点击横幅跳回它的关键）；缺省 → 点击只叫窗口。 */
	readonly sessionId?: string
	/** 宿主侧已知的会话名（审批路径可得，turn/end 常不可用）；缺省 → 回落场景固定文案。 */
	readonly title?: string
}

/** IPC boundary validation: exactly the fields the plugin bridge emits. */
export function isPlusHostNotice(value: unknown): value is PlusHostNotice {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.type !== 'string' || candidate.type === '') return false
	if (candidate.body !== undefined && typeof candidate.body !== 'string') return false
	if (candidate.profile !== undefined && typeof candidate.profile !== 'string') return false
	if (candidate.busy !== undefined && typeof candidate.busy !== 'boolean') return false
	if (candidate.sessionId !== undefined && typeof candidate.sessionId !== 'string') return false
	if (candidate.title !== undefined && typeof candidate.title !== 'string') return false
	return true
}

/** Host event type → notifications-tab scenario id (must exist in NOTIFICATION_SCENARIOS). */
export const PLUS_NOTICE_SCENARIOS: Readonly<Record<string, string>> = {
	'task-complete': 'task.complete',
	'dsh-approval': 'dsh.approval',
	'dsh-error': 'dsh.error',
}

const PLUS_NOTICE_TITLES: Readonly<Record<string, string>> = {
	'task-complete': '任务已完成',
	'dsh-approval': '等待你的审批',
	'dsh-error': '会话出错',
}

/** 会话名提示截 30 字（dsh-pet 同口径）：横幅一行放不下长会话名。 */
const truncateTitle = (value: string): string => (value.length > 30 ? value.slice(0, 30) : value)

/** Projects the persisted notifications config onto the notifier's policy gate. */
export function noticePolicyFromConfig(config: NotificationsConfig): NoticePolicy {
	return {
		scenes: { host: true, download: true, update: true, generic: true },
		doNotDisturb: config.dnd.on === true,
		fullscreenSilent: config.dnd.suppressFullscreen !== false,
		sound: 'default',
	}
}

export interface HostNoticeDeps {
	/** The policy-gated notifier (createPlusNotifier). */
	notifier: PlusNotifier
	/** Current persisted notifications config; re-read on every notice. */
	config: () => NotificationsConfig
	/** 投递时窗口上下文（聚焦/全屏）；与 notifier 的 context 同源，decide() 消费。 */
	context: () => NoticeContext
	/** 可注入时钟（测试确定性）；缺省取当前时刻。 */
	now?: () => Date
}

/**
 * Deliver one host notice through the rich decision engine (decide): master
 * switch, scenario gate, focus drop, dnd window (deliver-but-silent), and the
 * per-scenario sound choice.
 * @param deps - notifier, config, and window-context providers.
 * @param notice - the IPC-validated host notice.
 * @returns Whether the notice was delivered; false means dropped (never queued).
 */
export function deliverHostNotice(deps: HostNoticeDeps, notice: PlusHostNotice): boolean {
	if (notice.type === 'busy-state') return false
	const scenario = PLUS_NOTICE_SCENARIOS[notice.type]
	if (scenario === undefined) return false
	const view = deps.context()
	const decision = decide(deps.config(), scenario, localHm(deps.now?.() ?? new Date()), view.fullscreen, view.windowFocused)
	if (!decision.deliver) return false
	const title = notice.title !== undefined && notice.title !== ''
		? truncateTitle(notice.title)
		: PLUS_NOTICE_TITLES[notice.type] ?? 'DeepSeek Harness'
	const clickTarget: NoticeClickTarget | undefined = notice.sessionId === undefined && notice.profile === undefined
		? undefined
		: {
			...(notice.sessionId !== undefined ? { sessionId: notice.sessionId } : {}),
			...(notice.profile !== undefined ? { profile: notice.profile } : {}),
		}
	return deps.notifier.deliverDecided({
		title,
		body: notice.body ?? '',
		sound: decision.sound,
		...(clickTarget === undefined ? {} : { click: clickTarget }),
	})
}
