import { describe, expect, it, vi } from 'vitest'
import {
    clearSelectedRuntime,
    listInstalledRuntimeVersions,
    loadSelectedRuntime,
    RUNTIME_MARKER_FILE,
    runtimeRootFor,
    saveSelectedRuntime,
    selectedRuntimeFileFor,
    type RuntimeStoreIo,
} from '../src/runtimes/store.ts'
import {
    resolveStartupRuntimeSelection,
    revertToBuiltinRuntime,
    RuntimeSwitchError,
    switchRuntime,
    type RuntimeSwitchDeps,
    type StartupRuntimeDeps,
} from '../src/runtimes/switcher.ts'

const USER_DATA = '/tmp/plus-test-user-data'

function ioWith(entries: readonly string[], marked: readonly string[]): RuntimeStoreIo {
    return {
        readdir: () => entries,
        exists: (path) => marked.some(marker => path.endsWith(marker)),
    }
}

describe('runtime store', () => {
    it('lists only legal version directories carrying the runtime marker, newest first', () => {
        const io = ioWith(
            ['0.2.1', 'not-a-version', '0.3.0', '1.2', '0.2.1-rc.1', '.hidden'],
            [RUNTIME_MARKER_FILE, RUNTIME_MARKER_FILE, RUNTIME_MARKER_FILE],
        )
        expect(listInstalledRuntimeVersions(USER_DATA, io)).toEqual(['0.3.0', '0.2.1-rc.1', '0.2.1'])
    })

    it('builds the documented on-disk layout', () => {
        expect(runtimeRootFor(USER_DATA, '0.2.1')).toBe(`${USER_DATA}/runtimes/0.2.1/dsh`)
        expect(selectedRuntimeFileFor(USER_DATA)).toBe(`${USER_DATA}/plus-runtime.json`)
    })

    it('treats missing, malformed, and schema-mismatched selections as no selection', () => {
        expect(loadSelectedRuntime(USER_DATA, () => null)).toBeNull()
        expect(loadSelectedRuntime(USER_DATA, () => 'not json')).toBeNull()
        expect(loadSelectedRuntime(USER_DATA, () => '{"version":2,"selected":"0.2.1"}')).toBeNull()
        expect(loadSelectedRuntime(USER_DATA, () => '{"version":1,"selected":"../evil"}')).toBeNull()
        expect(loadSelectedRuntime(USER_DATA, () => '{"version":1,"selected":"0.2.1"}')).toEqual({ version: '0.2.1' })
    })

    it('persists the selection atomically and reads it back', () => {
        const writes: Array<{ file: string, text: string }> = []
        saveSelectedRuntime(USER_DATA, '0.3.0', (file, text) => writes.push({ file, text }))
        expect(writes).toHaveLength(1)
        expect(writes[0].file.endsWith('.plus-runtime.json')).toBe(false)
        const roundTrip = (file: string) => file === writes[0].file ? writes[0].text : null
        expect(loadSelectedRuntime(USER_DATA, roundTrip)).toEqual({ version: '0.3.0' })
    })

    it('clears the selection through the injected unlink', () => {
        const unlink = vi.fn()
        clearSelectedRuntime(USER_DATA, unlink)
        expect(unlink).toHaveBeenCalledWith(selectedRuntimeFileFor(USER_DATA))
    })
})

function startupDeps(verify: StartupRuntimeDeps['verifyRuntime']): { deps: StartupRuntimeDeps, cleared: ReturnType<typeof vi.fn> } {
    const cleared = vi.fn()
    return { deps: { verifyRuntime: verify, clearSelected: cleared }, cleared }
}

describe('startup runtime resolution', () => {
    it('falls back to builtin when nothing is selected', async () => {
        const { deps } = startupDeps(vi.fn())
        expect(await resolveStartupRuntimeSelection(USER_DATA, deps, () => null)).toEqual({ kind: 'builtin' })
    })

    it('uses the selected root after successful verification', async () => {
        const verify = vi.fn().mockResolvedValue(undefined)
        const { deps, cleared } = startupDeps(verify)
        const outcome = await resolveStartupRuntimeSelection(USER_DATA, deps, () => ({ version: '0.3.0' }))
        expect(outcome).toEqual({ kind: 'selected', version: '0.3.0', root: `${USER_DATA}/runtimes/0.3.0/dsh` })
        expect(verify).toHaveBeenCalledWith(`${USER_DATA}/runtimes/0.3.0/dsh`, '0.3.0')
        expect(cleared).not.toHaveBeenCalled()
    })

    it('clears a broken selection and reports a readable fallback reason', async () => {
        const verify = vi.fn().mockRejectedValue(new Error('integrity verification failed'))
        const { deps, cleared } = startupDeps(verify)
        const outcome = await resolveStartupRuntimeSelection(USER_DATA, deps, () => ({ version: '0.3.0' }))
        expect(outcome).toEqual({ kind: 'fallback', version: '0.3.0', reason: 'integrity verification failed' })
        expect(cleared).toHaveBeenCalledTimes(1)
    })
})

function switchDeps(overrides: Partial<RuntimeSwitchDeps> = {}): { deps: RuntimeSwitchDeps, saved: ReturnType<typeof vi.fn>, restarted: ReturnType<typeof vi.fn> } {
    const saved = vi.fn()
    const restarted = vi.fn()
    return {
        deps: {
            isInstalled: () => true,
            verifyRuntime: vi.fn().mockResolvedValue(undefined),
            saveSelected: saved,
            requestRestart: restarted,
            ...overrides,
        },
        saved,
        restarted,
    }
}

describe('runtime switching', () => {
    it('refuses an uninstalled version before touching state', async () => {
        const { deps, saved, restarted } = switchDeps({ isInstalled: () => false })
        await expect(switchRuntime(USER_DATA, '9.9.9', deps)).rejects.toThrow('runtime 9.9.9 is not installed')
        expect(saved).not.toHaveBeenCalled()
        expect(restarted).not.toHaveBeenCalled()
    })

    it('refuses a failing verification with the underlying reason', async () => {
        const { deps, saved, restarted } = switchDeps({
            verifyRuntime: vi.fn().mockRejectedValue(new Error('descriptor mismatch')),
        })
        await expect(switchRuntime(USER_DATA, '0.3.0', deps)).rejects.toThrow('runtime 0.3.0 failed verification: descriptor mismatch')
        expect(saved).not.toHaveBeenCalled()
        expect(restarted).not.toHaveBeenCalled()
    })

    it('persists the selection and requests a restart after verification', async () => {
        const { deps, saved, restarted } = switchDeps()
        await switchRuntime(USER_DATA, '0.3.0', deps)
        expect(saved).toHaveBeenCalledWith('0.3.0')
        expect(restarted).toHaveBeenCalledTimes(1)
    })

    it('drops the selection when reverting to builtin', () => {
        const clear = vi.fn()
        revertToBuiltinRuntime(USER_DATA, clear)
        expect(clear).toHaveBeenCalledWith(USER_DATA)
    })
})
