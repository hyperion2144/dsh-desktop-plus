/** Table-driven tests for runtime candidate selection (ticket #14 acceptance). */

import { describe, expect, it } from 'vitest'
import { compareSemver, parseSemver, selectRuntimeCandidates } from '../src/index.ts'
import type { RuntimeSourceInput } from '../src/index.ts'

const builtin = (version: string): RuntimeSourceInput => ({ id: 'builtin', kind: 'builtin', version })
const installed = (version: string, id = `installed:${version}`): RuntimeSourceInput => ({ id, kind: 'installed', version })
const remote = (version: string, id = `remote:${version}`): RuntimeSourceInput => ({ id, kind: 'remote', version })

describe('parseSemver', () => {
    it.each([
        ['1.2.3', { major: 1, minor: 2, patch: 3, prerelease: [] }],
        ['v2.0.0', { major: 2, minor: 0, patch: 0, prerelease: [] }],
        ['1.0.0-rc.1', { major: 1, minor: 0, patch: 0, prerelease: ['rc', '1'] }],
        ['1.0.0-beta.11+build.9', { major: 1, minor: 0, patch: 0, prerelease: ['beta', '11'] }],
    ])('parses %s', (raw, expected) => {
        expect(parseSemver(raw)).toEqual(expected)
    })

    it.each(['', '1', '1.2', 'a.b.c', '1.2.3.4', 'latest'])('rejects %s', (raw) => {
        expect(parseSemver(raw)).toBeNull()
    })
})

describe('compareSemver', () => {
    it.each([
        ['2.0.0', '1.9.9', 1],
        ['1.0.0', '1.0.0', 0],
        ['1.0.1', '1.0.0', 1],
        // Semver order: a release outranks its own prereleases.
        ['1.0.0', '1.0.0-rc.1', 1],
        ['1.0.0-alpha', '1.0.0-beta', -1],
        ['1.0.0-alpha.1', '1.0.0-alpha.2', -1],
        ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ])('orders %s vs %s -> %i', (left, right, expected) => {
        const l = parseSemver(left)
        const r = parseSemver(right)
        expect(l).not.toBeNull()
        expect(r).not.toBeNull()
        expect(compareSemver(l!, r!)).toBe(expected)
    })
})

describe('selectRuntimeCandidates', () => {
    it('keeps the builtin runtime first-class, present, and irremovable', () => {
        const [candidate] = selectRuntimeCandidates([builtin('1.0.0')])
        expect(candidate).toMatchObject({ version: '1.0.0', builtin: true, removable: false, disposition: 'builtin' })
    })

    it('always surfaces the builtin even among many remotes', () => {
        const candidates = selectRuntimeCandidates([remote('9.0.0'), builtin('1.0.0'), remote('8.0.0')])
        const builtinCandidate = candidates.find((candidate) => candidate.builtin)
        expect(builtinCandidate).toMatchObject({ version: '1.0.0', removable: false })
    })

    it('deduplicates one version across sources keeping the highest-priority source', () => {
        const candidates = selectRuntimeCandidates([
            remote('2.0.0', 'remote-index'),
            installed('2.0.0', 'installed-copy'),
            builtin('2.0.0'),
            installed('2.0.0', 'installed-again'),
        ])
        expect(candidates).toHaveLength(1)
        expect(candidates[0]).toMatchObject({ disposition: 'builtin', builtin: true, source: { id: 'builtin' } })
    })

    it('prefers installed over remote when neither is builtin', () => {
        const candidates = selectRuntimeCandidates([remote('2.0.0', 'remote-index'), installed('2.0.0', 'installed-copy')])
        expect(candidates[0]).toMatchObject({ disposition: 'installed', source: { id: 'installed-copy' } })
    })

    it('sorts semver descending with prereleases floating above their own release', () => {
        const candidates = selectRuntimeCandidates([
            installed('1.0.0'),
            installed('2.0.0'),
            installed('2.0.0-rc.1'),
            installed('1.5.0-beta'),
            installed('0.9.0'),
        ])
        expect(candidates.map((candidate) => candidate.version)).toEqual([
            '2.0.0-rc.1',
            '2.0.0',
            '1.5.0-beta',
            '1.0.0',
            '0.9.0',
        ])
    })

    it('marks downloadables and carries every disposition with reasons for the unusable', () => {
        const candidates = selectRuntimeCandidates([
            builtin('1.0.0'),
            installed('1.1.0'),
            remote('1.2.0'),
            { id: 'remote-broken', kind: 'remote', version: 'not-a-version' },
            { id: 'remote-arch', kind: 'remote', version: '1.3.0', unavailableReason: 'no arm64 build' },
        ])
            expect(candidates.map((candidate) => candidate.disposition)).toEqual([
                    'unavailable',
                    'downloadable',
                    'installed',
                    'builtin',
                    'unavailable',
            ])
            expect(candidates[0]).toMatchObject({ version: '1.3.0', removable: true, unavailableReason: 'no arm64 build' })
            expect(candidates[4]?.unavailableReason).toBe('invalid version: not-a-version')
    })

    it('normalizes the surviving version string', () => {
        const candidates = selectRuntimeCandidates([installed('v1.2.3+build.7')])
        expect(candidates[0]).toMatchObject({ version: '1.2.3' })
    })

    it('returns an empty list for empty input', () => {
        expect(selectRuntimeCandidates([])).toEqual([])
    })
})
