import { describe, expect, it, vi } from 'vitest'
import {
    dispatchApplicationClick,
    dispatchProfileClick,
    resolveProfileClick,
    trayMenuOrder,
    type TrayProfileActions,
} from '../src/tray/menu-model.ts'

function actions(): TrayProfileActions & {
    calls: Array<string>
} {
    const calls: Array<string> = []
    const track = (label: string) => () => { calls.push(label) }
    return {
        calls,
        showOrFocus: (name) => calls.push(`show:${name}`),
        hide: (name) => calls.push(`hide:${name}`),
        restart: (name) => calls.push(`restart:${name}`),
        quit: (name) => calls.push(`quit:${name}`),
        restartApp: track('restart-app'),
        quitApp: track('quit-app'),
    }
}

describe('tray click resolution', () => {
    it('focuses a hidden window', () => {
        expect(resolveProfileClick({ visible: false, focused: false })).toBe('show-or-focus')
    })

    it('focuses a visible but unfocused window instead of hiding it', () => {
        expect(resolveProfileClick({ visible: true, focused: false })).toBe('show-or-focus')
    })

    it('hides only the already-focused window', () => {
        expect(resolveProfileClick({ visible: true, focused: true })).toBe('hide')
    })

    it('dispatches restart and quit regardless of window state', () => {
        const a = actions()
        dispatchProfileClick('work', 'restart', { visible: true, focused: true }, a)
        dispatchProfileClick('work', 'quit', { visible: false, focused: false }, a)
        expect(a.calls).toEqual(['restart:work', 'quit:work'])
    })

    it('routes the primary click through the resolved show-or-focus/hide decision', () => {
        const a = actions()
        dispatchProfileClick('work', 'show-or-focus', { visible: true, focused: false }, a)
        dispatchProfileClick('work', 'show-or-focus', { visible: true, focused: true }, a)
        expect(a.calls).toEqual(['show:work', 'hide:work'])
    })

    it('dispatches the application-level restart and quit entries', () => {
        const a = actions()
        dispatchApplicationClick('restart-app', a)
        dispatchApplicationClick('quit-app', a)
        expect(a.calls).toEqual(['restart-app', 'quit-app'])
    })
})

describe('trayMenuOrder', () => {
    it('puts the application block between the profile section and the application entries', () => {
        expect(trayMenuOrder({ applicationItemCount: 3 })).toEqual([
            'profiles', 'separator', 'application', 'separator', 'restart-app', 'quit-app',
        ])
    })

    it('omits the application block entirely when the shell supplies no items', () => {
        expect(trayMenuOrder({ applicationItemCount: 0 })).toEqual(['profiles', 'separator', 'restart-app', 'quit-app'])
    })
})
