import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlusNotifier } from '../src/notifications/electron.ts'
import { DEFAULT_POLICY, decideDelivery, type NoticeContext, type NoticePolicy } from '../src/notifications/policy.ts'
import { createSleepGate, type PowerSaveBlockerLike } from '../src/notifications/sleep-gate.ts'
import { SOUND_MAX_BYTES, SOUND_MAX_SECONDS, validateSoundFile } from '../src/notifications/sound.ts'

const withPlatform = (platform: NodeJS.Platform, run: () => void): void => {
	const original = process.platform
	Object.defineProperty(process, 'platform', { value: platform })
	try {
		run()
	} finally {
		Object.defineProperty(process, 'platform', { value: original })
	}
}

describe('decideDelivery', () => {
	const base = (): NoticeContext => ({ windowFocused: false, fullscreen: false })

	it('delivers by default', () => {
		expect(decideDelivery(DEFAULT_POLICY, 'host', base())).toEqual({ deliver: true })
	})

	it('drops a disabled scene', () => {
		const policy: NoticePolicy = { ...DEFAULT_POLICY, scenes: { ...DEFAULT_POLICY.scenes, download: false } }
		expect(decideDelivery(policy, 'download', base())).toEqual({ deliver: false, reason: 'scene-disabled' })
	})

	it('drops under do-not-disturb without queueing', () => {
		const policy: NoticePolicy = { ...DEFAULT_POLICY, doNotDisturb: true }
		expect(decideDelivery(policy, 'host', base())).toEqual({ deliver: false, reason: 'do-not-disturb' })
	})

	it('drops while fullscreen is silent', () => {
		expect(decideDelivery(DEFAULT_POLICY, 'host', { ...base(), fullscreen: true })).toEqual({
			deliver: false,
			reason: 'fullscreen-silent',
		})
	})

	it('does not double-pop over a focused window', () => {
		expect(decideDelivery(DEFAULT_POLICY, 'host', { ...base(), windowFocused: true })).toEqual({
			deliver: false,
			reason: 'window-focused',
		})
	})

	it('fullscreen check is skippable via policy', () => {
		const policy: NoticePolicy = { ...DEFAULT_POLICY, fullscreenSilent: false }
		expect(decideDelivery(policy, 'host', { ...base(), fullscreen: true })).toEqual({ deliver: true })
	})
})

describe('createSleepGate', () => {
	const fakeBlocker = (): PowerSaveBlockerLike & { starts: number; stops: number } => {
		let id: number | null = null
		const state = { starts: 0, stops: 0 }
		return {
			...state,
			start() {
				state.starts += 1
				id = state.starts
				return id
			},
			stop(stopped) {
				if (stopped !== id) return
				state.stops += 1
				id = null
			},
			isStarted(candidate) {
				return candidate === id
			},
			get starts() {
				return state.starts
			},
			get stops() {
				return state.stops
			},
		}
	}

	it('starts once for N holders and stops on the last release', () => {
		const blocker = fakeBlocker()
		const gate = createSleepGate(blocker)
		gate.acquire('download-1')
		gate.acquire('host-1')
		expect(gate.active()).toBe(true)
		gate.release('download-1')
		expect(gate.active()).toBe(true)
		expect(blocker.stops).toBe(0)
		gate.release('host-1')
		expect(gate.active()).toBe(false)
		expect(blocker.starts).toBe(1)
		expect(blocker.stops).toBe(1)
	})

	it('ignores unknown and duplicate releases', () => {
		const blocker = fakeBlocker()
		const gate = createSleepGate(blocker)
		gate.acquire('a')
		gate.release('unknown')
		gate.release('a')
		gate.release('a')
		expect(blocker.stops).toBe(1)
	})

	it('dispose releases everything without leaking', () => {
		const blocker = fakeBlocker()
		const gate = createSleepGate(blocker)
		gate.acquire('a')
		gate.acquire('b')
		gate.dispose()
		expect(gate.active()).toBe(false)
		expect(blocker.stops).toBe(1)
	})
})

describe('validateSoundFile', () => {
	it('accepts whitelisted formats within caps', () => {
		expect(validateSoundFile({ extension: '.WAV', sizeBytes: 1000, durationSeconds: 2 })).toEqual({ ok: true })
	})

	it('rejects non-whitelisted formats naming the allowed list', () => {
		const result = validateSoundFile({ extension: '.flac', sizeBytes: 1000, durationSeconds: 2 })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toContain('.wav')
	})

	it('rejects oversized files', () => {
		const result = validateSoundFile({ extension: '.mp3', sizeBytes: SOUND_MAX_BYTES + 1, durationSeconds: 2 })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toContain('MB limit')
	})

	it('rejects overly long sounds', () => {
		const result = validateSoundFile({ extension: '.ogg', sizeBytes: 1000, durationSeconds: SOUND_MAX_SECONDS + 1 })
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.reason).toContain('30 second limit')
	})
})

describe('createPlusNotifier', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const recorder = () => {
		const calls: Array<{ title: string; body: string; sound?: string }> = []
		const shown: number[] = []
		return {
			calls,
			shown,
			factory: (options: { title: string; body: string; sound?: string }) => {
				calls.push(options)
				return { show: () => shown.push(1) }
			},
		}
	}

	it('returns false without constructing a notification when dropped', () => {
		const rec = recorder()
		const notifier = createPlusNotifier({
			policy: () => ({ ...DEFAULT_POLICY, doNotDisturb: true }),
			context: () => ({ windowFocused: false, fullscreen: false }),
			createNotification: rec.factory,
		})
		expect(notifier.deliver('host', { title: 'Hello' })).toBe(false)
		expect(rec.calls).toHaveLength(0)
	})

	it('delivers through the official channel with title and body', () => {
		const rec = recorder()
		const notifier = createPlusNotifier({
			policy: () => DEFAULT_POLICY,
			context: () => ({ windowFocused: false, fullscreen: false }),
			createNotification: rec.factory,
		})
		expect(notifier.deliver('download', { title: 'Done', body: 'file.zip' })).toBe(true)
		expect(rec.calls[0]?.title).toBe('Done')
		expect(rec.calls[0]?.body).toBe('file.zip')
		expect(rec.shown).toHaveLength(1)
	})

	it('macOS default sound rides the notification itself', () => {
		withPlatform('darwin', () => {
			const rec = recorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			notifier.deliver('host', { title: 'x' })
			expect(rec.calls[0]?.sound).toBe('default')
			expect(beep).not.toHaveBeenCalled()
		})
	})

	it('non-macOS default sound falls back to beep', () => {
		withPlatform('win32', () => {
			const rec = recorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			notifier.deliver('host', { title: 'x' })
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(beep).toHaveBeenCalledTimes(1)
		})
	})

	it('sound none mutes everywhere', () => {
		withPlatform('darwin', () => {
			const rec = recorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => ({ ...DEFAULT_POLICY, sound: 'none' }),
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			notifier.deliver('host', { title: 'x' })
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(beep).not.toHaveBeenCalled()
		})
	})
})
