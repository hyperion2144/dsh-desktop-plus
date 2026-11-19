import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { bypassesProxy, createConfiguredFetch } from '../src/net/configured-fetch.ts'

describe('proxy bypass matching', () => {
	it.each([
		['10.24.95.52', '10.*'],
		['10.0.0.1', '10.*'],
		['192.168.1.9', '192.168.*'],
		['build.internal', '*.internal'],
		['api.example.com', 'example.com'],
		['example.com', 'example.com'],
		['localhost', '<local>'],
		['nas', '<local>'],
		['127.0.0.1', '<local>'],
		['anything.example', '*'],
	])('bypasses %s for %s', (host, entry) => {
		expect(bypassesProxy(host, '443', entry)).toBe(true)
	})

	it.each([
		['11.0.0.1', '10.*'],
		['10.0.0.1', '192.168.*'],
		['example.com', '*.internal'],
		['notexample.com', 'example.com'],
		['public.example', '<local>'],
		['10.0.0.1', ''],
	])('proxies %s for %s', (host, entry) => {
		expect(bypassesProxy(host, '443', entry)).toBe(false)
	})

	it('honours a port-qualified entry', () => {
		expect(bypassesProxy('10.0.0.1', '3095', '10.0.0.1:3095')).toBe(true)
		expect(bypassesProxy('10.0.0.1', '3096', '10.0.0.1:3095')).toBe(false)
	})

	it('reads a comma or space separated list', () => {
		expect(bypassesProxy('10.0.0.1', '80', 'localhost, 10.*,<local>')).toBe(true)
		expect(bypassesProxy('10.0.0.1', '80', 'localhost 10.* <local>')).toBe(true)
	})
})

