import { describe, expect, it } from 'vitest'
import { applyLoginItemFromEnv, isLoginItemEnabled, setLoginItemEnabled, type LoginItemApp } from '../src/login-item.ts'

const fakeApp = (state = { openAtLogin: false }, failSet = false): LoginItemApp & { calls: string[] } => ({
    calls: [],
    setLoginItemSettings(settings) {
    this.calls.push(`set:${settings.openAtLogin}`)
    if (failSet) throw new Error('os refused')
    state.openAtLogin = settings.openAtLogin
    },
    getLoginItemSettings() {
    this.calls.push('get')
    return { ...state }
    },
})

describe('login item', () => {
  it('reads the registered state', () => {
    const app = fakeApp({ openAtLogin: true })
    expect(isLoginItemEnabled(app)).toBe(true)
  })

  it('enables and disables through the app surface', () => {
    const app = fakeApp()
    expect(setLoginItemEnabled(app, true)).toBe(true)
    expect(isLoginItemEnabled(app)).toBe(true)
    expect(setLoginItemEnabled(app, false)).toBe(true)
    expect(isLoginItemEnabled(app)).toBe(false)
    expect(app.calls).toEqual(['set:true', 'get', 'set:false', 'get'])
  })

  it('returns false instead of throwing when the OS call fails', () => {
    const app = fakeApp(undefined, true)
    expect(setLoginItemEnabled(app, true)).toBe(false)
  })

  it('applies the environment switch and reports the applied state', () => {
    const on = fakeApp()
    expect(applyLoginItemFromEnv(on, { DSH_DESKTOP_SET_LOGIN_ITEM: '1' })).toBe(true)
    expect(isLoginItemEnabled(on)).toBe(true)
    const off = fakeApp({ openAtLogin: true })
    expect(applyLoginItemFromEnv(off, { DSH_DESKTOP_SET_LOGIN_ITEM: '0' })).toBe(false)
    expect(isLoginItemEnabled(off)).toBe(false)
  })

  it('leaves the OS state alone when the switch is unset or malformed', () => {
    const app = fakeApp({ openAtLogin: true })
    expect(applyLoginItemFromEnv(app, {})).toBeNull()
    expect(applyLoginItemFromEnv(app, { DSH_DESKTOP_SET_LOGIN_ITEM: 'yes' })).toBeNull()
    expect(app.calls).toEqual([])
    expect(isLoginItemEnabled(app)).toBe(true)
  })

  it('reports null when the switch fails to apply', () => {
    const app = fakeApp(undefined, true)
    expect(applyLoginItemFromEnv(app, { DSH_DESKTOP_SET_LOGIN_ITEM: '1' })).toBeNull()
  })
})
