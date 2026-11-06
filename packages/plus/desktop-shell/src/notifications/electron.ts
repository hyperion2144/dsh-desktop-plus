/** Electron wiring: policy-gated system notifications plus the Windows AUMID fix. */

import { spawn } from 'node:child_process'
import { app, Notification } from 'electron'
import type { SoundChoice } from '../sound/notify-policy.ts'
import type { NoticeContext, NoticePolicy, NoticeScene } from './policy.ts'
import { decideDelivery } from './policy.ts'
import { systemDefaultSoundCommand } from '../sound/playback.ts'
import type { SoundFileFacts, SoundValidation } from './sound.ts'
import { validateSoundFile } from './sound.ts'
/**
 * Windows notification banners show this app's name instead of the process
 * name. Must match the packaged appId (electron-builder config).
 */
export const PLUS_APP_USER_MODEL_ID = 'io.github.hyperion2144.dsh.plus'


/**
 * 非 macOS 默认音内置兑底（与试听同一后端源 playback）：Electron 的 Windows/Linux
 * 通知通道不带音频（旧壳 PR #100 真机结论），壳不自己放就是「通知弹了、没声」。
 * 异步起进程不阻塞投递；后端缺席/启动失败静默（返回 false），通知本体已展示。
 */
function playSystemToneFallback(log?: (line: string) => void): boolean {
	const command = systemDefaultSoundCommand(process.platform)
	if (command === null) { log?.(`default tone unavailable on ${process.platform}`); return false }
	const binary = command[0]
	if (binary === undefined) return false
	try {
		const child = spawn(binary, command.slice(1), { stdio: 'ignore' })
		child.on('error', (error: Error) => { log?.(`default tone spawn error: ${error.message}`) })
		log?.(`default tone dispatched: ${command.join(' ')}`)
		return true
	} catch (error) {
		log?.(`default tone spawn failed: ${error instanceof Error ? error.message : String(error)}`)
		return false
	}
}

/** Apply the AUMID on Windows; a no-op elsewhere. Call before any notification. */
export function applyWindowsAppUserModelId(): void {
	if (process.platform === 'win32') app.setAppUserModelId(PLUS_APP_USER_MODEL_ID)
}

/** Construction seam so tests can fake Electron's Notification. */
export type NotificationFactory = (options: { title: string; body: string; sound?: string; silent?: boolean }) => {
	show(): void
	on?(event: string, listener: () => void): unknown
}

export interface NotifierDeps {
	/** Current user policy; re-read on every deliver(). */
	policy: () => NoticePolicy
	/** Live window/desktop context; re-read on every deliver(). */
	context: () => NoticeContext
	/** Non-macOS default-sound fallback (Electron only carries `sound` on macOS). */
	beep?: () => void
	/** Defaults to Electron's Notification; tests inject a recorder. */
	createNotification?: NotificationFactory
	/** 自定义音效播放（deliverDecided 消费）：返回是否真的启动了播放；缺席 = 本机不可用，静默降级。 */
	playCustomSound?: (name: string) => boolean
	/** 系统级免打扰/静音通知探针（#116 自播压制）：true = 本机系统静音生效，自播音效跳过；缺席 = 不探测。 */
	systemMuted?: () => boolean
	/** 横幅点击的路由器（壳侧注入：腿一聚焦 profile 窗口，腿二页面定位会话）。 */
	onClickRoute?: (target: NoticeClickTarget) => void
	/** 投递链诊断日志：默认音派发/失败时落一条（真机没声时的证据）。 */
	log?: (line: string) => void
}


/** 点击横幅的路由目标：宿主事件桥透传的会话与 profile（都可缺省 → 只叫窗口）。 */
export interface NoticeClickTarget {
	sessionId?: string
	profile?: string
}
export interface PlusNotifier {
	/** Deliver if policy allows; false when the gate dropped it (never queued). */
	deliver(scene: NoticeScene, options: { title: string; body?: string }): boolean
	/** 已决策投递（#116）：宿主场景经 decide() 定门与音效后走这里——只负责呈现、声音与 click。 */
	deliverDecided(options: { title: string; body?: string; sound: SoundChoice; click?: NoticeClickTarget }): boolean
}
/**
 * Policy gate over Electron's system Notification — the official channel, no
 * plus notification window. Dropped notices return false and stay dropped.
 */
export function createPlusNotifier(deps: NotifierDeps): PlusNotifier {
	const createNotification = deps.createNotification ?? ((options) => new Notification(options))
	return {
		deliver(scene, options) {
			const policy = deps.policy()
			if (!decideDelivery(policy, scene, deps.context()).deliver) return false
			const soundOn = policy.sound === 'default'
			const notification = createNotification({
				title: options.title,
				body: options.body ?? '',
				...(soundOn && process.platform === 'darwin' ? { sound: 'default' } : {}),
			})
			notification.show()
			if (soundOn && process.platform !== 'darwin') {
				if (deps.beep !== undefined) deps.beep()
				else playSystemToneFallback(deps.log)
			}
			return true
		},
		deliverDecided(options: { title: string; body?: string; sound: SoundChoice; click?: NoticeClickTarget }): boolean {
			// 静默与自定义档都要静掉通知通道：自定义音由应用后端播，通道再响就叠了系统默认音。
			const muteChannel = options.sound.kind !== 'os-default'
			// 系统级免打扰/静音通知只压制系统通道的横幅与系统音，应用自播音效不受其管——
			// 探测命中时把自播按「免打扰」处理（横幅行为仍交给系统：Windows 折叠 / macOS 进通知中心）。
			const systemQuiet = deps.systemMuted?.() === true
			const notification = createNotification({
				title: options.title,
				body: options.body ?? '',
				...(muteChannel ? { silent: true } : {}),
				...(!muteChannel && options.sound.kind === 'os-default' && process.platform === 'darwin' ? { sound: 'default' } : {}),
			})
			if (options.click !== undefined && typeof notification.on === 'function') {
				const target = options.click
				notification.on('click', () => {
					try { deps.onClickRoute?.(target) } catch { /* 路由失败只降级，不影响通知本身 */ }
				})
			}
			notification.show()
			if (systemQuiet) {
				// 系统免打扰生效：横幅交给系统，自播音效全部静默。
				deps.log?.('[notifications] system quiet active; self-play suppressed')
				return true
			}
			if (options.sound.kind === 'silent') return true
			if (options.sound.kind === 'os-default') {
				if (process.platform !== 'darwin') {
					if (deps.beep !== undefined) deps.beep()
					else playSystemToneFallback(deps.log)
				}
				return true
			}
			const played = deps.playCustomSound?.(options.sound.name) ?? false
			if (!played) deps.log?.(`custom sound unavailable: ${options.sound.name}`)
			return true
		},
	}
}

export { validateSoundFile, type SoundFileFacts, type SoundValidation }
