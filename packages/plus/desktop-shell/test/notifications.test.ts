import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPlusNotifier, type PlusNotifier } from '../src/notifications/electron.ts'
import { DEFAULT_POLICY, decideDelivery, type NoticeContext, type NoticePolicy } from '../src/notifications/policy.ts'
import { createSleepGate, type PowerSaveBlockerLike } from '../src/notifications/sleep-gate.ts'
import { createBusyLease } from '../src/notifications/busy-lease.ts'
import { deliverHostNotice, noticePolicyFromConfig } from '../src/notifications/host-bridge.ts'
import type { NotificationsConfig } from '@deepseek-ai/dsh-desktop-plus-plugin/contracts'
import { SOUND_MAX_BYTES, SOUND_MAX_SECONDS, validateSoundFile } from '../src/notifications/sound.ts'

const spawned: { binary: string; args: string[] }[] = []
vi.mock('node:child_process', () => ({
	spawn: vi.fn((binary: string, args: string[]) => {
		spawned.push({ binary, args })
		return { unref: () => {} }
	}),
}))
vi.mock('../src/sound/playback.ts', () => ({
	systemDefaultSoundCommand: vi.fn(() => ['powershell', '-c', 'fake-tone']),
}))
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


const richRecorder = () => {
	const calls: Array<{ title: string; body: string; sound?: string; silent?: boolean }> = []
	const shown: number[] = []
	let click: (() => void) | undefined
	const factory = (options: { title: string; body: string; sound?: string; silent?: boolean }) => {
		calls.push(options)
		return {
			show: () => shown.push(1),
			on: (event: string, listener: () => void) => {
				if (event === 'click') click = listener
			},
		}
	}
	return { calls, shown, factory, fireClick: () => click?.() }
}
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

	it('non-macOS default sound plays the system tone when beep is not wired', () => {
		withPlatform('win32', () => {
			spawned.length = 0
			const rec = recorder()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				createNotification: rec.factory,
			})
			notifier.deliver('host', { title: 'x' })
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(spawned).toHaveLength(1)
			expect(spawned[0]?.binary).toBe('powershell')
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

describe('deliverDecided', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('silent choice shows a muted notification without any sound path', () => {
		withPlatform('darwin', () => {
			spawned.length = 0
			const rec = richRecorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			expect(notifier.deliverDecided({ title: 'x', sound: { kind: 'silent' } })).toBe(true)
			expect(rec.calls[0]).toMatchObject({ title: 'x', silent: true })
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(beep).not.toHaveBeenCalled()
			expect(spawned).toHaveLength(0)
		})
	})

	it('os-default rides the notification on macOS', () => {
		withPlatform('darwin', () => {
			const rec = richRecorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			notifier.deliverDecided({ title: 'x', sound: { kind: 'os-default' } })
			expect(rec.calls[0]?.sound).toBe('default')
			expect(beep).not.toHaveBeenCalled()
		})
	})

	it('os-default falls back to beep on non-macOS', () => {
		withPlatform('win32', () => {
			const rec = richRecorder()
			const beep = vi.fn()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				createNotification: rec.factory,
			})
			notifier.deliverDecided({ title: 'x', sound: { kind: 'os-default' } })
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(beep).toHaveBeenCalledTimes(1)
		})
	})

	it('custom choice plays the named file through the injected backend and mutes the channel', () => {
		withPlatform('darwin', () => {
			const rec = richRecorder()
			const beep = vi.fn()
			const playCustomSound = vi.fn(() => true)
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				beep,
				playCustomSound,
				createNotification: rec.factory,
			})
			expect(notifier.deliverDecided({ title: 'x', sound: { kind: 'custom', name: 'ding.wav' } })).toBe(true)
			expect(rec.calls[0]?.silent).toBe(true)
			expect(rec.calls[0]?.sound).toBeUndefined()
			expect(playCustomSound).toHaveBeenCalledWith('ding.wav')
			expect(beep).not.toHaveBeenCalled()
		})
	})

	it('custom choice degrades silently when no backend is wired', () => {
		withPlatform('darwin', () => {
			const rec = richRecorder()
			const notifier = createPlusNotifier({
				policy: () => DEFAULT_POLICY,
				context: () => ({ windowFocused: false, fullscreen: false }),
				createNotification: rec.factory,
			})
			expect(notifier.deliverDecided({ title: 'x', sound: { kind: 'custom', name: 'ding.wav' } })).toBe(true)
			expect(rec.shown).toHaveLength(1)
		})
	})

	it('wires click routing and survives a throwing router', () => {
		const rec = richRecorder()
		const routed: Array<{ sessionId?: string; profile?: string }> = []
		const notifier = createPlusNotifier({
			policy: () => DEFAULT_POLICY,
			context: () => ({ windowFocused: false, fullscreen: false }),
			createNotification: rec.factory,
			onClickRoute: (target) => {
				routed.push(target)
				throw new Error('route exploded')
			},
		})
		notifier.deliverDecided({ title: 'x', sound: { kind: 'silent' }, click: { sessionId: 's1', profile: 'work' } })
		expect(rec.shown).toHaveLength(1)
		expect(() => rec.fireClick()).not.toThrow()
		expect(routed).toEqual([{ sessionId: 's1', profile: 'work' }])
	})
})

