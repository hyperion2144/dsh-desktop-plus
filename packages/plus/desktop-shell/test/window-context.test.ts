import { describe, expect, it } from 'vitest'
import { windowNoticeContext, type NoticeWindowLike } from '../src/notifications/window-context.ts'

const fakeWindow = (initial: { focused: boolean; fullscreen: boolean }) => {
	const state = { ...initial }
	const handlers = new Map<string, Array<() => void>>()
	const detached: string[] = []
	const window: NoticeWindowLike = {
		isFocused: () => state.focused,
		isFullScreen: () => state.fullscreen,
		on(event, listener) {
			const list = handlers.get(event) ?? []
			list.push(listener)
			handlers.set(event, list)
			return window
		},
		off(event, listener) {
			detached.push(event)
			const list = handlers.get(event)
			if (list === undefined) return window
			const index = list.indexOf(listener)
			if (index >= 0) list.splice(index, 1)
			return window
		},
	}
	return {
		window,
		emit(event: string) {
			for (const listener of handlers.get(event) ?? []) listener()
		},
		detached,
	}
}

describe('windowNoticeContext', () => {
	it('reads the initial window state', () => {
		const ctx = windowNoticeContext(fakeWindow({ focused: true, fullscreen: false }).window)
		expect(ctx.get()).toEqual({ windowFocused: true, fullscreen: false })
	})

	it('follows focus and blur events', () => {
		const fake = fakeWindow({ focused: false, fullscreen: false })
		const ctx = windowNoticeContext(fake.window)
		fake.emit('focus')
		expect(ctx.get().windowFocused).toBe(true)
		fake.emit('blur')
		expect(ctx.get().windowFocused).toBe(false)
	})

	it('treats window fullscreen and in-page fullscreen as fullscreen', () => {
		const fake = fakeWindow({ focused: false, fullscreen: false })
		const ctx = windowNoticeContext(fake.window)
		fake.emit('enter-html-full-screen')
		expect(ctx.get().fullscreen).toBe(true)
		fake.emit('leave-html-full-screen')
		expect(ctx.get().fullscreen).toBe(false)
		fake.emit('enter-full-screen')
		expect(ctx.get().fullscreen).toBe(true)
	})

	it('dispose detaches listeners and keeps the last snapshot', () => {
		const fake = fakeWindow({ focused: false, fullscreen: false })
		const ctx = windowNoticeContext(fake.window)
		fake.emit('focus')
		ctx.dispose()
		fake.emit('blur')
		expect(ctx.get().windowFocused).toBe(true)
		expect(fake.detached.length).toBeGreaterThan(0)
	})
})
