import { describe, expect, it, vi } from 'vitest'
import { restartApplicationInPlace, type RestartAllTargets } from '../src/restart-all.ts'

function targets(overrides: Partial<RestartAllTargets> = {}): RestartAllTargets & { order: Array<string> } {
    const order: Array<string> = []
    return {
        order,
        official: { restart: async () => { order.push('official') } },
        profiles: [
            { name: 'work', restart: async () => { order.push('work') } },
            { name: 'personal', restart: async () => { order.push('personal') } },
        ],
        recreateTray: () => { order.push('tray') },
        ...overrides,
    }
}

describe('in-place application restart', () => {
    it('recreates the tray before any host starts, official backend first', async () => {
        const t = targets()
        await restartApplicationInPlace(t)
        expect(t.order).toEqual(['tray', 'official', 'work', 'personal'])
    })

    it('keeps the main process alive — no relaunch or exit is involved', async () => {
        const t = targets()
        const outcome = await restartApplicationInPlace(t)
        expect(outcome).toEqual({ restarted: ['work', 'personal'], failed: [] })
    })

    it('collects a failing profile and still restarts the rest', async () => {
        const t = targets({
            profiles: [
                { name: 'work', restart: async () => { throw new Error('port 6391 busy') } },
                { name: 'personal', restart: async () => { } },
            ],
        })
        const outcome = await restartApplicationInPlace(t)
        expect(outcome.restarted).toEqual(['personal'])
        expect(outcome.failed).toEqual([{ name: 'work', reason: 'port 6391 busy' }])
    })

    it('surfaces a string rejection as a readable reason', async () => {
        const t = targets({
            profiles: [{ name: 'work', restart: async () => { throw 'boom' } }],
        })
        const outcome = await restartApplicationInPlace(t)
        expect(outcome.failed).toEqual([{ name: 'work', reason: 'boom' }])
    })
})
