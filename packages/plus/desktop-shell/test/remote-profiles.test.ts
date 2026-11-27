import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRemoteAddressList, loadRemoteOrigins } from '../src/rpc/desktop-settings.ts'
import { remoteProfileName } from '../src/profiles/registry.ts'
import { remoteOrigin } from '../src/profiles/remote.ts'

describe('remote profile naming and address list', () => {
	it('derives a stable, valid profile name from the URL', () => {
		expect(remoteProfileName('http://192.168.3.90:3093/pair?token=abc')).toBe('remote-192-168-3-90-3093')
		expect(remoteProfileName('https://dsh.example.com')).toBe('remote-dsh-example-com')
		const name = remoteProfileName(`http://${'a'.repeat(60)}.example.com:3091`)
		expect(name.length).toBeLessThanOrEqual(32)
		expect(name.endsWith('-')).toBe(false)
	})

	it('reads the address list from desktop settings and drops malformed entries', () => {
		const home = mkdtempSync(join(tmpdir(), 'plus-remotes-'))
		writeFileSync(join(home, 'desktop-settings.json'), JSON.stringify({
			remote_list: ['http://192.168.1.20:3091', 'not-a-url', 42],
		}))
		expect(loadRemoteAddressList(home)).toEqual(['http://192.168.1.20:3091'])
		expect(loadRemoteAddressList(join(home, 'missing'))).toEqual([])
		expect(remoteOrigin('http://192.168.1.20:3091/dsh/app')).toBe('http://192.168.1.20:3091')
	})

	it('reads remote profiles from the remote-access host store and drops malformed entries (#93)', () => {
		const home = mkdtempSync(join(tmpdir(), 'plus-origins-'))
		expect(loadRemoteOrigins(home)).toEqual([])
		const file = join(home, 'storages', 'remote-access', 'remote-hosts.json')
		mkdirSync(join(home, 'storages', 'remote-access'), { recursive: true })
		writeFileSync(file, JSON.stringify({ hosts: [{ origin: 'http://192.168.1.20:3091' }, { origin: 42 }, {}, null] }), 'utf8')
		expect(loadRemoteOrigins(home)).toEqual(['http://192.168.1.20:3091'])
		writeFileSync(file, JSON.stringify({ hosts: 'not-a-list' }), 'utf8')
		expect(loadRemoteOrigins(home)).toEqual([])
		writeFileSync(file, 'not json', 'utf8')
		expect(loadRemoteOrigins(home)).toEqual([])
	})
})
