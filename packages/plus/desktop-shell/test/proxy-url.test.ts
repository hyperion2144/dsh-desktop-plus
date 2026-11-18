import { describe, expect, it } from 'vitest'
import { resolveProxyEnv, validateManualProxyUrl } from '../src/net/proxy-env.ts'

describe('manual proxy URL', () => {
	it('accepts an HTTP proxy and reports its normalized form', () => {
		expect(validateManualProxyUrl('http://proxy.corp:8080')).toEqual({ ok: true, url: 'http://proxy.corp:8080' })
	})

	it('fills the default HTTP port', () => {
		expect(validateManualProxyUrl('http://proxy.corp')).toEqual({ ok: true, url: 'http://proxy.corp:80' })
	})

	it('rejects an HTTPS proxy, which the shell cannot speak to', () => {
		const result = validateManualProxyUrl('https://proxy.corp:443')
		expect(result.ok).toBe(false)
		expect(result.ok ? '' : result.error).toContain('仅支持 HTTP 代理')
	})

	it('rejects a SOCKS proxy, which neither side can use', () => {
		const result = validateManualProxyUrl('socks5://proxy.corp:1080')
		expect(result.ok).toBe(false)
		expect(result.ok ? '' : result.error).toContain('仅支持 HTTP 代理')
	})

	it('rejects an empty address', () => {
		expect(validateManualProxyUrl('   ').ok).toBe(false)
	})

	it('rejects a malformed address', () => {
		expect(validateManualProxyUrl('proxy.corp:8080').ok).toBe(false)
	})
})

describe('manual proxy resolution', () => {
	it('routes both schemes through the configured HTTP proxy', () => {
		expect(resolveProxyEnv({ proxy_mode: 'manual', proxy_url: 'http://proxy.corp:8080' })).toEqual({
			http: 'http://proxy.corp:8080', https: 'http://proxy.corp:8080', all: null, no_proxy: 'localhost,127.0.0.1,::1',
		})
	})

	it('resolves nothing for an address the product cannot use', () => {
		// A silently accepted scheme would leave the shell and the Host disagreeing.
		expect(resolveProxyEnv({ proxy_mode: 'manual', proxy_url: 'https://proxy.corp:443' })).toBeNull()
		expect(resolveProxyEnv({ proxy_mode: 'manual', proxy_url: 'socks5://proxy.corp:1080' })).toBeNull()
	})
})
