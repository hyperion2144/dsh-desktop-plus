/** Kernel behavior tests: isolation claim, tray lifecycle, host-failure resilience, dispose/rebuild. */

import { describe, expect, it, vi } from 'vitest'
import { createShellKernel } from '../src/kernel.ts'
import type { ShellApp, ShellKernelDeps, TrayHandle } from '../src/types.ts'

function fakeApp(): ShellApp & { willQuitHandlers: Array<() => void>; paths: Map<string, string> } {
    const willQuitHandlers: Array<() => void> = []
    const paths = new Map<string, string>([['userData', '/home/default-user-data']])
    return {
        willQuitHandlers,
        paths,
        async whenReady() { },
        quit() { },
        on(_event, listener) { willQuitHandlers.push(listener) },
        getPath(name) { const value = paths.get(name); if (value === undefined) throw new Error(`no path for ${name}`); return value },
        setPath(name, value) { paths.set(name, value) },
    }
}

interface Harness {
    readonly app: ReturnType<typeof fakeApp>
    readonly createdTrays: TrayHandle[]
    readonly claimState: { count: number }
    readonly kernel: ReturnType<typeof createShellKernel>
}

function harness(): Harness {
    const app = fakeApp()
    const createdTrays: TrayHandle[] = []
    const claimState = { count: 0 }
    const deps: ShellKernelDeps = {
        app,
        claimSingleInstance: () => { claimState.count += 1; return true },
        createTray: () => { const handle: TrayHandle = { destroy: vi.fn() }; createdTrays.push(handle); return handle },
        quit: () => { },
        log: () => { },
    }
    return { app, createdTrays, claimState, kernel: createShellKernel(deps) }
}

describe('shell kernel claim', () => {
    it('delegates the claim and leaves userData untouched for a normal instance', () => {
        const h = harness()
        expect(h.kernel.claimSingleInstance(() => { })).toBe(true)
        expect(h.claimState.count).toBe(1)
        expect(h.app.paths.get('userData')).toBe('/home/default-user-data')
    })

    it('runs isolated when DSH_DESKTOP_NO_SINGLETON is set: no lock, separate userData', () => {
        const h = harness()
        process.env.DSH_DESKTOP_NO_SINGLETON = '1'
        try {
            expect(h.kernel.claimSingleInstance(() => { })).toBe(true)
            expect(h.claimState.count).toBe(0)
            expect(h.app.paths.get('userData')).toBe('/home/default-user-data-isolated')
        } finally {
            delete process.env.DSH_DESKTOP_NO_SINGLETON
        }
    })
})

describe('shell kernel lifecycle', () => {
    it('creates the tray on start and stays idempotent', () => {
        const h = harness()
        h.kernel.start()
        h.kernel.start()
        expect(h.createdTrays).toHaveLength(1)
        expect(h.kernel.ownsTray()).toBe(true)
        expect(h.kernel.state.tray).toBe(true)
    })

    it('keeps the tray when the host fails and reports the phase', () => {
        const h = harness()
        h.kernel.start()
        h.kernel.noteHostPhase('starting')
        h.kernel.noteHostPhase('failed', new Error('boom'))
        expect(h.kernel.ownsTray()).toBe(true)
        expect(h.kernel.state.hostPhase).toBe('failed')
    })

    it('disposes the tray and rebuilds it in the same process', async () => {
        const h = harness()
        h.kernel.start()
        await h.kernel.dispose()
        expect(h.createdTrays[0]!.destroy).toHaveBeenCalledOnce()
        expect(h.kernel.ownsTray()).toBe(false)
        h.kernel.start()
        expect(h.createdTrays).toHaveLength(2)
        expect(h.kernel.ownsTray()).toBe(true)
    })

    it('disposes when the app will-quit fires', async () => {
        const h = harness()
        h.kernel.start()
        expect(h.app.willQuitHandlers).toHaveLength(1)
        await h.app.willQuitHandlers[0]()
        expect(h.kernel.ownsTray()).toBe(false)
    })
})
