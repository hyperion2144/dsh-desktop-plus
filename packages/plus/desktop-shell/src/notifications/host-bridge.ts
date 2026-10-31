/** Host-plugin notice bridge: wire validation, scenario mapping, policy mapping. */
//
// 宿主侧插件（desktop-plugin index.js）经宿主 IPC（plus-shell-notify）单向送来
// 通知载荷与忙心跳；本模块把它映射到通知设置 tab 的场景 id，再经场景开关与
// 策略门（decideDelivery）投递。busy-state 不是通知，由 busy-lease 消费。

import type { NotificationsConfig } from '@deepseek-ai/dsh-desktop-plus-plugin/contracts'
import { NOTIFICATION_SCENARIOS } from '../rpc/notifications-handlers.ts'
import type { PlusNotifier } from './electron.ts'
import type { NoticePolicy } from './policy.ts'

/** Wire shape of one host-plugin notice (validated at the IPC boundary). */
export interface PlusHostNotice {
	readonly type: string
	readonly body?: string
	readonly profile?: string
	readonly busy?: boolean
}

/** IPC boundary validation: exactly the fields the plugin bridge emits. */
export function isPlusHostNotice(value: unknown): value is PlusHostNotice {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	if (typeof candidate.type !== 'string' || candidate.type === '') return false
	if (candidate.body !== undefined && typeof candidate.body !== 'string') return false
	if (candidate.profile !== undefined && typeof candidate.profile !== 'string') return false
	if (candidate.busy !== undefined && typeof candidate.busy !== 'boolean') return false
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

/** Projects the persisted notifications config onto the notifier's policy gate. */
export function noticePolicyFromConfig(config: NotificationsConfig): NoticePolicy {
	return {
		scenes: { host: true, download: true, update: true, generic: true },
		doNotDisturb: config.dnd.on === true,
		fullscreenSilent: config.dnd.suppressFullscreen !== false,
		sound: 'default',
	}
}

const scenarioOn = (config: NotificationsConfig, id: string): boolean => {
	const meta = NOTIFICATION_SCENARIOS.find((entry) => entry.id === id)
	return (config.scenarios[id]?.enabled ?? meta?.defaultOn ?? true) !== false
}

export interface HostNoticeDeps {
	/** The policy-gated notifier (createPlusNotifier). */
	notifier: PlusNotifier
	/** Current persisted notifications config; re-read on every notice. */
	config: () => NotificationsConfig
}

/**
 * Deliver one host notice through scenario gates and the notifier's policy gate.
 * @returns Whether the notice was delivered; false means dropped (never queued).
 */
export function deliverHostNotice(deps: HostNoticeDeps, notice: PlusHostNotice): boolean {
	if (notice.type === 'busy-state') return false
	const config = deps.config()
	if (config.enabled === false) return false
	const scenario = PLUS_NOTICE_SCENARIOS[notice.type]
	if (scenario === undefined || !scenarioOn(config, scenario)) return false
	return deps.notifier.deliver('host', {
		title: PLUS_NOTICE_TITLES[notice.type] ?? 'DeepSeek Harness',
		body: notice.body ?? '',
	})
}