describe('configured fetch', () => {
	const servers: { close: () => void }[] = []
	afterEach(() => { for (const server of servers.splice(0)) server.close() })

	/** One loopback server answering every request with its own path. */
	async function serve(): Promise<{ origin: string, host: string, port: string }> {
		const server = createServer((request, response) => { response.end(`path=${request.url ?? ''}`) })
		await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
		servers.push(server)
		const address = server.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		return { origin: `http://127.0.0.1:${address.port}`, host: '127.0.0.1', port: String(address.port) }
	}

	it('connects directly when the target is bypassed', async () => {
		const { origin, port } = await serve()
		const configured = createConfiguredFetch({ proxy: () => ({ http: 'http://127.0.0.1:9', https: null, all: null, no_proxy: `127.0.0.1:${port}` }) })
		const response = await configured(`${origin}/direct`)
		expect(response.status).toBe(200)
		expect(await response.text()).toBe('path=/direct')
	})

	it('connects directly when no proxy is configured', async () => {
		const { origin } = await serve()
		const configured = createConfiguredFetch({ proxy: () => null })
		expect(await (await configured(`${origin}/plain`)).text()).toBe('path=/plain')
	})

	it('sends the request body and reads the answer headers', async () => {
		const server = createServer((request, response) => {
			const chunks: Buffer[] = []
			request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
			request.on('end', () => {
				response.setHeader('x-echo', Buffer.concat(chunks).toString())
				response.end('ok')
			})
		})
		await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
		servers.push(server)
		const address = server.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const configured = createConfiguredFetch({ proxy: () => null })
		const response = await configured(`http://127.0.0.1:${address.port}/post`, {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}',
		})
		expect(response.headers.get('x-echo')).toBe('{"a":1}')
	})

	it('sends a plain-HTTP request through the configured proxy', async () => {
		// The proxy sees the absolute URI and answers on the target's behalf.
		const seen: string[] = []
		const proxy = createServer((request, response) => {
			seen.push(`${request.method ?? ''} ${request.url ?? ''}`)
			response.setHeader('x-proxied', 'yes')
			response.end('via-proxy')
		})
		await new Promise<void>((resolve) => { proxy.listen(0, '127.0.0.1', resolve) })
		servers.push(proxy)
		const address = proxy.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const configured = createConfiguredFetch({
			proxy: () => ({ http: `http://127.0.0.1:${address.port}`, https: null, all: null, no_proxy: '' }),
		})
		const response = await configured('http://target.invalid/api/thing')
		expect(await response.text()).toBe('via-proxy')
		expect(response.headers.get('x-proxied')).toBe('yes')
		expect(seen).toEqual(['GET http://target.invalid/api/thing'])
	})

	it('uses the proxy even when the process environment names a different one', async () => {
		const seen: string[] = []
		const proxy = createServer((request, response) => {
			seen.push(request.url ?? '')
			response.end('configured-proxy')
		})
		await new Promise<void>((resolve) => { proxy.listen(0, '127.0.0.1', resolve) })
		servers.push(proxy)
		const address = proxy.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const previous = process.env.HTTP_PROXY
		// A stale environment proxy must not win over the resolved answer.
		process.env.HTTP_PROXY = 'http://127.0.0.1:9'
		try {
			const configured = createConfiguredFetch({
				proxy: () => ({ http: `http://127.0.0.1:${address.port}`, https: null, all: null, no_proxy: '' }),
			})
			expect(await (await configured('http://target.invalid/x')).text()).toBe('configured-proxy')
			expect(seen).toEqual(['http://target.invalid/x'])
		} finally {
			if (previous === undefined) delete process.env.HTTP_PROXY
			else process.env.HTTP_PROXY = previous
		}
	})

	it('follows a redirect unless the caller asked for manual', async () => {
		const server = createServer((request, response) => {
			if (request.url === '/start') {
				response.writeHead(302, { location: '/end' })
				response.end()
				return
			}
			response.end(`landed=${request.url ?? ''}`)
		})
		await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
		servers.push(server)
		const address = server.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const origin = `http://127.0.0.1:${address.port}`
		const configured = createConfiguredFetch({ proxy: () => null })
		expect(await (await configured(`${origin}/start`)).text()).toBe('landed=/end')
		const manual = await configured(`${origin}/start`, { redirect: 'manual' })
		expect(manual.status).toBe(302)
		expect(manual.headers.get('location')).toBe('/end')
	})

it('gives up on a target that never answers', async () => {
	// A proxy that accepts the connection and then says nothing must not hang the caller.
	const silent = createServer(() => { /* never responds */ })
	await new Promise<void>((resolve) => { silent.listen(0, '127.0.0.1', resolve) })
	servers.push(silent)
	const address = silent.address()
	if (address === null || typeof address === 'string') throw new Error('no port')
	const configured = createConfiguredFetch({ proxy: () => null, timeoutMs: 150 })
	await expect(configured(`http://127.0.0.1:${address.port}/hang`)).rejects.toThrow(/timed out/u)
})

	it('fails a redirect loop instead of returning the last hop', async () => {
		const server = createServer((_request, response) => {
			response.writeHead(302, { location: '/again' })
			response.end()
		})
		await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
		servers.push(server)
		const address = server.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const configured = createConfiguredFetch({ proxy: () => null })
		// A 302 body is not an answer; the caller must learn the chain never ended.
		await expect(configured(`http://127.0.0.1:${address.port}/loop`)).rejects.toThrow(/redirect/u)
	})

	it('stops reading a body past the configured cap', async () => {
		const server = createServer((_request, response) => { response.end('x'.repeat(64 * 1024)) })
		await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
		servers.push(server)
		const address = server.address()
		if (address === null || typeof address === 'string') throw new Error('no port')
		const configured = createConfiguredFetch({ proxy: () => null, maxBodyBytes: 1024 })
		// A status probe must not pull a whole page into memory.
		expect((await (await configured(`http://127.0.0.1:${address.port}/big`)).text()).length).toBe(1024)
	})

	it('refuses a body it cannot send instead of dropping it', async () => {
		const { origin } = await serve()
		const configured = createConfiguredFetch({ proxy: () => null })
		// Silently sending no body would look like a successful empty request.
		await expect(configured(`${origin}/upload`, { method: 'POST', body: new FormData() }))
			.rejects.toThrow(/body/u)
	})
})
