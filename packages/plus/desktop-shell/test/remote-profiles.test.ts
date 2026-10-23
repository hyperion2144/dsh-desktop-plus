import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRemoteProfiles, remoteProfilesPath, saveRemoteProfiles } from '../src/profiles/registry.ts'
import { remoteOrigin } from '../src/profiles/remote.ts'

describe('remote profiles registry', () => {
	it('round-trips entries atomically and drops invalid ones on read', () => {
		const home = mkdtempSync(join(tmpdir(), 'plus-remotes-'))
		saveRemoteProfiles(home, { lab: 'http://192.168.1.20:3091', 'Bad Name': 'http://x', no_proto: 'ftp://x' })
		expect(loadRemoteProfiles(home)).toEqual({ lab: 'http://192.168.1.20:3091' })
		const onDisk = JSON.parse(readFileSync(remoteProfilesPath(home), 'utf8'))
		expect(Object.keys(onDisk)).toEqual(['lab'])
	})

	it('reads corrupted stores as empty and normalizes origins', () => {
		const home = mkdtempSync(join(tmpdir(), 'plus-remotes-'))
		writeFileSync(remoteProfilesPath(home), '{ broken')
		expect(loadRemoteProfiles(home)).toEqual({})
		expect(remoteOrigin('http://192.168.1.20:3091/dsh/app')).toBe('http://192.168.1.20:3091')
	})
})
