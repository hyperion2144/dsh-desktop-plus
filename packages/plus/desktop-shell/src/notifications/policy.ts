/** Notice gate contracts: scenes, policy, and the delivery decision. */

/** The scenes plus can notify about; policy keys off these. */
export type NoticeScene = 'host' | 'download' | 'update' | 'generic'

/** User-controllable delivery policy. */
export interface NoticePolicy {
	/** Per-scene opt-in; a disabled scene is dropped silently. */
	scenes: Record<NoticeScene, boolean>
	/** Do-not-disturb: drop everything, never queue for later. */
	doNotDisturb: boolean
	/** Stay silent while the user is in a fullscreen app. */
	fullscreenSilent: boolean
	/** Sound: system default, or none. Custom files validate via validateSoundFile. */
	sound: 'default' | 'none'
}

/** Live window/desktop state the gate checks at delivery time. */
export interface NoticeContext {
	/** A plus-owned window is focused — an in-app notice is already visible. */
	windowFocused: boolean
	/** The user is presenting fullscreen on any display. */
	fullscreen: boolean
}

export const DEFAULT_POLICY: NoticePolicy = {
	scenes: { host: true, download: true, update: true, generic: true },
	doNotDisturb: false,
	fullscreenSilent: true,
	sound: 'default',
}

/** Why a notice was (not) delivered; tests pin the reasons. */
export type DeliverDecision =
	| { deliver: true }
	| { deliver: false; reason: 'scene-disabled' | 'do-not-disturb' | 'fullscreen-silent' | 'window-focused' }

/**
 * Pure delivery decision. Dropped notices are never queued: silence during
 * do-not-disturb or fullscreen stays silent, nothing replays afterwards.
 */
export function decideDelivery(policy: NoticePolicy, scene: NoticeScene, context: NoticeContext): DeliverDecision {
	if (!policy.scenes[scene]) return { deliver: false, reason: 'scene-disabled' }
	if (policy.doNotDisturb) return { deliver: false, reason: 'do-not-disturb' }
	if (policy.fullscreenSilent && context.fullscreen) return { deliver: false, reason: 'fullscreen-silent' }
	if (context.windowFocused) return { deliver: false, reason: 'window-focused' }
	return { deliver: true }
}
