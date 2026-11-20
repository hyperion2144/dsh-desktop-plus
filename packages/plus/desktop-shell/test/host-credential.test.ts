import { describe, expect, it } from 'vitest'
import { hostAddressMatches, hostCredentialResponse, hostOrigin } from '../src/profiles/host-credential.ts'

describe('host origin', () => {
	it('normalizes the host address to its origin', () => {
		expect(hostOrigin('http://127.0.0.1:43110/')).toBe('http://127.0.0.1:43110')
	})

	it('reports no origin for an address it cannot scope', () => {
		expect(hostOrigin('not-a-url')).toBeUndefined()
		expect(hostOrigin('http://127.0.0.1/')).toBeUndefined()
	})
})

describe('host address matching', () => {
	it('matches the Host over both plain and WebSocket protocols', () => {
		// P1：WHATWG URL.origin 对 ws 保留协议，全等比较会让 ws 升级永远拿不到凭据。
		expect(hostAddressMatches(new URL('http://127.0.0.1:43110/'), 'http://127.0.0.1:43110')).toBe(true)
		expect(hostAddressMatches(new URL('ws://127.0.0.1:43110/'), 'http://127.0.0.1:43110')).toBe(true)
		expect(hostAddressMatches(new URL('wss://127.0.0.1:43110/'), 'https://127.0.0.1:43110')).toBe(true)
	})

	it('rejects another host or port even in the matching protocol family', () => {
		expect(hostAddressMatches(new URL('http://127.0.0.1:9999/'), 'http://127.0.0.1:43110')).toBe(false)
		expect(hostAddressMatches(new URL('ws://localhost:43110/'), 'http://127.0.0.1:43110')).toBe(false)
		expect(hostAddressMatches(new URL('http://127.0.0.1:43110/'), 'not-a-url')).toBe(false)
	})
})

describe('host credential response', () => {
	const credential = {
		cookie: 'dsh-desktop-session=secret',
		webContentsId: 7,
		documentOrigin: 'dsh-app://profile-work',
		hostOrigin: 'http://127.0.0.1:43110',
	}

	it('adds the cookie to the owning window request, lowercasing header names', () => {
		const details = { webContentsId: 7, url: 'http://127.0.0.1:43110/', requestHeaders: { Accept: '*/*' } }
		expect(hostCredentialResponse(details, credential)).toEqual({
			requestHeaders: { accept: '*/*', cookie: 'dsh-desktop-session=secret' },
		})
	})

	it('leaves another window request untouched', () => {
		// Two profiles run different Hosts with different secrets; one must never sign the other.
		const details = { webContentsId: 8, url: 'http://127.0.0.1:43110/', requestHeaders: { accept: '*/*' } }
		expect(hostCredentialResponse(details, credential)).toEqual({})
	})

	it('leaves a request from outside a renderer untouched', () => {
		const details = { url: 'http://127.0.0.1:43110/', requestHeaders: { accept: '*/*' } }
		expect(hostCredentialResponse(details, credential)).toEqual({})
	})

	it('leaves a request to another host or port untouched', () => {
		// The window navigated elsewhere; its Host secret must not follow it.
		const details = { webContentsId: 7, url: 'http://127.0.0.1:9999/', requestHeaders: { accept: '*/*' } }
		expect(hostCredentialResponse(details, credential)).toEqual({})
	})

	it('leaves a request whose URL cannot be parsed untouched', () => {
		const details = { webContentsId: 7, url: 'not-a-url', requestHeaders: {} }
		expect(hostCredentialResponse(details, credential)).toEqual({})
	})

	it('replaces a stale cookie rather than appending a second one', () => {
		const details = { webContentsId: 7, url: 'http://127.0.0.1:43110/', requestHeaders: { Cookie: 'dsh-desktop-session=old' } }
		expect(hostCredentialResponse(details, credential)).toEqual({
			requestHeaders: { cookie: 'dsh-desktop-session=secret' },
		})
	})

	it('signs the WebSocket upgrade from the page document origin and rewrites it same-origin (#140 P1)', () => {
		const details = { webContentsId: 7, url: 'ws://127.0.0.1:43110/api/gateway', requestHeaders: { Origin: 'dsh-app://profile-work' } }
		expect(hostCredentialResponse(details, credential)).toEqual({
			requestHeaders: {
				origin: 'http://127.0.0.1:43110',
				cookie: 'dsh-desktop-session=secret',
				'sec-fetch-site': 'same-origin',
			},
		})
	})

	it('signs the WebSocket upgrade the inspector iframe sends from the host origin', () => {
		const details = { webContentsId: 7, url: 'ws://127.0.0.1:43110/', requestHeaders: { origin: 'http://127.0.0.1:43110' } }
		expect(hostCredentialResponse(details, credential)).toEqual({
			requestHeaders: {
				origin: 'http://127.0.0.1:43110',
				cookie: 'dsh-desktop-session=secret',
				'sec-fetch-site': 'same-origin',
			},
		})
	})

	it('cancels a WebSocket upgrade from an origin the window never ran', () => {
		const details = { webContentsId: 7, url: 'ws://127.0.0.1:43110/', requestHeaders: { origin: 'https://attacker.example' } }
		expect(hostCredentialResponse(details, credential)).toEqual({ cancel: true })
	})
})
