import { describe, expect, it } from 'vitest'
import { attachPackagedDevTools, toggleDevTools, type DevToolsInput, type DevToolsWindow } from '../src/devtools.ts'

const key = (overrides: Partial<DevToolsInput> = {}): DevToolsInput => ({
    type: 'keyDown', key: 'F12', alt: false, meta: false, control: false, ...overrides,
})

const fakeWindow = (opened = false): DevToolsWindow & { log: string[]; emit(input: DevToolsInput): void; detach(): void } => {
    const log: string[] = []
    let listener: ((event: { preventDefault(): void }, input: DevToolsInput) => void) | undefined
    return {
        log,
        webContents: {
            on(_event, attached) { listener = attached },
            off() { listener = undefined },
            isDevToolsOpened: () => opened,
            openDevTools: () => { log.push('open') },
            closeDevTools: () => { log.push('close') },
        },
        emit(input) {
            const prevented: boolean[] = []
            listener?.({ preventDefault: () => { prevented.push(true) } }, input)
            if (prevented.length > 0) log.push('prevented')
        },
        detach() { listener = undefined },
    }
}

describe('devtools toggle', () => {
    it('opens detached when closed and closes when open', () => {
        const closed = fakeWindow(false)
        toggleDevTools(closed)
        expect(closed.log).toEqual(['open'])
        const opened = fakeWindow(true)
        toggleDevTools(opened)
        expect(opened.log).toEqual(['close'])
    })

    it('returns null outside packaged mode without the override', () => {
        expect(attachPackagedDevTools(fakeWindow(), false, {})).toBeNull()
    })

    it('attaches in packaged mode and toggles on F12', () => {
        const window = fakeWindow(false)
        const attachment = attachPackagedDevTools(window, true, {})
        expect(attachment).not.toBeNull()
        window.emit(key())
        expect(window.log).toEqual(['open', 'prevented'])
        window.emit(key({ key: 'a' }))
        expect(window.log).toEqual(['open', 'prevented'])
    })

    it('honors Alt+Cmd+I only on macOS', () => {
        const window = fakeWindow(false)
        attachPackagedDevTools(window, true, {})
        window.emit(key({ key: 'i', alt: true, meta: true }))
        const macExpected = process.platform === 'darwin' ? ['open', 'prevented'] : []
        expect(window.log).toEqual(macExpected)
    })

    it('activate-override enables the toggle in development', () => {
        const window = fakeWindow(false)
        expect(attachPackagedDevTools(window, false, { DSH_DESKTOP_DEVTOOLS: '1' })).not.toBeNull()
        window.emit(key())
        expect(window.log).toEqual(['open', 'prevented'])
    })

    it('survives a throwing toggle and detaches cleanly', () => {
        const window = fakeWindow(false)
        window.webContents.openDevTools = () => { throw new Error('boom') }
        const attachment = attachPackagedDevTools(window, true, {})
        expect(() => window.emit(key())).not.toThrow()
        attachment?.dispose()
        const before = window.log.length
        window.emit(key())
        expect(window.log.length).toBe(before)
    })
})
