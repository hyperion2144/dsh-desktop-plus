import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  blockRuntimeCandidate,
  dismissRuntimeCandidate,
  loadRuntimeLedger,
  presentRuntimeCandidate,
  shouldPresentRuntimeCandidate,
} from '../src/runtimes/attention.ts'

const dir = (): string => mkdtempSync(join(tmpdir(), 'plus-attention-'))

describe('runtime attention ledger', () => {
  it('presents an unseen candidate', () => {
    expect(shouldPresentRuntimeCandidate('1.1.0', 'fp1', { dismissed: {}, blocked: [] })).toBe(true)
  })

  it('silences a blocked version even after a fingerprint change', () => {
    const d = dir()
    blockRuntimeCandidate(d, '1.1.0')
    const ledger = loadRuntimeLedger(d)
    expect(shouldPresentRuntimeCandidate('1.1.0', 'fp-new', ledger)).toBe(false)
  })

  it('does not repeat a dismissal until the candidate fingerprint changes', () => {
    const d = dir()
    dismissRuntimeCandidate(d, '1.1.0', 'fp1', 100)
    const ledger = loadRuntimeLedger(d)
    expect(shouldPresentRuntimeCandidate('1.1.0', 'fp1', ledger, 200)).toBe(false)
    expect(shouldPresentRuntimeCandidate('1.1.0', 'fp2', ledger, 200)).toBe(true)
  })

  it('survives a malformed ledger file by resetting', () => {
    const d = dir()
    const { writeFileSync } = require('node:fs') as typeof import('node:fs')
    writeFileSync(join(d, 'runtime-attention.json'), '{ nope')
    expect(loadRuntimeLedger(d)).toEqual({ dismissed: {}, blocked: [] })
  })

  it('presents with a distinct runtime-update wording', () => {
    const seen: Array<{ title: string; body: string }> = []
    presentRuntimeCandidate({ show: (input) => seen.push(input) }, '2.0.0', '1.9.0')
    expect(seen[0]?.title).toContain('runtime')
    expect(seen[0]?.body).toContain('2.0.0')
    expect(seen[0]?.body).toContain('1.9.0')
  })
})
