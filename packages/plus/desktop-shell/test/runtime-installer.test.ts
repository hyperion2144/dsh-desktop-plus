import { describe, expect, it } from 'vitest'
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntimeInstaller, normalizeRuntimeVersion } from '../src/runtimes/installer.ts'

interface Harness {
    root: string
    installed: string[]
    active: string | undefined
    failVerify: boolean
    abortController: AbortController | undefined
    progress: Array<[number, number | undefined]>
    installer: ReturnType<typeof createRuntimeInstaller>
}

function harness(): Harness {
    const root = mkdtempSync(join(tmpdir(), 'plus-installer-'))
    const state: Harness = {
        root,
        installed: [],
        active: undefined,
        failVerify: false,
        abortController: undefined,
        progress: [],
        installer: undefined as never,
    }
    state.installer = createRuntimeInstaller(root, {
        installTree: async (version, destination, options) => {
            if (version === '0.0.0-boom') throw new Error('download exploded')
            mkdirSync(destination, { recursive: true })
            writeFileSync(join(destination, 'marker'), version)
            options.onProgress?.(5, 10)
            if (state.abortController !== undefined) state.abortController.abort()
        },
        verify: async () => {
            if (state.failVerify) throw new Error('verify failed')
        },
        activeVersion: () => state.active,
        log: () => { },
    })
    return state
}

describe('normalizeRuntimeVersion', () => {
    it('strips v prefix and build metadata', () => {
        expect(normalizeRuntimeVersion('v0.2.1-rc.2+build.9')).toBe('0.2.1-rc.2')
        expect(normalizeRuntimeVersion(' 1.2.3 ')).toBe('1.2.3')
    })
})

describe('createRuntimeInstaller.install', () => {
    it('installs into <root>/<version> after verification and reports progress', async () => {
        const h = harness()
        await h.installer.install('0.2.1-rc.2', { onProgress: (bytes, total) => h.progress.push([bytes, total]) })
        expect(h.installed).toHaveLength(0)
        expect(existsSync(join(h.root, '0.2.1-rc.2', 'marker'))).toBe(true)
        expect(existsSync(join(h.root, '0.2.1-rc.2.staging'))).toBe(false)
        expect(h.progress).toEqual([[5, 10]])
        rmSync(h.root, { recursive: true, force: true })
    })

    it('accepts a v-prefixed version and lands on the normalized directory', async () => {
        const h = harness()
        await h.installer.install('v1.0.0')
        expect(existsSync(join(h.root, '1.0.0', 'marker'))).toBe(true)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('leaves no staging directory behind when the download fails, and a retry can succeed', async () => {
        const h = harness()
        await expect(h.installer.install('0.0.0-boom')).rejects.toThrow('download exploded')
        expect(existsSync(join(h.root, '0.0.0-boom.staging'))).toBe(false)
        expect(existsSync(join(h.root, '0.0.0-boom'))).toBe(false)
            await h.installer.install('0.0.1')
        expect(existsSync(join(h.root, '0.0.1', 'marker'))).toBe(true)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('leaves no staging behind when verification fails', async () => {
        const h = harness()
        h.failVerify = true
        await expect(h.installer.install('2.0.0')).rejects.toThrow('verify failed')
        expect(existsSync(join(h.root, '2.0.0.staging'))).toBe(false)
        expect(existsSync(join(h.root, '2.0.0'))).toBe(false)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('cancels after the download and cleans staging', async () => {
        const h = harness()
        const controller = new AbortController()
    h.abortController = controller
        await expect(h.installer.install('3.0.0', { signal: controller.signal })).rejects.toThrow('cancelled')
        expect(existsSync(join(h.root, '3.0.0.staging'))).toBe(false)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('replaces an existing install on reinstall', async () => {
        const h = harness()
        await h.installer.install('4.0.0')
        await h.installer.install('4.0.0')
        expect(existsSync(join(h.root, '4.0.0', 'marker'))).toBe(true)
        rmSync(h.root, { recursive: true, force: true })
    })
})

describe('createRuntimeInstaller.uninstall', () => {
    it('removes a non-active runtime', () => {
        const h = harness()
        mkdirSync(join(h.root, '5.0.0'), { recursive: true })
        h.installer.uninstall('v5.0.0')
        expect(existsSync(join(h.root, '5.0.0'))).toBe(false)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('refuses the active runtime with a reason', () => {
        const h = harness()
        mkdirSync(join(h.root, '6.0.0'), { recursive: true })
        h.active = '6.0.0'
        expect(() => h.installer.uninstall('6.0.0')).toThrow('active runtime')
        expect(existsSync(join(h.root, '6.0.0'))).toBe(true)
        rmSync(h.root, { recursive: true, force: true })
    })

    it('refuses a version that is not installed', () => {
        const h = harness()
        expect(() => h.installer.uninstall('7.0.0')).toThrow('not installed')
        rmSync(h.root, { recursive: true, force: true })
    })
})
