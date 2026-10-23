import { describe, expect, it } from 'vitest'
import type { RpcParams } from '../src/rpc/types.ts'
import { createRpcRegistry } from '../src/rpc/registry.ts'

describe('createRpcRegistry', () => {
	it('dispatches to the owning group and wraps the return value', async () => {
		const registry = createRpcRegistry([
			{ list_downloads: () => [{ id: 'a' }] },
			{ get_diagnostics: () => ({ ok: true }) },
		])
		await expect(registry.dispatch('list_downloads', {})).resolves.toEqual({ value: [{ id: 'a' }] })
	})

	it('awaits async handlers and reports thrown errors as envelopes', async () => {
		const registry = createRpcRegistry([
			{
				slow: async () => 'done',
				boom: () => {
					throw new Error('disk full')
				},
			},
		])
		await expect(registry.dispatch('slow', {})).resolves.toEqual({ value: 'done' })
		await expect(registry.dispatch('boom', {})).resolves.toEqual({ error: 'disk full' })
	})

	it('rejects unknown methods with a stable message', async () => {
		const registry = createRpcRegistry([{ known: () => 1 }])
		await expect(registry.dispatch('nope', {})).resolves.toEqual({ error: 'unknown rpc method: nope' })
	})

	it('treats a missing params object as empty', async () => {
		const seen: unknown[] = []
		const registry = createRpcRegistry([{ known: (params: RpcParams) => (seen.push(params), 1) }])
		await expect(registry.dispatch('known', undefined)).resolves.toEqual({ value: 1 })
		expect(seen).toEqual([{}])
	})
})