describe('deliverHostNotice', () => {
	const config = (overrides?: Partial<NotificationsConfig>): NotificationsConfig => ({
		enabled: true,
		dnd: { on: false, from: '22:00', to: '08:00', suppressFullscreen: true },
		scenarios: {},
		...overrides,
	})
	const hostFixture = (overrides?: {
		config?: NotificationsConfig
		focused?: boolean
		fullscreen?: boolean
		now?: Date
	}) => {
		const rec = richRecorder()
		const playCustomSound = vi.fn(() => true)
		const routed: Array<{ sessionId?: string; profile?: string }> = []
		const notifier = createPlusNotifier({
			policy: () => DEFAULT_POLICY,
			context: () => ({ windowFocused: overrides?.focused ?? false, fullscreen: overrides?.fullscreen ?? false }),
			beep: vi.fn(),
			playCustomSound,
			createNotification: rec.factory,
			onClickRoute: (target) => { routed.push(target) },
		})
		return {
			rec,
			playCustomSound,
			routed,
			deps: {
				notifier,
				config: () => overrides?.config ?? config(),
				context: () => ({ windowFocused: overrides?.focused ?? false, fullscreen: overrides?.fullscreen ?? false }),
				now: () => overrides?.now ?? new Date('2026-06-01T12:00:00'),
			},
		}
	}

	it('delivers task-complete through decide() with routing target and title hint', () => {
		const { rec, routed, deps } = hostFixture()
		expect(deliverHostNotice(deps, { type: 'task-complete', body: '已修完', sessionId: 's1', profile: 'work', title: '修通知' })).toBe(true)
		expect(rec.calls[0]).toMatchObject({ title: '修通知', body: '已修完' })
		rec.fireClick()
		expect(routed).toEqual([{ sessionId: 's1', profile: 'work' }])
	})

	it('falls back to the scenario title without hints', () => {
		const { rec, deps } = hostFixture()
		expect(deliverHostNotice(deps, { type: 'task-complete', body: '' })).toBe(true)
		expect(rec.calls[0]?.title).toBe('任务已完成')
	})

	it('honours the per-scenario silent choice', () => {
		const { rec, deps } = hostFixture({ config: config({ scenarios: { 'task.complete': { enabled: true, sound: 'none' } } }) })
		expect(deliverHostNotice(deps, { type: 'task-complete', body: 'x' })).toBe(true)
		expect(rec.calls[0]?.silent).toBe(true)
	})

	it('plays the per-scenario custom sound', () => {
		const { rec, playCustomSound, deps } = hostFixture({ config: config({ scenarios: { 'task.complete': { enabled: true, sound: 'custom:ding.wav' } } }) })
		expect(deliverHostNotice(deps, { type: 'task-complete', body: 'x' })).toBe(true)
		expect(playCustomSound).toHaveBeenCalledWith('ding.wav')
		expect(rec.calls[0]?.silent).toBe(true)
	})

	it('deliver-but-silent inside the dnd window, normal outside', () => {
		const inWindow = hostFixture({ config: config({ dnd: { on: true, from: '22:00', to: '08:00', suppressFullscreen: true } }), now: new Date('2026-06-01T23:30:00') })
		expect(deliverHostNotice(inWindow.deps, { type: 'task-complete', body: 'x' })).toBe(true)
		expect(inWindow.rec.calls[0]?.silent).toBe(true)
		const outWindow = hostFixture({ config: config({ dnd: { on: true, from: '22:00', to: '08:00', suppressFullscreen: true } }), now: new Date('2026-06-01T12:00:00') })
		expect(deliverHostNotice(outWindow.deps, { type: 'task-complete', body: 'x' })).toBe(true)
		expect(outWindow.rec.calls[0]?.silent).toBeUndefined()
	})

	it('drops while a plus window is focused', () => {
		const { rec, deps } = hostFixture({ focused: true })
		expect(deliverHostNotice(deps, { type: 'task-complete', body: 'x' })).toBe(false)
		expect(rec.calls).toHaveLength(0)
	})

	it('drops disabled scenarios, disabled config, busy-state and unknown types', () => {
		const gated = hostFixture({ config: config({ scenarios: { 'dsh.approval': { enabled: false, sound: 'default' } } }) })
		expect(deliverHostNotice(gated.deps, { type: 'dsh-approval', body: '' })).toBe(false)
		const disabled = hostFixture({ config: config({ enabled: false }) })
		expect(deliverHostNotice(disabled.deps, { type: 'task-complete', body: '' })).toBe(false)
		const plain = hostFixture()
		expect(deliverHostNotice(plain.deps, { type: 'busy-state', profile: 'desktop', busy: true })).toBe(false)
		expect(deliverHostNotice(plain.deps, { type: 'mystery', body: '' })).toBe(false)
	})

	it('noticePolicyFromConfig projects dnd and fullscreen suppression', () => {
		expect(noticePolicyFromConfig(config({ dnd: { on: true, from: '22:00', to: '08:00', suppressFullscreen: false } }))).toEqual({
			scenes: { host: true, download: true, update: true, generic: true },
			doNotDisturb: true,
			fullscreenSilent: false,
			sound: 'default',
		})
	})
})

describe('createBusyLease', () => {
	it('activates on fresh busy reports and expires stale ones', () => {
		let now = 1_000
		const seen: Array<ReadonlySet<string>> = []
		const lease = createBusyLease({ now: () => now, onChange: (active) => seen.push(new Set(active)) })
		lease.report('desktop', true)
		expect(seen.at(-1)).toEqual(new Set(['desktop']))
		now = 20_000
		lease.sweep()
		expect(seen.at(-1)).toEqual(new Set(['desktop']))
		now = 30_000
		lease.sweep()
		expect(seen.at(-1)?.size).toBe(0)
	})

	it('deduplicates unchanged active sets and honours busy=false', () => {
		let now = 0
		let changes = 0
		const lease = createBusyLease({ now: () => now, onChange: () => { changes += 1 } })
		lease.report('a', true)
		lease.report('a', true)
		expect(changes).toBe(1)
		lease.report('a', false)
		expect(changes).toBe(2)
		lease.report('', true)
		expect(changes).toBe(2)
	})
})
