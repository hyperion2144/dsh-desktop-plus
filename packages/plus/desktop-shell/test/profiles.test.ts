/** Profile registry and lifecycle manager: name rules, layout, partitions, persistence, lifecycle. */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	createProfileManager,
	type ProfileHostHandle,
	type ProfileManagerDeps,
	type ProfileWindowHandle,
} from '../src/profiles/manager.ts'
import {
	DEFAULT_PROFILE,
	isValidProfileName,
	loadOpenProfiles,
	partitionFor,
	resolveProfileDir,
	saveOpenProfiles,
} from '../src/profiles/registry.ts'

const NAME_CASES: readonly { name: string, valid: boolean }[] = [
	{ name: 'desktop', valid: true },
	{ name: 'a', valid: true },
	{ name: '0', valid: true },
	{ name: '0abc', valid: true },
	{ name: 'work-2', valid: true },
	{ name: 'a-b-c', valid: true },
	{ name: 'work-', valid: true },
	{ name: 'a'.repeat(32), valid: true },
	{ name: 'a'.repeat(33), valid: false },
	{ name: 'a'.repeat(63), valid: false },
	{ name: 'a'.repeat(64), valid: false },
	{ name: '', valid: false },
	{ name: 'Desktop', valid: false },
	{ name: 'WORK', valid: false },
	{ name: 'work_2', valid: false },
	{ name: '-work', valid: false },
	{ name: 'work space', valid: false },
	{ name: 'work.2', valid: false },
	{ name: 'work/../escape', valid: false },
	{ name: '.', valid: false },
	{ name: '..', valid: false },
]

const PARTITION_CASES: readonly { name: string, partition: string }[] = [
	{ name: 'desktop', partition: '' },
	{ name: 'work', partition: 'persist:plus-work' },
	{ name: 'work-2', partition: 'persist:plus-work-2' },
	{ name: 'a', partition: 'persist:plus-a' },
]

interface FakeProfile {
	window: ProfileWindowHandle
	host: ProfileHostHandle
	hides: number
	closes: number
	stops: number
	destroyed: boolean
}

interface FakeShell {
	deps: ProfileManagerDeps
	created: string[]
	hidden: string[]
	profiles: Map<string, FakeProfile>
}

function fakeShell(options: { failOn?: (name: string) => boolean } = {}): FakeShell {
	const created: string[] = []
	const hidden: string[] = []
	const profiles = new Map<string, FakeProfile>()

	const deps: ProfileManagerDeps = {
		createProfile: (name) => {
			if (options.failOn?.(name) === true) throw new Error(`create failed: ${name}`)
			created.push(name)
			const profile: FakeProfile = {
				window: {
					hide: () => { profile.hides += 1 },
					close: () => { profile.closes += 1 },
					isDestroyed: () => profile.destroyed,
				},
				host: {
					stop: () => { profile.stops += 1 },
				},
				hides: 0,
				closes: 0,
				stops: 0,
				destroyed: false,
			}
			profiles.set(name, profile)
			return { window: profile.window, host: profile.host }
		},
		hideWindow: (window) => {
			for (const [name, profile] of profiles) {
				if (profile.window !== window) continue
				profile.hides += 1
				hidden.push(name)
				return
			}
			throw new Error('hideWindow received an unknown window')
		},
	}

	return { deps, created, hidden, profiles }
}

describe('isValidProfileName', () => {
	it.each(NAME_CASES)('accepts "$name": $valid', ({ name, valid }) => {
		expect(isValidProfileName(name)).toBe(valid)
	})
})

describe('resolveProfileDir', () => {
	it('uses the native profile layout of the shared home', () => {
		expect(resolveProfileDir('/home/dev/.dsh', 'work')).toBe(join('/home/dev/.dsh', 'profiles', 'work'))
	})

	it('keeps the official desktop profile where the official shell puts it', () => {
		expect(resolveProfileDir('/home/dev/.dsh', DEFAULT_PROFILE)).toBe(join('/home/dev/.dsh', 'profiles', 'desktop'))
	})
})

describe('partitionFor', () => {
	it.each(PARTITION_CASES)('maps "$name" to "$partition"', ({ name, partition }) => {
		expect(partitionFor(name)).toBe(partition)
	})

	it('gives every profile but the default its own partition', () => {
		expect(partitionFor('work')).not.toBe(partitionFor('play'))
	})
})

