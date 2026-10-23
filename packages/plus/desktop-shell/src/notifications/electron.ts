/** Electron wiring: policy-gated system notifications plus the Windows AUMID fix. */

import { app, Notification } from 'electron'
import type { NoticeContext, NoticePolicy, NoticeScene } from './policy.ts'
import { decideDelivery } from './policy.ts'
import type { SoundFileFacts, SoundValidation } from './sound.ts'
import { validateSoundFile } from './sound.ts'

/**
 * Windows notification banners show this app's name instead of the process
 * name. Must match the packaged appId (electron-builder config).
 */
export const PLUS_APP_USER_MODEL_ID = 'com.deepseek.harness.plus'

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
			if (soundOn && process.platform !== 'darwin') deps.beep?.()
			return true
		},
	}
}

export { validateSoundFile, type SoundFileFacts, type SoundValidation }
