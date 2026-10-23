import { describe, expect, it, vi } from 'vitest'
import { createRestartController, type RestartControllerDeps } from '../src/restart.ts'

function deps(): { d: RestartControllerDeps, relaunch: ReturnType<typeof vi.fn>, quit: ReturnType<typeof vi.fn>, stopAllHosts: ReturnType<typeof vi.fn>, exit: ReturnType<typeof vi.fn> } {
    const relaunch = vi.fn()
    const quit = vi.fn()
    const stopAllHosts = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn()
    return { d: { app: { relaunch, quit }, hosts: { stopAllHosts, exit } }, relaunch, quit, stopAllHosts, exit }
}

describe('restart controller', () => {
    it('routes requestQuit through the confirmable quit flow', () => {
        const { d, quit } = deps()
        createRestartController(d).requestQuit()
        expect(quit).toHaveBeenCalledTimes(1)
    })

    it('routes quitWithoutConfirmation to the same quit flow without extra dialogs', () => {
        const { d, quit, relaunch } = deps()
        createRestartController(d).quitWithoutConfirmation()
        expect(quit).toHaveBeenCalledTimes(1)
        expect(relaunch).not.toHaveBeenCalled()
    })

    it('stops every host before exiting unconditionally', async () => {
        const { d, stopAllHosts, exit, quit } = deps()
        await createRestartController(d).forceQuit()
        expect(stopAllHosts).toHaveBeenCalledTimes(1)
        expect(exit).toHaveBeenCalledWith(0)
        expect(quit).not.toHaveBeenCalled()
    })

    it('schedules the relaunch before quitting so the next process starts fresh', () => {
        const { d, relaunch, quit, exit } = deps()
        createRestartController(d).restartApplication()
        expect(relaunch).toHaveBeenCalledTimes(1)
        expect(quit).toHaveBeenCalledTimes(1)
        expect(exit).not.toHaveBeenCalled()
    })
})
