/** Live NoticeContext from a window: focus plus window/in-page fullscreen. */

import type { NoticeContext } from './policy.ts'

/** The window surface the tracker reads; Electron's BrowserWindow satisfies this. */
export interface NoticeWindowLike {
	isFocused(): boolean
	isFullScreen(): boolean
	on(event: string, listener: () => void): unknown
	off?(event: string, listener: () => void): unknown
}

/** Snapshot source for the notifier's context() dep. */
export interface LiveNoticeContext {
	get(): NoticeContext
	/** Detach listeners (window close path). */
	dispose(): void
}

/**
 * Tracks focus and fullscreen — both native window fullscreen and in-page
 * fullscreen (video/presentation). System-wide fullscreen of *other* apps is
 * not observable from Electron; the policy's fullscreenSilent covers what the
 * app itself can see.
 */
export function windowNoticeContext(window: NoticeWindowLike): LiveNoticeContext {
	const state = { focused: window.isFocused(), fullscreen: window.isFullScreen() }
	const mark =
		(key: 'focused' | 'fullscreen', value: boolean) =>
			(): void => {
				state[key] = value
			}
	const listeners: Array<[event: string, listener: () => void]> = [
		['focus', mark('focused', true)],
		['blur', mark('focused', false)],
		['enter-full-screen', mark('fullscreen', true)],
		['leave-full-screen', mark('fullscreen', false)],
		['enter-html-full-screen', mark('fullscreen', true)],
		['leave-html-full-screen', mark('fullscreen', false)],
	]
	for (const [event, listener] of listeners) window.on(event, listener)
	return {
		get: () => ({ windowFocused: state.focused, fullscreen: state.fullscreen }),
		dispose: () => {
			for (const [event, listener] of listeners) window.off?.(event, listener)
		},
	}
}