describe('open-set persistence', () => {
	let dir = ''
	let file = ''

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'dsh-plus-profiles-'))
		file = join(dir, 'state', 'open-profiles.json')
	})

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true })
	})

	it('round-trips the open profile set', () => {
		saveOpenProfiles(file, ['work', 'play'])
		expect(loadOpenProfiles(file)).toEqual(['work', 'play'])
	})

	it('reads an empty set when the file is missing', () => {
		expect(loadOpenProfiles(file)).toEqual([])
	})

	it('reads an empty set from a corrupt file', () => {
		mkdirSync(join(dir, 'state'), { recursive: true })
		writeFileSync(file, '{not json', 'utf8')
		expect(loadOpenProfiles(file)).toEqual([])
	})

	it('reads an empty set from a foreign file version', () => {
		mkdirSync(join(dir, 'state'), { recursive: true })
		writeFileSync(file, JSON.stringify({ version: 2, open: ['work'] }), 'utf8')
		expect(loadOpenProfiles(file)).toEqual([])
	})

	it('reads an empty set from a file without a list', () => {
		mkdirSync(join(dir, 'state'), { recursive: true })
		writeFileSync(file, JSON.stringify({ version: 1, open: 'work' }), 'utf8')
		expect(loadOpenProfiles(file)).toEqual([])
	})

	it('drops illegal names and duplicates', () => {
		mkdirSync(join(dir, 'state'), { recursive: true })
		writeFileSync(file, JSON.stringify({ version: 1, open: ['work', 'Bad Name', 'work', 'play', ''] }), 'utf8')
		expect(loadOpenProfiles(file)).toEqual(['work', 'play'])
	})

	it('normalizes the names it writes', () => {
		saveOpenProfiles(file, ['work', 'Bad Name', 'work', 'play'])
		expect(loadOpenProfiles(file)).toEqual(['work', 'play'])
		expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, open: ['work', 'play'] })
	})

	it('leaves no temporary file behind after the rename', () => {
		saveOpenProfiles(file, ['work'])
		expect(readdirSync(join(dir, 'state'))).toEqual(['open-profiles.json'])
	})
})

describe('createProfileManager', () => {
	it('opens a profile once and returns the same entry', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		const first = await manager.open('work')
		const second = await manager.open('work')
		expect(second).toBe(first)
		expect(shell.created).toEqual(['work'])
		expect(manager.list().map((entry) => entry.name)).toEqual(['work'])
	})

	it('creates one host for concurrent opens of the same profile', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		const [first, second] = await Promise.all([manager.open('work'), manager.open('work')])
		expect(second).toBe(first)
		expect(shell.created).toEqual(['work'])
	})

	it('refuses an illegal profile name', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await expect(manager.open('Bad Name')).rejects.toThrow(/invalid profile name/)
		expect(shell.created).toEqual([])
		expect(manager.list()).toEqual([])
	})

	it('hides the window and keeps the host running', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open('work')
		expect(manager.hideOrClose('work')).toBe(true)
		expect(shell.hidden).toEqual(['work'])
		expect(shell.profiles.get('work')!.stops).toBe(0)
	})

	it('ignores a hide for a profile that is not open', () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		expect(manager.hideOrClose('missing')).toBe(false)
		expect(shell.hidden).toEqual([])
	})

	it('closes a destroyed window instead of hiding it', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open('work')
		shell.profiles.get('work')!.destroyed = true
		expect(manager.hideOrClose('work')).toBe(true)
		expect(shell.profiles.get('work')!.closes).toBe(1)
		expect(shell.profiles.get('work')!.hides).toBe(0)
	})

	it('quits a profile by stopping its host', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open('work')
		await expect(manager.quitProfile('work')).resolves.toEqual({ ok: true })
		expect(shell.profiles.get('work')!.stops).toBe(1)
		expect(manager.list()).toEqual([])
	})

	it('refuses to quit the default profile', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open(DEFAULT_PROFILE)
		await expect(manager.quitProfile(DEFAULT_PROFILE)).resolves.toEqual({
			ok: false,
			reason: 'default-profile-owned-by-shell',
		})
		expect(shell.profiles.get(DEFAULT_PROFILE)!.stops).toBe(0)
	})

	it('reports a profile that is not open', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await expect(manager.quitProfile('work')).resolves.toEqual({ ok: false, reason: 'not-open' })
	})

	it('drops a profile whose host refuses to stop and records the failure', async () => {
		const shell = fakeShell()
		const manager = createProfileManager({ ...shell.deps, now: () => 1234 })
		await manager.open('work')
		shell.profiles.get('work')!.host.stop = () => { throw new Error('host refused') }
		await expect(manager.quitProfile('work')).resolves.toEqual({
			ok: false,
			reason: 'host-stop-failed',
			error: 'host refused',
		})
		expect(manager.list()).toEqual([])
		expect(manager.lastError('work')).toEqual({ message: 'host refused', at: 1234 })
	})

	it('restores a profile set and keeps going after a failure', async () => {
		const shell = fakeShell({ failOn: (name) => name === 'broken' })
		const manager = createProfileManager(shell.deps)
		const result = await manager.restore(['work', 'broken', 'play', 'Bad Name'])
		expect(result.opened).toEqual(['work', 'play'])
		expect(result.failed).toEqual([
			{ name: 'broken', error: 'create failed: broken' },
			{ name: 'Bad Name', error: 'invalid profile name: Bad Name' },
		])
		expect(shell.created).toEqual(['work', 'play'])
		expect(manager.lastError('broken')?.message).toBe('create failed: broken')
	})

	it('stops every managed host and forgets every profile', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open('work')
		await manager.open('play')
		await manager.open(DEFAULT_PROFILE)
		await manager.dispose()
		expect(shell.profiles.get('work')!.stops).toBe(1)
		expect(shell.profiles.get('play')!.stops).toBe(1)
		expect(shell.profiles.get(DEFAULT_PROFILE)!.stops).toBe(0)
		expect(manager.list()).toEqual([])
	})

	it('records a host that refuses to stop during disposal', async () => {
		const shell = fakeShell()
		const manager = createProfileManager(shell.deps)
		await manager.open('work')
		shell.profiles.get('work')!.host.stop = () => { throw new Error('host refused') }
		await manager.dispose()
		expect(manager.list()).toEqual([])
		expect(manager.lastError('work')?.message).toBe('host refused')
	})
})
