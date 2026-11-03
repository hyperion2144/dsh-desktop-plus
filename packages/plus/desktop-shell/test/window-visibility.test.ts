/** Window visibility → tray refresh: one subscription for hide/show/minimize/restore. */
import { describe, expect, it, vi } from 'vitest'
import { observeWindowVisibility } from '../src/tray/window-visibility.ts'

/** A window stand-in that records subscriptions and can replay events. */
function fakeWindow() {
	const listeners = new Map<string, (() => void)[]>()
	return {
		listeners,
		on(event: string, listener: () => void): void {
			const list = listeners.get(event) ?? []
			list.push(listener)
			listeners.set(event, list)
		},
		emit(event: string): void {
			for (const listener of listeners.get(event) ?? []) listener()
		},
	}
}

describe('observeWindowVisibility', () => {
	it('subscribes exactly the four visibility events', () => {
		const window = fakeWindow()
		observeWindowVisibility(window, () => undefined)
		expect([...window.listeners.keys()].sort()).toEqual(['hide', 'minimize', 'restore', 'show'])
	})

	it('notifies once per transition', () => {
		const window = fakeWindow()
		const notify = vi.fn()
		observeWindowVisibility(window, notify)
		for (const event of ['hide', 'show', 'minimize', 'restore']) window.emit(event)
		expect(notify).toHaveBeenCalledTimes(4)
	})

	it('ignores focus, blur and close: only visibility matters', () => {
		const window = fakeWindow()
		const notify = vi.fn()
		observeWindowVisibility(window, notify)
		for (const event of ['focus', 'blur', 'close', 'closed']) window.emit(event)
		expect(notify).not.toHaveBeenCalled()
	})
})
