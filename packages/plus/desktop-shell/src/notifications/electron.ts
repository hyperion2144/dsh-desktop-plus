/** Electron wiring: policy-gated system notifications plus the Windows AUMID fix. */

import { spawn } from 'node:child_process'
import { app, Notification } from 'electron'
import type { NoticeContext, NoticePolicy, NoticeScene } from './policy.ts'
import { decideDelivery } from './policy.ts'
import { systemDefaultSoundCommand } from '../sound/playback.ts'
import type { SoundFileFacts, SoundValidation } from './sound.ts'
import { validateSoundFile } from './sound.ts'
/**
 * Windows notification banners show this app's name instead of the process
 * name. Must match the packaged appId (electron-builder config).
 */
export const PLUS_APP_USER_MODEL_ID = 'com.deepseek.harness.plus'


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
export type NotificationFactory = (options: { title: string; body: string; sound?: string }) => { show(): void }

export interface NotifierDeps {
	/** Current user policy; re-read on every deliver(). */
	policy: () => NoticePolicy
	/** Live window/desktop context; re-read on every deliver(). */
	context: () => NoticeContext
	/** Non-macOS default-sound fallback (Electron only carries `sound` on macOS). */
	beep?: () => void
	/** Defaults to Electron's Notification; tests inject a recorder. */
	createNotification?: NotificationFactory
	/** 投递链诊断日志：默认音派发/失败时落一条（真机没声时的证据）。 */
	log?: (line: string) => void
}

export interface PlusNotifier {
	/** Deliver if policy allows; false when the gate dropped it (never queued). */
	deliver(scene: NoticeScene, options: { title: string; body?: string }): boolean
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
	}
}

export { validateSoundFile, type SoundFileFacts, type SoundValidation }
